import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHELVES, extractionPrompt, newArchive, importMemoryBook, validateArchive, splitMemoryBook, guessShelves,
  snapshotChat, mergeSources, syncActiveSources, normalizeFact,
  addFacts, retrieve, parseJsonReply, renderContext, terms, planLegacyJobs, requestLegacyFacts,
} from '../src/core.js';

const sample=`MEMORY BOOK\n[Main characters]\n- Agent Alpha: has access to Zone C.\n\n[Relationships]\n- Agent Alpha and Agent Beta share access to Zone C.\n\n[Events Chronicle]\n— Nov 1, 08:15: Agent Beta transferred an access token to Agent Alpha.\n\n[Core items]\n- Access token: stored in Zone C.\n\n[Important quotes]\n- “Verify the access token.”`;

test('one-time Memory Book import stores original exactly and categorizes shelves', () => {
  const archive=newArchive('chat-1');const out=importMemoryBook(archive,sample,{label:'Old Book'});
  assert.equal(out.duplicate,false);assert.ok(out.count>=4);
  assert.equal(archive.imports[0].raw,sample);
  assert.ok(archive.chunks.some(c=>c.shelves.includes('people')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('relationships')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('chronology')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('items')));
  assert.equal(validateArchive(archive).valid,true);
  assert.equal(importMemoryBook(archive,sample,{label:'Old Book'}).duplicate,true);
  assert.equal(archive.imports.length,1);
});

test('secrets and knowledge are separate shelves, no artificial text loss in original',()=>{
  const archive=newArchive('c');const raw='[Secrets]\nSystem Node 7 has a hidden internal identifier.\n\n[Knowledge Ledger]\nOnly Agent Alpha knows System Node 7 identity.';
  importMemoryBook(archive,raw);assert.equal(archive.imports[0].raw,raw);
  assert.ok(archive.chunks.some(x=>x.shelves.includes('secrets')));
  assert.ok(archive.chunks.some(x=>x.shelves.includes('knowledge')));
});

test('new source preserves alternative swipes while active source changes',()=>{
  const chat=[{mes:'first',swipes:['first','second'],swipe_id:0,is_user:false}];
  const archive=newArchive('c');mergeSources(archive,snapshotChat(chat),new Set([0]));
  assert.equal(archive.sources.length,2);
  const ids=new Set(archive.sources.map(s=>s.id));assert.equal(ids.size,2);
  chat[0].swipe_id=1;chat[0].mes='second';syncActiveSources(archive,chat);
  assert.equal(archive.sources.filter(s=>s.active).length,1);
  assert.equal(archive.sources.find(s=>s.active).raw,'second');
  assert.equal(archive.sources.find(s=>!s.active).raw,'first');
});

test('indexed facts require valid source citation and never leak inactive swipe facts',()=>{
  const archive=newArchive('c');const chat=[{mes:'First: alpha access code',swipes:['First: alpha access code','Second: beta access code'],swipe_id:0,is_user:false}];
  mergeSources(archive,snapshotChat(chat),new Set([0]));const a=archive.sources.find(x=>x.active),b=archive.sources.find(x=>!x.active);
  addFacts(archive,[a.id],[{shelf:'items',text:'The alpha access code is active',source_ids:[a.id],certainty:'confirmed'}]);
  assert.ok(retrieve(archive,'alpha access code').some(x=>x.text.includes('alpha access code')));
  chat[0].swipe_id=1;chat[0].mes='Second: beta access code';syncActiveSources(archive,chat);
  assert.ok(!retrieve(archive,'alpha access code').some(x=>x.text.includes('alpha access code')&&x.kind==='fact'));
  assert.equal(normalizeFact({shelf:'items',text:'Fake',source_ids:['bogus']},[b.id],archive),null);
});

test('extractor accepts JSON and fenced JSON; context marks knowledge constraints',()=>{
  assert.deepEqual(parseJsonReply('```json\n{"facts":[]}\n```'),{facts:[]});
  assert.deepEqual(parseJsonReply(' {"facts":[]} '),{facts:[]});
  const v=renderContext([{text:'[secret] A piece of lore'}]);
  assert.match(v,/Reader-only secrets remain unknown to NPCs/);
});

