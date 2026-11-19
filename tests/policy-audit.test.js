import test from 'node:test';
import assert from 'node:assert/strict';
import {newArchive, isContentPolicyRejection, pendingExtraction, auditArchive, sourceId, addFacts} from '../src/core.js';

test('provider content refusal is distinguishable from network failure', () => {
  assert.equal(isContentPolicyRejection(new Error('PROHIBITED_CONTENT')),true);
  assert.equal(isContentPolicyRejection({response:{data:{error:{code:'SAFETY_BLOCK',message:'request rejected'}}}}),true);
  assert.equal(isContentPolicyRejection(new Error('API request failed')),false);
  assert.equal(isContentPolicyRejection(new Error('Too many requests / 429')),false);
  assert.equal(isContentPolicyRejection(new Error('Invalid JSON')),false);
});

test('blocked batches stay in source archive but are not queued for extraction again', () => {
  const a=newArchive('neutral-chat');
  const id1=sourceId(0,0,'The caretaker opened the gate.');
  const id2=sourceId(1,0,'Someone wrote a letter.');
  a.sources.push(
    {id:id1,index:0,swipe:0,raw:'The caretaker opened the gate.',role:'assistant',active:true,deleted:false},
    {id:id2,index:1,swipe:0,raw:'Someone wrote a letter.',role:'assistant',active:true,deleted:false});
  a.batches.push({id:'batch-1',status:'blocked',sourceIds:[id1],facts:0,reason:'provider_content_policy'});
  const pending=pendingExtraction(a,{force:true});
  assert.deepEqual(pending.sources.map(s=>s.id),[id2]);
  assert.equal(pending.assistantCount,1);
  assert.equal(a.sources[0].raw,'The caretaker opened the gate.');
  const audit=auditArchive(a);
  assert.equal(audit.blockedBatches,1);
  assert.equal(audit.unprocessedSelected,1);
  assert.ok(audit.warnings.some(w=>w.includes('НЕ извлечены')));
});

test('chat quality audit distinguishes migrated facts from chat-derived facts', () => {
  const a=newArchive('fixture-chat');
  a.imports.push({id:'book-z',raw:'A generic fictional encyclopedia with many entries.',count:1});
  a.chunks.push({id:'book-z:0',sourceId:'book-z',raw:'A setting guide',heading:'Setting'});
  const srcId=sourceId(1,0,'The lantern was lit.');
  a.sources.push({id:srcId,index:1,swipe:0,raw:'The lantern was lit.',role:'assistant',active:true,deleted:false});
  addFacts(a,['book-z:0'],[...Array(6)].map((_,i)=>({shelf:'items',text:`Generic object number ${i+1} was placed inside the cabinet.`,source_ids:['book-z:0']})));
  addFacts(a,[srcId],[{shelf:'chronology',text:'The lantern was lit.',source_ids:[srcId]}]);
  const q=auditArchive(a);
  assert.equal(q.importedFacts,6);
  assert.equal(q.chatFacts,1);
  assert.equal(q.perShelf.items,6);
  assert.ok(q.warnings.some(w=>w.includes('старой Memory Book')));
});
