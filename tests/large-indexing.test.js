import test from 'node:test';
import assert from 'node:assert/strict';
import {planChatBatches,approximateInputTokens,normalizeFact,inGameStamp,locationShelfCards,
  pendingExtraction,extractionPrompt,isContextLimitError,retrieve,newArchive,addFacts} from '../src/core.js';

function synthetic(id,raw,index=0){return {id,role:'assistant',name:'Narrator',index,active:true,deleted:false,raw};}
test('input token budget permits 50K windows without duplicating messages',()=>{
  const sources=Array.from({length:60},(_,i)=>synthetic(`m${i}`,'A calm scene with a small delivery. '.repeat(95),i));
  const groups=planChatBatches(sources,{maxSources:100,maxInputTokens:50000});
  assert.equal(groups.flat().length,60);
  assert.deepEqual(groups.flat().map(x=>x.id),sources.map(x=>x.id));
  assert.ok(groups.some(x=>x.length>2));
  for(const group of groups){if(group.length>1)assert.ok(group.reduce((s,x)=>s+approximateInputTokens(x.raw)+140,0)<50000);}
});
test('tiny input budget plans smaller groups conservatively',()=>{
  const sources=Array.from({length:14},(_,i)=>synthetic(`m${i}`,'A'.repeat(2800),i));
  const smaller=planChatBatches(sources,{maxSources:100,maxInputTokens:4000});
  const larger=planChatBatches(sources,{maxSources:100,maxInputTokens:50000});
  assert.ok(smaller.length>larger.length);
});
test('game date comes from story header, not delivery date',()=>{
  const source=synthetic('m0','<mobile_header location="Pavilion" time="16:40" date="Fri, 14 Oct" /><ru>Scene</ru>');
  source.date='2026-11-19T03:11:21Z';
  const p=extractionPrompt([source]);
  const sent=JSON.parse(p[1].content).messages[0];
  assert.match(sent.in_game_stamp,/14 Oct/);
  assert.equal(sent.recorded_at,source.date);
  assert.equal(inGameStamp('<ru>Unknown scene</ru>'),'');
});
test('dates are stored separately, unknown dates stay unknown',()=>{
  const archive=newArchive('synthetic');
  const d=normalizeFact({shelf:'chronology',text:'A gate was closed',source_ids:['m0'],event_date:'Day 2',event_time:'09:31'},['m0'],archive);
  const e=normalizeFact({shelf:'chronology',text:'A gate was closed',source_ids:['m0']},['m0'],archive);
  assert.equal(d.eventDate,'Day 2');assert.equal(d.eventTime,'09:31');
  assert.equal(e.eventDate,'');assert.notEqual(d.id,e.id);
});
test('location cards collapse repeated canonical entity keys, not distinct places',()=>{
  const facts=[
    {id:'a',shelf:'locations',entityKey:'The Library',text:'Library has an old clock',sourceIds:['m0']},
    {id:'b',shelf:'locations',entityKey:'the library',text:'Library has a new lamp',sourceIds:['m1']},
    {id:'c',shelf:'locations',entityKey:'The Clinic',text:'The clinic is near a river',sourceIds:['m2']},
  ];
  const cards=locationShelfCards(facts);
  assert.equal(cards.length,2);assert.equal(cards[0].mentionCount,2);assert.match(cards[0].text,/old clock/);assert.match(cards[0].text,/new lamp/);
  assert.deepEqual(cards[0].sourceIds,['m0','m1']);
  assert.equal(cards[1].mentionCount,1);
  const equivalent=locationShelfCards([{shelf:'locations',entityKey:'moonlit_garden',text:'a garden'}, {shelf:'locations',entityKey:'moonlit-garden',text:'same garden'}]);
  assert.equal(equivalent.length,1);
});
test('failed extraction stays pending while completed batches are not resent on resume',()=>{
  const archive=newArchive('synthetic');
  archive.sources=Array.from({length:5},(_,i)=>synthetic(`m${i}`,'Short event',i));
  archive.batches=[{status:'done',sourceIds:['m0','m1']},{status:'blocked',sourceIds:['m2']}];
  const result=pendingExtraction(archive,{force:true});
  assert.deepEqual(result.sources.map(x=>x.id),['m3','m4']);
});
test('provider context refusal is detectable as input too large',()=>{
  assert.equal(isContextLimitError(new Error('HTTP 413: request too large')),true);
  assert.equal(isContextLimitError(new Error('context_length_exceeded')),true);
  assert.equal(isContextLimitError(new Error('PROHIBITED_CONTENT')),false);
});