test('U+2800 and Russian search terms are normalized',()=>{
  assert.ok(terms('Модуль⠀читает документ').includes('модуль'));
});

import {pendingExtraction,extractionView} from '../src/core.js';

test('automatic scheduling counts only pending answers since activation, not the entire chat',()=>{
  const archive=newArchive('chat-X');archive.autoStartIndex=10;
  const chat=[];
  for(let i=0;i<13;i++)chat.push({mes:`Reply ${i}`,is_user:false});
  mergeSources(archive,snapshotChat(chat));
  assert.equal(pendingExtraction(archive).assistantCount,3);
  assert.equal(pendingExtraction(archive,{force:true}).assistantCount,13);
  const ids=pendingExtraction(archive).sources.map(x=>x.id);
  archive.batches.push({status:'done',sourceIds:ids});
  assert.equal(pendingExtraction(archive).assistantCount,0);
});

test('deep legacy facts keep chunk citations and remain retrievable after import',()=>{
  const a=newArchive('legacy');importMemoryBook(a,'[Events Chronicle]\nOn May 8, Agent Delta placed item Q-4 in Zone C.');
  const c=a.chunks[0];
  const added=addFacts(a,[c.id],[{shelf:'items',text:'Agent Delta placed item Q-4 in Zone C',source_ids:[c.id],certainty:'confirmed',tags:['Agent Delta','item Q-4']}]);
  assert.equal(added.length,1);assert.equal(validateArchive(a).valid,true);
  assert.ok(retrieve(a,'Agent Delta item Q-4',{maxCharacters:2500}).some(x=>x.text.includes('item Q-4')));
  const again=addFacts(a,[c.id],[{shelf:'items',text:'Agent Delta placed item Q-4 in Zone C',source_ids:[c.id]}]);
  assert.equal(again.length,0);
});

test('no unrelated secret gets injected without a real term match',()=>{
  const a=newArchive('secrets');importMemoryBook(a,'[Secrets]\nSystem Node 7 stores a restricted identifier.');
  assert.equal(retrieve(a,'ordinary weather report').length,0);
});

test('archivist sees recap and scene, not only first 10k chars of metadata-heavy message',()=>{
  const raw='<scene_metadata location="Zone C"/>'+'<ru>'+('Neutral sample. '.repeat(2000))+'</ru>'+
  '<sample_easel>[I. Staging] Inventory value is 12</sample_easel>'+
  '<en><details closed><summary>recap</summary>The access token was moved into Zone C.</details></en>';
  const input=extractionView({role:'assistant',raw});
  assert.match(input,/The access token was moved/);
  assert.match(input,/Inventory value is 12/);
  assert.ok(input.length<15000);
});

test('silent continuity: unrelated active facts do not enter RP context',()=>{
  const a=newArchive('silent');importMemoryBook(a,'[Relationships]\nAgent Gamma can access Zone C.');
  const c=a.chunks[0];
  addFacts(a,[c.id],[{shelf:'relationships',text:'Agent Gamma can access Zone C.',people:['Agent Gamma'],lifecycle:'active',source_ids:[c.id]}]);
  assert.equal(retrieve(a,'System Node 9 restarts',{mode:'automatic'}).length,0);
});

test('silent continuity: a name alone does not summon a historical flashback',()=>{
  const a=newArchive('no-flashbacks');importMemoryBook(a,'[Events Chronicle]\nAgent Alpha assigned object X-17 to Agent Beta.');
  const c=a.chunks[0];
  addFacts(a,[c.id],[{shelf:'chronology',text:'Agent Alpha assigned object X-17 to Agent Beta.',people:['Agent Alpha','Agent Beta'],lifecycle:'historical',source_ids:[c.id]}]);
  const background=retrieve(a,'Agent Alpha entered the area',{mode:'automatic'});
  assert.equal(background.length,1);
  assert.equal(background[0].anchor,true);
  assert.ok(background[0].text.length<340);
  assert.equal(retrieve(a,'Agent Alpha entered the area',{mode:'automatic',maxAnchors:0}).length,0);
  assert.ok(retrieve(a,'Agent Alpha inspected object X-17',{mode:'automatic'}).some(x=>x.kind==='fact'));
  assert.ok(retrieve(a,'Do you remember Agent Alpha?',{mode:'automatic'}).length>0);
  assert.ok(retrieve(a,'Помнишь, Agent Alpha?',{mode:'automatic'}).length>0);
});

