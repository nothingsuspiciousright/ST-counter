import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newArchive,snapshotChat,mergeSources,syncActiveSources,extractFullRecap,
  fullRecapRecords,retrieve,recapContextExcerpt,importMemoryBook,
} from '../src/core.js';
import {readSnapshot,diffReadSnapshot,recordSignature} from '../src/read-markers.js';

const wrap=text=>`<ru>A neutral dialogue scene.</ru><en><details closed><summary>recap</summary>${text}</details></en>`;

test('complete recap stays byte-for-byte in the derived shelf, even if very long',()=>{
  const body='Agent Delta moved an item to Chamber B.\n'+'A long emotional detail about the object.\n'.repeat(420);
  const raw=wrap(body);
  const a=newArchive('test-one');
  mergeSources(a,snapshotChat([{mes:raw,is_user:false,swipe_id:0}]));
  const hits=fullRecapRecords(a);
  assert.equal(hits.length,1);
  assert.equal(hits[0].text,body);
  assert.equal(hits[0].sourceId,a.sources[0].id);
  assert.equal(a.sources[0].raw,raw);
  assert.equal(a.facts.length,0);
  assert.ok(hits[0].text.length>10000);
});

test('legacy raw book and chat full recaps survive repeated fact reclassification',()=>{
  const a=newArchive('test-two');
  const book='[Events Chronicle]\nA neutral event was recorded.';
  importMemoryBook(a,book);
  const text='The access badge was placed beside a silver marker.';
  mergeSources(a,snapshotChat([{mes:wrap(text),is_user:false}]));
  a.facts=[{id:'old',shelf:'items',text:'An access badge exists.',sourceIds:[a.chunks[0].id]}];
  a.facts=[]; // Old fact re-indexing removes fact records, not sources
  assert.equal(fullRecapRecords(a)[0].text,text);
  assert.equal(a.imports[0].raw,book);
  assert.equal(a.sources[0].raw,wrap(text));
});

test('only the chosen swipe is shown and switching swipe invalidates virtual recap shelf',()=>{
  const a=newArchive('test-three');
  const chat=[{mes:wrap('First branch recalled a ceramic token.'),swipes:[wrap('First branch recalled a ceramic token.'),wrap('Second branch recalled a brass pin.')],swipe_id:0,is_user:false}];
  mergeSources(a,snapshotChat(chat));
  assert.deepEqual(fullRecapRecords(a).map(x=>x.text),['First branch recalled a ceramic token.']);
  chat[0].swipe_id=1;chat[0].mes=chat[0].swipes[1];
  syncActiveSources(a,chat);
  assert.deepEqual(fullRecapRecords(a).map(x=>x.text),['Second branch recalled a brass pin.']);
  assert.equal(fullRecapRecords(a,{includeInactive:true}).length,2);
});

test('recap read receipts are small and changed statuses are detected for same message',()=>{
  const a=newArchive('test-four');
  mergeSources(a,snapshotChat([{mes:wrap('A'.repeat(25000)),is_user:false}]));
  const original=fullRecapRecords(a);
  const seen=readSnapshot(original);
  assert.ok(recordSignature(original[0]).length<60);
  assert.ok(JSON.stringify(seen).length<350);
  assert.equal(diffReadSnapshot(original,seen).added,0);
  const later={...original[0],text:'B'.repeat(25000)};
  const diff=diffReadSnapshot([later],seen);
  assert.equal(diff.added,0);assert.equal(diff.changed,1);
});

test('automatic retrieval does not inject an old recap for a character name alone',()=>{
  const a=newArchive('test-five');
  mergeSources(a,snapshotChat([{mes:wrap('Agent Delta hid a ceramic compass inside the northern storeroom before the examination.'),is_user:false}]));
  assert.equal(retrieve(a,'Agent Delta arrived',{mode:'automatic'}).filter(x=>x.kind==='recap').length,0);
  assert.equal(retrieve(a,'The ceramic compass is inside the northern storeroom before the examination',{mode:'automatic'}).filter(x=>x.kind==='recap').length,1);
});

test('long recaps are fully displayed but only a bounded excerpt goes into the RP context',()=>{
  const text='EARLY DETAIL. '+'Neutral background. '.repeat(150)+'The violet compass was found near the eastern cabinet. '+'More background. '.repeat(150);
  const a=newArchive('test-six');
  mergeSources(a,snapshotChat([{mes:wrap(text),is_user:false}]));
  assert.equal(fullRecapRecords(a)[0].text,text);
  const found=retrieve(a,'violet compass eastern cabinet',{mode:'automatic',maxCharacters:2500,maxItems:4});
  assert.ok(found.some(x=>x.kind==='recap'));
  assert.ok(found.find(x=>x.kind==='recap').text.length<1600);
  assert.ok(recapContextExcerpt(text,['violet','compass'],1250).includes('violet compass'));
});

test('source without recap never becomes a recap row',()=>{
  assert.equal(extractFullRecap('<ru>Story only.</ru>'), '');
  assert.equal(extractFullRecap('<en>Standalone recap without details.</en>'),'Standalone recap without details.');
});
