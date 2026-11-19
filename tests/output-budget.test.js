import test from 'node:test';
import assert from 'node:assert/strict';
import {planChatBatches,isJsonExtractionError,retryOutputTokens,extractionPrompt} from '../src/core.js';

test('chat extraction plans pairwise source batches without losing or duplicating messages',()=>{
  const sources=Array.from({length:7},(_,i)=>({id:`m${i}`,raw:`Synthetic source ${i}`}));
  const groups=planChatBatches(sources);
  assert.deepEqual(groups.map(g=>g.length),[2,2,2,1]);
  assert.deepEqual(groups.flat().map(s=>s.id),sources.map(s=>s.id));
});

test('distinguish malformed JSON from ordinary API errors and policy refusals',()=>{
  assert.equal(isJsonExtractionError(new Error('Archivist returned invalid JSON (Unexpected end of JSON input).')),true);
  assert.equal(isJsonExtractionError(new Error('Archivist JSON missing facts array')),true);
  assert.equal(isJsonExtractionError(new Error('HTTP 401 invalid credentials')),false);
  assert.equal(isJsonExtractionError(new Error('PROHIBITED_CONTENT')),false);
});

test('reasoning-friendly completion retry expands but never exceeds configured ceiling',()=>{
  assert.equal(retryOutputTokens(8192),12288);
  assert.equal(retryOutputTokens(32768),32768);
  assert.equal(retryOutputTokens(1200),2224);
});

test('chat extraction requests concise JSON and still includes source identifiers',()=>{
  const prompt=extractionPrompt([{id:'mX',role:'assistant',name:'Agent Alpha',raw:'A gate in Zone C was opened.'}]);
  assert.match(prompt[0].content,/Max 20 atomic facts/);
  assert.match(prompt[1].content,/mX/);
});