test('silent continuity prompt forbids forced flashbacks but permits present consequences',()=>{
  const prompt=renderContext([{text:'[relationships] They trust each other',historical:false},{text:'[chronology] Old scene',historical:true}]);
  assert.match(prompt,/NEVER insert flashbacks/);
  assert.match(prompt,/preserve current relationships/);
  assert.match(prompt,/Past references/);
});


test('neutral custom easel tag is parsed without a project-specific name',()=>{
  const raw='<ru>Sample scene.</ru><test_easel>STATUS: object is present</test_easel>';
  const view=extractionView({role:'assistant',raw});
  assert.match(view,/STATUS: object is present/);
});

test('retrieval returns empty context when no relevant source exists',()=>{
  const a=newArchive('blank');
  assert.deepEqual(retrieve(a,'Sample action',{mode:'automatic'}),[]);
  assert.equal(renderContext([]),'');
});

test('memory retrieval after explicit recollection request can include a sourced episode',()=>{
  const a=newArchive('recall');importMemoryBook(a,'[Events Chronicle]\nAgent Alpha assigned object X-17 to Agent Beta.');
  const ch=a.chunks[0];
  addFacts(a,[ch.id],[{shelf:'chronology',text:'Agent Alpha assigned object X-17 to Agent Beta.',people:['Agent Alpha','Agent Beta'],lifecycle:'historical',source_ids:[ch.id]}]);
  const hits=retrieve(a,'Do you remember Agent Alpha?',{mode:'automatic'});
  assert.ok(hits.some(x=>x.kind==='fact'&&!x.anchor));
});


test('deep inheritance retries invalid cheap-model JSON and retains source citations',async()=>{
  const book=newArchive('sanitized-chat');
  importMemoryBook(book,'[Events Chronicle]\nAgent Epsilon delivered item R-9 to Station D.');
  const c=book.chunks[0];let calls=0;
  const data=await requestLegacyFacts([c],async(prompt)=>{
    calls++;
    assert.equal(prompt[1].role,'user');
    assert.match(prompt[1].content,/Agent Epsilon/);
    if(calls===1)return '{"facts":[{"text":"invalid"} {"text":"missing comma"}]}';
    return JSON.stringify({facts:[{shelf:'items',text:'Item R-9 was delivered to Station D.',source_ids:[c.id],certainty:'confirmed'}]});
  },{maxTokens:2200});
  assert.equal(calls,2);
  assert.equal(addFacts(book,[c.id],data).length,1);
  assert.equal(validateArchive(book).valid,true);
  assert.equal(book.imports[0].raw,'[Events Chronicle]\nAgent Epsilon delivered item R-9 to Station D.');
});

test('invalid JSON is rejected, not guessed or marked successful',async()=>{
  let count=0;
  await assert.rejects(requestLegacyFacts([{id:'source1',heading:'x',raw:'sample'}],async()=>{
    count++;return '{"facts":[{"text":"a"} {"text":"b"}]}';
  }),/failed after 2 attempts/);
  assert.equal(count,2);
});

test('legacy jobs are small and keep every original fragment exactly once',()=>{
  const data=[600,1200,1500,2800,400,700].map((length,i)=>({id:`source-${i}`,raw:'A'.repeat(length)}));
  const jobs=planLegacyJobs(data);
  assert.ok(jobs.every(job=>job.length<=2));
  assert.deepEqual(jobs.flat().map(x=>x.id),data.map(x=>x.id));
  assert.ok(jobs.every(job=>job.length===1||job.reduce((n,c)=>n+c.raw.length,0)<=2600));
});

test('fenced model response is accepted and content arrays are supported',()=>{
  assert.deepEqual(parseJsonReply([{type:'text',text:'```json\n{"facts":[]}\n```'}]),{facts:[]});
  assert.throws(()=>parseJsonReply('{"facts":[1,2 3]}'),/invalid JSON/);
});

import {segmentLegacyChunk,currentStateRecords} from '../src/core.js';

