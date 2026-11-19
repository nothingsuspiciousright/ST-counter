import test from 'node:test';
import assert from 'node:assert/strict';
import {newArchive,importMemoryBook,mergeSources,snapshotChat,validateArchive} from '../src/core.js';
import {wipeChatMemory} from '../src/reset.js';
import {serverDelete} from '../src/storage.js';

const KEY='sola_mnemosyne_v1';
function harness(){
  const old=newArchive('old-archive-001');
  importMemoryBook(old,'[Events Chronicle]\nAgent Alpha placed Object Q inside Sector D.');
  mergeSources(old,snapshotChat([{mes:'<en>Complete recap for Sector D</en>',is_user:false}]));
  old.batches.push({status:'blocked',sourceIds:[old.sources[0].id]});
  old.diagnostics.push({kind:'extract_error',message:'synthetic'});
  old.readReceipts={items:{seen:['x']}};
  old.legacyRebuild={startedAt:'today'};
  const store=new Map([[old.chatId,structuredClone(old)]]);
  const oldPath=`user/files/sola-mnemosyne-${old.chatId}.json`;
  const metadata={[KEY]:{archiveId:old.chatId,originChat:'chat-15',serverPath:oldPath}};
  const deletedServer=[];
  const io={
    oldArchive:old,chatId:'chat-15',chatLength:120,chatMetadata:metadata,metadataKey:KEY,
    createArchive:newArchive,
    putLocal:async a=>store.set(a.chatId,structuredClone(a)),
    deleteLocal:async id=>store.delete(id),
    saveMetadata:async()=>{},
    deleteServer:async(path,id)=>{deletedServer.push({path,id});},
    newId:()=> 'fresh-archive-002',
    assertSameChat:()=>true,
  };
  return {old,metadata,store,oldPath,deletedServer,io};
}
test('full reset removes ALL per-chat Mnemosyne data and points at a fresh empty archive',async()=>{
  const {old,metadata,store,oldPath,deletedServer,io}=harness();
  const out=await wipeChatMemory(io);
  assert.equal(out.archive.chatId,'fresh-archive-002');
  assert.equal(out.archive.autoStartIndex,120);
  assert.equal(out.archive.awaitingManualScan,true); // fresh data stays blank across reload until explicit scan
  for(const key of ['sources','facts','chunks','imports','batches','legacyBatches','diagnostics'])
    assert.deepEqual(out.archive[key],[],key);
  assert.equal(out.archive.lastSync,null);
  assert.equal(out.archive.readReceipts,undefined);
  assert.equal(out.archive.legacyRebuild,undefined);
  assert.equal(validateArchive(out.archive).valid,true);
  assert.equal(store.has(old.chatId),false);
  assert.equal(store.has(out.archive.chatId),true);
  assert.equal(metadata[KEY].archiveId,out.archive.chatId);
  assert.equal(metadata[KEY].serverPath,'');
  assert.deepEqual(deletedServer,[{path:oldPath,id:old.chatId}]);
  assert.deepEqual(out.cleanupErrors,[]);
  assert.equal(old.sources.length,1); // old ST source data was never mutated
});
test('if metadata save fails, old archive pointer and original data survive',async()=>{
  const {old,metadata,store,io}=harness();
  io.saveMetadata=async()=>{throw Error('disk unavailable');};
  await assert.rejects(wipeChatMemory(io),/Original archive is kept/);
  assert.equal(metadata[KEY].archiveId,old.chatId);
  assert.equal(store.has(old.chatId),true);
  assert.equal(store.has('fresh-archive-002'),false);
});
test('server cleanup errors are shown, not silently reported as a successful full wipe',async()=>{
  const {old,metadata,store,io}=harness();
  io.deleteServer=async()=>{throw Error('server offline');};
  const out=await wipeChatMemory(io);
  assert.equal(out.cleanupErrors.length,1);
  assert.match(out.cleanupErrors[0],/server offline/);
  assert.equal(out.deletedServer,false);
  assert.equal(metadata[KEY].archiveId,out.archive.chatId);
  assert.equal(store.has(old.chatId),false);
});
test('concurrent chat switch aborts a reset before it can replace the pointer',async()=>{
  const {metadata,io}=harness();
  io.assertSameChat=()=>false;
  await assert.rejects(wipeChatMemory(io),/Chat changed/);
  assert.equal(metadata[KEY].archiveId,'old-archive-001');
});
test('server deletion refuses paths from any other archive',async()=>{
  let called=false;
  const previous=globalThis.fetch;
  const previousSt=globalThis.SillyTavern;
  globalThis.SillyTavern={getContext:()=>({getRequestHeaders:()=>({'Content-Type':'application/json'})})};
  globalThis.fetch=async()=>{called=true;return {ok:true,status:200}};
  try{
    await assert.rejects(serverDelete('user/files/something.json','old-archive-001'),/does not belong/);
    await assert.rejects(serverDelete('user/files/sola-mnemosyne-another.json','old-archive-001'),/does not belong/);
    assert.equal(called,false);
    const result=await serverDelete('user/files/sola-mnemosyne-old-archive-001.json','old-archive-001');
    assert.equal(result.deleted,true);
    assert.equal(called,true);
  }finally{
    globalThis.fetch=previous;
    globalThis.SillyTavern=previousSt;
  }
});