test('legacy multi-item inventory is separated into source-preserving small pieces',()=>{
  const raw=[
    '- **Device A**: installed at Station C.',
    '- **Device B**: transferred to Agent Gamma.',
    '- **Device C**: destroyed during inspection.',
    '- **Device D**: held at Station F.',
  ].join('\n');
  const chunks=segmentLegacyChunk({id:'b:2',heading:'Inventory',raw},{maxCharacters:75});
  assert.ok(chunks.length>1);
  assert.deepEqual(chunks.map(c=>c.id),Array(chunks.length).fill('b:2'));
  assert.equal(chunks.map(c=>c.raw).join('\n'),raw);
  assert.ok(chunks.every(c=>c.raw.length<=75));
});

test('promise states and arc states are separate from historical lifecycle',()=>{
  const a=newArchive('neutral');
  importMemoryBook(a,'[Events Chronicle]\nAgent Alpha promised to deliver Device A.\n\nAgent Alpha later delivered Device A.');
  const id=a.chunks[0].id;
  const p=addFacts(a,[id],[{shelf:'promises',text:'Agent Alpha promised to deliver Device A.',entity_key:'deliver-device-a',promise_status:'pending',source_ids:[id]}])[0];
  assert.equal(p.promiseStatus,'pending');
  const finished=addFacts(a,[id],[{shelf:'promises',text:'Agent Alpha delivered Device A, fulfilling the promise.',entity_key:'deliver-device-a',promise_status:'fulfilled',source_ids:[id]}])[0];
  assert.equal(finished.promiseStatus,'fulfilled');
  assert.equal(currentStateRecords(a.facts,'promises')[0].promiseStatus,'fulfilled');
  assert.equal(a.facts.length,2); // never delete the original pledge event
  const unknown=addFacts(a,[id],[{shelf:'promises',text:'Agent Gamma promised an unspecified favor.',source_ids:[id]}])[0];
  assert.equal(unknown.promiseStatus,'unknown');
  const arc=addFacts(a,[id],[{shelf:'arcs',text:'Inspection arc completed',entity_key:'inspection',arc_status:'completed',source_ids:[id]}])[0];
  assert.equal(arc.arcStatus,'completed');
  assert.equal(SHELVES.arcs,'Сюжетные арки');
});

test('NPC knowledge requires explicit holder; unspecified knowledge stays unknown',()=>{
  const a=newArchive('neutral');
  importMemoryBook(a,'[Events Chronicle]\nAgent Delta heard the station alarm.');
  const id=a.chunks[0].id;
  const known=addFacts(a,[id],[{shelf:'knowledge',text:'Agent Delta heard the station alarm.',knowledge_holder:'Agent Delta',knowledge_state:'knows',source_ids:[id]}])[0];
  const unconfirmed=addFacts(a,[id],[{shelf:'knowledge',text:'Station alarm exists.',source_ids:[id]}])[0];
  assert.equal(known.knowledge,'Agent Delta');
  assert.equal(known.knowledgeState,'knows');
  assert.equal(unconfirmed,undefined); // a fact with no known NPC holder must not be classified as NPC knowledge
});

test('legacy extractor instructions demand one object per item and explicit evidence for promise closure',async()=>{
  const chunks=[{id:'a:0',heading:'Items',raw:'- Device A\n- Device B'}];
  await requestLegacyFacts(chunks,async(prompt)=>{
    assert.match(prompt[0].content,/one separate item per object/i);
    assert.match(prompt[0].content,/fulfilled.*ONLY if execution is explicitly evidenced/i);
    assert.match(prompt[0].content,/concluded ARC/);
    assert.match(prompt[0].content,/intentionally concealed/i);
    return '{"facts":[]}';
  });
});

test('model extraction gets existing open promise keys and keeps arc and knowledge constraints',()=>{
  const [{content:system},{content:user}]=extractionPrompt([{id:'m1',role:'assistant',name:'Agent Alpha',raw:'Device A was delivered'}],{
    openPromises:[{entity_key:'deliver-device-a',text:'Agent Alpha promised Device A',status:'pending'}]
  });
  assert.match(system,/Reuse the entity_key/);
  assert.match(system,/Identify NPC knowledge ONLY when scene explicitly/);
  assert.equal(JSON.parse(user).openPromises[0].entity_key,'deliver-device-a');
});
