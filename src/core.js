/** Sola Mnemosyne: deterministic, vector-free, side-effect-free archive logic. */
export const SCHEMA_VERSION = 1;
export const SHELVES = Object.freeze({
  chronology:'Хронология', people:'Персонажи', relationships:'Отношения',
  promises:'Обещания', items:'Предметы', knowledge:'Знания NPC',
  locations:'Локации', secrets:'Секреты', quotes:'Цитаты и жесты',
  threads:'Сюжетные линии', arcs:'Сюжетные арки', recaps:'Полные recap', other:'Прочее',
});
const STOP = new Set('и в во на у по из с со не а но или что это как если то когда они она он оно мы вы их ему ее его всё все был была были быть для где там уже ещё от до через за перед этот этой себе к тебе мне при над под очень просто только then with from that have when this your into about they what would there just more were their them the and are was had has did does for not her his our its you she he him hers theirs an all those these this is'.split(' '));
export const cleanText = value => String(value ?? '').replace(/\u2800/g,' ').replace(/\s+/g,' ').trim();
export function hash(value) { // fast stable identity, not a cryptographic checksum
  let h = 2166136261; for (const c of String(value)) { h ^= c.codePointAt(0); h = Math.imul(h,16777619); }
  return (h >>> 0).toString(16).padStart(8,'0');
}
export function terms(text,limit=250) {
  return [...new Set(cleanText(text).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.filter(x=>x.length>=3&&!STOP.has(x))??[])].slice(0,limit);
}
export function newArchive(chatId, lineage='') {return {version:SCHEMA_VERSION,chatId,lineage,createdAt:new Date().toISOString(),revision:0,sources:[],chunks:[],facts:[],imports:[],batches:[],legacyBatches:[],autoStartIndex:0,diagnostics:[],lastSync:null};}
export function sourceId(index, swipe, content) {return `m${index}s${swipe}-${hash(content)}-${String(content).length}`;}
export function snapshotChat(chat, start=0, end=chat.length) {
  const result=[];
  for(let i=start;i<Math.min(chat.length,end);i++) {
    const m=chat[i]; if(!m || typeof m.mes!=='string' || m.is_system) continue;
    const selected=Number.isInteger(m.swipe_id)?m.swipe_id:0;
    const swipes=(Array.isArray(m.swipes)&&m.swipes.length)?m.swipes:[m.mes];
    for(let j=0;j<swipes.length;j++) {
      const raw=String(swipes[j]??''); if(!raw.trim())continue;
      const id=sourceId(i,j,raw);
      result.push({id,index:i,swipe:j,role:m.is_user?'user':'assistant',name:String(m.name??''),date:String(m.send_date??''),raw,active:j===selected,deleted:false});
    }
  }
  return result;
}
export function mergeSources(archive, snapshots, indices=null) {
  const byId=new Map(archive.sources.map((s,i)=>[s.id,i]));let inserted=0,changed=0;
  const selectedByIndex=new Map();
  for(const s of snapshots)if(s.active)selectedByIndex.set(s.index,s.id);
  if(indices)for(const old of archive.sources)if(indices.has(old.index)){
    const shouldBeActive=selectedByIndex.get(old.index)===old.id;
    if(old.active!==shouldBeActive){old.active=shouldBeActive;changed++;}
  }
  for(const s of snapshots){if(byId.has(s.id)){
    const old=archive.sources[byId.get(s.id)];if(old.active!==s.active||old.deleted){old.active=s.active;old.deleted=false;changed++;}
  } else {archive.sources.push(s);byId.set(s.id,archive.sources.length-1);inserted++;}}
  if(inserted||changed)archive.revision++;return {inserted,changed};
}
export function syncActiveSources(archive, chat) {
  const active=new Set(snapshotChat(chat).filter(s=>s.active).map(s=>s.id));
  let changed=0;
  for(const s of archive.sources){const v=active.has(s.id); if(s.active!==v){s.active=v;changed++;}}
  if(changed)archive.revision++;return changed;
}
export function splitMemoryBook(text) {
  const original=String(text??'');const sections=[];let title='Introduction', buffer=[];
  const flush=()=>{for(const block of buffer.join('\n').split(/\n\s*\n/g)) {
    const raw=block.trim();if(!raw)continue;
    // Dividing long paragraphs preserves every byte in the original `imports` source.
    if(raw.length<=3500){sections.push({heading:title,raw});continue;}
    for(let p=0;p<raw.length;p+=3200) sections.push({heading:title,raw:raw.slice(p,p+3200)});
  }buffer=[];};
  for(const line of original.split(/\r?\n/)){
    const isHeader=/^\s*(?:\[.{3,140}\]|#{1,4}\s+.{3,140}|(?:MEMORY BOOK|Events Chronicle|Main characters)[^\n]{0,100})\s*$/i.test(line);
    if(isHeader){flush();title=line.replace(/^\s*#+\s*/,'').replace(/^\[|\]$/g,'').trim();}else buffer.push(line);
  }flush();return sections;
}
export function guessShelves(heading, text='') {
  const t=cleanText(`${heading} ${text.slice(0,120)}`).toLowerCase(); const shelves=[];
  const tests=[
    ['chronology',/chronicle|хронолог|events|дата|событи|—\s*(?:mon|tue|wed|thu|fri|sat|sun|понед|вторн|среда|четверг)/],
    ['people',/character|персонаж|appearance|личност|внешност|родственн/],
    ['relationships',/relationship|отношени|romantic|любов|дружб|роман/],
    ['promises',/promise|обещани|долг|клятв|fulfilled/],
    ['items',/item|inventory|предмет|вещ|артефакт|инвентар/],
    ['knowledge',/knowledge|кто знает|знани|ведом|известн/],
    ['locations',/location|visited|локаци|места|посещенн/],
    ['secrets',/secret|тайн|секрет|reader-only|скрыт/],
    ['quotes',/phrase|quote|цитат|фраз|слова|gestur|жест/],
    ['threads',/subplot|future|plotline|сюжет|план|незаверш/],
    ['arcs',/\barc\b|арка|сюжетн.{0,8}арк|exam arc|story arc/],
  ];for(const [name,re] of tests)if(re.test(t))shelves.push(name);return shelves.length?shelves:['other'];
}
/** Return the complete original recap from a source message, without summarizing it.
 * The enclosing markup is omitted for display; all recap body characters remain intact.
 * Original markup and text are always preserved unchanged in archive.sources[].raw. */
export function extractFullRecap(raw) {
  const input=String(raw??'');
  const details=input.match(/<details\b[^>]*>\s*<summary\b[^>]*>\s*recap\s*<\/summary>\s*([\s\S]*?)<\/details>/i);
  if(details)return details[1];
  const english=input.match(/<en\b[^>]*>([\s\S]*?)<\/en>/i);
  if(!english)return '';
  const text=english[1].trim();
  // Older RP templates may write recap directly in <en> without <details>.
  return /<details\b|<summary\b/i.test(text)?'':text;
}
const recapCache=new WeakMap();
/** Recaps are a source-backed virtual shelf. They are NOT generated facts:
 * rebuilding atomic facts can never erase or modify the original recaps. */
export function fullRecapRecords(archive,{includeInactive=false}={}) {
  if(!archive)return [];
  if(!includeInactive){
    const cached=recapCache.get(archive);
    if(cached?.revision===archive.revision)return cached.records;
  }
  const records=[];
  for(const source of archive.sources??[]){
    if(source.deleted||source.role!=='assistant'||(!includeInactive&&!source.active))continue;
    const text=extractFullRecap(source.raw);
    if(!text.trim())continue;
    records.push({
      id:`recap:${source.id}`,shelf:'recaps',text,
      messageIndex:source.index,swipe:source.swipe,sourceId:source.id,
      sourceIds:[source.id],sourceDate:source.date??'',
    });
  }
  records.sort((a,b)=>b.messageIndex-a.messageIndex||b.swipe-a.swipe);
  if(!includeInactive)recapCache.set(archive,{revision:archive.revision,records});
  return records;
}

export function importMemoryBook(archive, input, {label='Memory Book',url=''}={}) {
  const text=String(input??'');if(!text.trim())throw Error('Memory Book is empty');
  const digest=`book-${hash(text)}-${text.length}`;
  if(archive.imports.some(x=>x.id===digest))return {duplicate:true,count:0,missing:[]};
  const chunks=splitMemoryBook(text); const source={id:digest,label,raw:text,url,importedAt:new Date().toISOString(),count:chunks.length};
  archive.imports.push(source);
  const created=chunks.map((chunk,i)=>({id:`${digest}:${i}`,sourceId:digest,heading:chunk.heading,raw:chunk.raw,shelves:guessShelves(chunk.heading,chunk.raw),terms:terms(chunk.raw),importedAt:source.importedAt}));
  archive.chunks.push(...created);
  const missing=created.filter(x=>!x.shelves.length||!x.raw).map(x=>x.id);
  archive.revision++;
  return {duplicate:false,count:created.length,missing,sourceId:digest};
}
export function normalizeFact(input, batchIds, archive) {
  if(!input || typeof input!=='object') return null;
  const shelf=SHELVES[input.shelf]?input.shelf:'other';
  const text=cleanText(input.text).slice(0,1800);if(text.length<4)return null;
  const refs=[...new Set((Array.isArray(input.source_ids)?input.source_ids:[]).map(String).filter(id=>batchIds.includes(id)))];
  if(!refs.length)return null;
  const people=(Array.isArray(input.people)?input.people:[]).map(cleanText).filter(Boolean).slice(0,12);
  const tags=(Array.isArray(input.tags)?input.tags:[]).map(cleanText).filter(Boolean).slice(0,20);
  const knowledge=cleanText(input.knowledge_holder??'');
  const entityKey=cleanText(input.entity_key??'').slice(0,220);
  const promiseStatus=['unknown','pending','fulfilled','broken','cancelled'].includes(input.promise_status)?input.promise_status:'unknown';
  const arcStatus=['unknown','planned','active','completed','paused','abandoned'].includes(input.arc_status)?input.arc_status:'unknown';
  const knowledgeState=['unknown','knows','believes','suspects','unaware'].includes(input.knowledge_state)?input.knowledge_state:'unknown';
  if(shelf==='knowledge'&&(!knowledge||knowledge.toLocaleLowerCase()==='reader-only'||knowledgeState==='unknown'))return null;
  const certainty=['confirmed','belief','possibility'].includes(input.certainty)?input.certainty:'belief';
  const lifecycle=['active','closed','historical'].includes(input.lifecycle)?input.lifecycle:'historical';
  // Content identity allows the same fact to retain citations from both a legacy book and new chat.
  // A status transition is a new immutable fact revision, even when its
  // wording is identical to an earlier one (especially for promises/arcs).
  const statusSuffix=shelf==='promises'?`|promise:${promiseStatus}`:
    shelf==='arcs'?`|arc:${arcStatus}`:
    shelf==='knowledge'?`|knowledge:${knowledgeState}`:'';
  const id=`f-${hash(shelf+'|'+text.toLocaleLowerCase()+statusSuffix)}-${text.length}`;
  return {id,shelf,text,people,tags,knowledge,entityKey,promiseStatus,arcStatus,knowledgeState,certainty,lifecycle,sourceIds:refs,createdAt:new Date().toISOString(),terms:terms([text,...people,...tags].join(' '))};
}
export function addFacts(archive, sourceIds, candidates) {
  const added=[];let touched=0;const existing=new Map(archive.facts.map(f=>[f.id,f]));
  for(const input of (Array.isArray(candidates)?candidates:[]).slice(0,120)){
    const f=normalizeFact(input,sourceIds,archive);if(!f)continue;
    const previous=existing.get(f.id)??archive.facts.find(x=>x.shelf===f.shelf&&x.text===f.text&&
      x.promiseStatus===f.promiseStatus&&x.arcStatus===f.arcStatus&&x.knowledgeState===f.knowledgeState&&
      x.knowledge===f.knowledge&&x.entityKey===f.entityKey);
    if(previous){const refs=new Set(previous.sourceIds);for(const id of f.sourceIds)refs.add(id);
      if(refs.size!==previous.sourceIds.length){previous.sourceIds=[...refs];touched++;}
      continue;
    }
    archive.facts.push(f);existing.set(f.id,f);added.push(f);
  }
  if(added.length||touched)archive.revision++;return added;
}
/** Fail closed: never fabricate missing JSON punctuation or silently swallow a broken fact. */
export function parseJsonReply(reply) {
  if(reply && typeof reply === 'object') {
    // Some providers return a rich content block rather than a plain string.
    if(Array.isArray(reply)) {
      const parts=reply.map(p=>typeof p==='string'?p:(p?.text??p?.content??'')).filter(x=>typeof x==='string');
      if(parts.length)return parseJsonReply(parts.join('\n'));
    }
    return reply;
  }
  const value=String(reply??'').trim();
  const text=value.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  try{return JSON.parse(text);}catch(initialError) {
    const first=text.indexOf('{'),last=text.lastIndexOf('}');
    if(first>=0&&last>first&&(first!==0||last!==text.length-1)) {
      try{return JSON.parse(text.slice(first,last+1));}catch{}
    }
    // Do not log or persist the provider's response: it may include private RP data.
    throw Error(`Archivist returned invalid JSON (${initialError.message}). No facts from this attempt were saved.`);
  }
}

/** Split an imported paragraph into discrete bullet-level extraction units.
 * The stable parent chunk ID is retained as a source citation. Originals are immutable. */
export function segmentLegacyChunk(chunk,{maxCharacters=1150}={}) {
  const raw=String(chunk.raw??'');
  const units=[];
  const lines=raw.split(/\r?\n/);
  let buffer='';
  const flush=()=>{if(buffer.trim())units.push(buffer.trim());buffer='';};
  for(const line of lines){
    const bullet=/^\s*(?:[-*•]\s+|\d+[.)]\s+)/.test(line);
    if(bullet)flush();
    if((buffer+'\n'+line).length>maxCharacters && buffer)flush();
    if(line.length>maxCharacters){
      flush();
      for(let i=0;i<line.length;i+=maxCharacters)units.push(line.slice(i,i+maxCharacters));
    } else buffer+=(buffer?'\n':'')+line;
  }
  flush();
  const result=[];let current='';
  const send=()=>{if(current.trim()){result.push(current.trim());current='';}};
  for(const unit of units){
    if(current && (current.length+unit.length+1)>maxCharacters)send();
    current+=(current?'\n':'')+unit;
  }
  send();
  return result.map((text,i)=>({id:chunk.id,heading:chunk.heading,raw:text,part:i+1,total:result.length}));
}

/** Latest explicit promise/arc update takes precedence for the display.
 * Every historical update stays in archive.facts with its own citation. */
export function currentStateRecords(facts,shelf) {
  const selected=[];const seen=new Set();
  for(let i=facts.length-1;i>=0;i--){
    const f=facts[i];if(f.shelf!==shelf)continue;
    const key=cleanText(f.entityKey).toLocaleLowerCase();
    if(key){if(seen.has(key))continue;seen.add(key);}
    selected.push(f);
  }
  return selected;
}
/** Choose tiny, source-preserving legacy jobs, rather than five large paragraphs
 * whose large JSON answer frequently exceeds a cheap model's output budget. */
export function planLegacyJobs(chunks, {maxChunks=2,maxCharacters=2600}={}) {
  const jobs=[];let job=[],length=0;
  for(const chunk of chunks) {
    const size=String(chunk.raw??'').length;
    if(job.length&&(job.length>=maxChunks||length+size>maxCharacters)){
      jobs.push(job);job=[];length=0;
    }
    job.push(chunk);length+=size;
  }
  if(job.length)jobs.push(job);
  return jobs;
}

/** Retries are deliberately source-preserving: one bad model reply cannot
 * mark the chunk as processed or corrupt a previously imported Memory Book. */
export async function requestLegacyFacts(chunks, request, {maxAttempts=2,maxTokens=2200,onRetry=()=>{}}={}) {
  let lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const maxFacts=attempt===1?12:8;
    const prompt=[
      {role:'system',content:`You extract ATOMIC, source-cited facts from a fictional roleplay archive. Return ONLY compact valid JSON {"facts":[...]}. Each object: {"shelf":"chronology|people|relationships|promises|items|knowledge|locations|secrets|quotes|threads|arcs|other","text":"one concise standalone fact","people":[],"tags":[],"entity_key":"stable key for the SAME promise, object, person or arc across updates, or empty","promise_status":"unknown|pending|fulfilled|broken|cancelled","arc_status":"unknown|planned|active|completed|paused|abandoned","knowledge_holder":"NPC name or reader-only","knowledge_state":"unknown|knows|believes|suspects|unaware","certainty":"confirmed|belief|possibility","lifecycle":"active|closed|historical","source_ids":["EXACT source id"]}.
CRITICAL: one separate item per object, one separate promise per record, one quote/gesture per record. Separate concluded ARC from ongoing THREAD. A secret is ONLY intentionally concealed/restricted information, NOT any line under a loosely classified heading. Ignore book title, instructions, table of contents and administrative preface; these are not world facts. Knowledge shelf ONLY when text explicitly establishes who heard, witnessed, learned, knows, suspects or does not know a fact; never infer knowledge from narrator access. Promise status 'fulfilled' ONLY if execution is explicitly evidenced in the source, 'pending' if explicitly outstanding, otherwise 'unknown'. Never treat a historical fact as an active promise without evidence. No predictions. Do not reproduce entire paragraphs. Max ${maxFacts} facts, cite every fact, keep source language and relevant emotional details. Escape JSON characters. If none, return {"facts":[]}.`},
      {role:'user',content:JSON.stringify({chunks:chunks.map(c=>({id:c.id,heading:c.heading,part:c.part,total:c.total,text:c.raw}))})},
    ];
    try{
      const result=await request(prompt,maxTokens,attempt);
      const data=parseJsonReply(result);
      if(!data||!Array.isArray(data.facts))throw Error('Archivist JSON has no facts array');
      return data.facts;
    }catch(e){
      lastError=e;
      if(attempt<maxAttempts)onRetry({attempt,reason:e.message});
    }
  }
  throw Error(`Legacy extraction failed after ${maxAttempts} attempts: ${lastError?.message??'unknown error'}`);
}
export function activeFact(f,archive) {
  const chunkIds=new Set(archive.chunks.map(x=>x.id));
  return f.sourceIds.some(id=>chunkIds.has(id)||archive.sources.some(s=>s.id===id&&s.active&&!s.deleted));
}
/** A remembered event is evidence for continuity, not a directive to replay the past. */
const RECOLLECTION_CUE = /(?:\b(?:remember|recall|reminisc|flashback|backstory|years ago|last time)\b|помнишь|помнят|помнил|помнила|вспомни|вспомина|вспомнил|вспомнила|воспомин|в прошлом|в детстве|много лет назад|давным-давно|тот самый день)/iu;
function matchEvidence(item, queryTerms) {
  const indexed=new Set(item.terms??terms(item.raw??item.text));
  const matched=queryTerms.filter(word=>indexed.has(word));
  const personTerms=new Set(terms((item.people??[]).join(' ')));
  // Matching only a familiar character's name is not enough to replay an old episode.
  const concrete=matched.filter(word=>!personTerms.has(word));
  return {matched,concrete};
}
function isHistoricalMemory(entry) {
  const item=entry.item;
  if(entry.kind==='recap')return true;
  if(entry.kind==='legacy') return item.shelves?.includes('chronology')||item.shelves?.includes('quotes')||item.shelves?.includes('other');
  return ['chronology','quotes'].includes(item.shelf)||['closed','historical'].includes(item.lifecycle);
}
/** A character can carry tiny background associations without narrating their source scene.
 * Only structured, source-linked memories with explicit participants qualify; an
 * imported unclassified paragraph is never treated as an ambient character cue.
 */
function isCharacterAnchor(entry, evidence, recollectionRequested) {
  if(entry.kind!=='fact'||!isHistoricalMemory(entry)||recollectionRequested)return false;
  if(!['chronology','quotes'].includes(entry.item.shelf))return false;
  const participantTerms=new Set(terms((entry.item.people??[]).join(' ')));
  return evidence.matched.some(word=>participantTerms.has(word));
}
function scored(item, queryTerms, evidence) {
  const {matched}=evidence;
  if(!matched.length)return -Infinity;
  let score=0;
  for(const word of matched)score+=2+Math.min(word.length,12)/10;
  if(item.lifecycle==='active')score+=1;
  if(item.certainty==='possibility')score-=1;
  return score;
}
/** Find an excerpt around matching terms for the MODEL only.
 * The full unmodified recap is always available on the separate recap shelf. */
export function recapContextExcerpt(fullText, words, maxLength=1250){
  const text=String(fullText??'');if(text.length<=maxLength)return text;
  const lower=text.toLocaleLowerCase();
  const spots=words.map(w=>lower.indexOf(w)).filter(i=>i>=0).sort((a,b)=>a-b);
  const center=spots.length?spots[Math.floor(spots.length/2)]:0;
  const start=Math.max(0,Math.min(center-180,text.length-maxLength));
  const excerpt=text.slice(start,start+maxLength);
  return `${start?'[excerpt of archived recap] ':'[archived recap, excerpt] '}${excerpt}${start+maxLength<text.length?' …':''}`;
}

/**
 * Automatic mode uses THREE layers: present continuity, a tiny character-texture
 * cue, and relevant complete historical details. Name-only matches may supply a
 * texture cue, but NEVER a complete historical episode. Manual search is broader.
 */
export function retrieve(archive, query, {maxCharacters=6500,maxItems=18,mode='search',maxAnchors=1}={}) {
  const rawQuery=String(query).slice(-4500);
  const words=terms(rawQuery),automatic=mode==='automatic';
  const recollectionRequested=RECOLLECTION_CUE.test(rawQuery);
  const scoredItems=[];
  const activeIds=new Set(archive.sources.filter(s=>s.active&&!s.deleted).map(s=>s.id));
  for(const c of archive.chunks)activeIds.add(c.id);
  const addEntry=(kind,item)=>{
    const entry={kind,item},historical=isHistoricalMemory(entry);
    const evidence=matchEvidence(item,words);
    if(!evidence.matched.length)return;
    let anchor=false;
    if(automatic&&historical&&!recollectionRequested){
      // Old scenes only enter in full on a clear specific cue. When just a
      // character is present, allow ONE short associative detail for texture.
      const detailed=kind==='fact'&&evidence.matched.length>=2&&evidence.concrete.length>=1;
      if(!detailed){
        if(!isCharacterAnchor(entry,evidence,recollectionRequested))return;
        anchor=true;
      }
    }
    const score=scored(item,words,evidence)+(kind==='fact'?0.5:0)-(anchor?2:0);
    if(Number.isFinite(score))scoredItems.push({...entry,historical,anchor,score});
  };
  for(const f of archive.facts)if(f.sourceIds.some(id=>activeIds.has(id)))addEntry('fact',f);
  for(const ch of archive.chunks)if(!automatic||!archive.facts.some(f=>f.sourceIds.includes(ch.id)))addEntry('legacy',ch);
  // Exact source recaps are searchable without creating duplicate model facts.
  // A background RP prompt must match several concrete details before a recap
  // may enter; mentioning an NPC by name is never enough.
  for(const recap of fullRecapRecords(archive)){
    if(!recap.terms)recap.terms=terms(recap.text,700);
    const index=new Set(recap.terms);
    const matched=words.filter(w=>index.has(w));
    if(!matched.length)continue;
    if(automatic&&!recollectionRequested&&
      (matched.length<4||matched.filter(w=>w.length>=5).length<3))continue;
    const score=matched.length*2 + matched.filter(w=>w.length>=6).length*.35 - 3;
    scoredItems.push({kind:'recap',item:recap,historical:true,anchor:false,score});
  }
  scoredItems.sort((a,b)=>b.score-a.score||String(a.item.id).localeCompare(String(b.item.id)));
  const results=[],seen=new Set();let chars=0,historicalCount=0,anchorCount=0,recapCount=0;
  const historyCap=automatic?Math.max(1,Math.min(3,Math.floor(maxItems/4))):maxItems;
  const anchorCap=automatic?Math.max(0,Math.min(1,maxAnchors)):maxItems;
  for(const entry of scoredItems){if(results.length>=maxItems)break;
    if(automatic&&entry.anchor&&anchorCount>=anchorCap)continue;
    if(automatic&&entry.kind==='recap'&&recapCount>=1)continue;
    if(automatic&&entry.historical&&!entry.anchor&&historicalCount>=historyCap)continue;
    const item=entry.item;
    const fullText=entry.kind==='fact'?item.text:entry.kind==='recap'?recapContextExcerpt(item.text,words,1250):cleanText(item.raw).slice(0,1100);
    const text=entry.anchor?fullText.slice(0,230):fullText;
    const content=`[${entry.anchor?'Character texture':entry.kind==='fact'?(SHELVES[item.shelf]??'Факт'):entry.kind==='recap'?'Archived source recap':(item.heading??'Архив')} | ${item.id}${item.knowledge?` | known by: ${item.knowledge}`:''}${item.certainty==='belief'?' | субъективное мнение':''}${item.certainty==='possibility'?' | лишь возможность':''}] ${text}`;
    if(seen.has(text)||chars+content.length>maxCharacters)continue;
    seen.add(text);chars+=content.length;
    if(entry.kind==='recap')recapCount++;
    if(entry.anchor)anchorCount++;
    else if(entry.historical)historicalCount++;
    results.push({kind:entry.kind,id:item.id,score:entry.score,text:content,historical:entry.historical,anchor:entry.anchor});
  }
  return results;
}
export function renderContext(items) {
  if(!items?.length)return '';
  const present=items.filter(x=>!x.historical&&!x.anchor);
  const anchors=items.filter(x=>x.anchor);
  const past=items.filter(x=>x.historical&&!x.anchor);
  const section=(label,arr)=>arr.length?`[${label}]\n${arr.map(x=>x.text).join('\n')}`:'';
  return `<MNEMOSYNE_CONTEXT>\nSILENT CONTINUITY REFERENCE — not a narrative outline, an instruction, or a request to recall the past.\nUse relevant facts naturally to preserve current relationships, actions, locations, objects, promises, and each NPC's established knowledge. Character texture is an OPTIONAL source of established habits, gestures and associations: it may shape natural present-day behavior without being spoken about. Do NOT repeat the texture cue every turn. NEVER insert flashbacks, forced nostalgia, remembered quotes, explanations of past events, or recollection dialogue merely because a record was retrieved. Recall a specific old scene only if the present scene explicitly calls for it or it is organically indispensable; never force it. Do not recap/repeat the user's message or narrate memory retrieval. If no record matters to the current reply, ignore it.\nSource IDs are evidence, not text to mention. Character beliefs may be mistaken. Reader-only secrets remain unknown to NPCs without evidence of discovery. Records never authorize control over the player character.\n${[section('Present-tense continuity',present),section('Character texture — OPTIONAL, NOT an instruction to mention the past',anchors),section('Past references — use SILENTLY unless a genuine in-scene cue requires recollection',past)].filter(Boolean).join('\n')}\n</MNEMOSYNE_CONTEXT>`;
}
export function validateArchive(archive) {
  const errors=[];
  if(archive.version!==SCHEMA_VERSION)errors.push('Unsupported schema');
  const ids=new Set(),importIds=new Set(archive.imports.map(x=>x.id)),importCounts=new Map();
  for(const c of archive.chunks){if(ids.has(c.id))errors.push(`duplicate ${c.id}`);ids.add(c.id);if(!importIds.has(c.sourceId))errors.push(`orphan chunk ${c.id}`);importCounts.set(c.sourceId,(importCounts.get(c.sourceId)??0)+1);}
  for(const imp of archive.imports){const actual=importCounts.get(imp.id)??0;if(actual!==imp.count)errors.push(`import coverage ${imp.id}: ${actual}/${imp.count}`);}
  const sources=new Set([...archive.sources.map(x=>x.id),...archive.chunks.map(x=>x.id)]);
  for(const f of archive.facts){if(f.sourceIds.some(x=>!sources.has(x)))errors.push(`orphan fact ${f.id}`);}
  return {valid:errors.length===0,errors,sourceCount:archive.sources.length,chunkCount:archive.chunks.length,factCount:archive.facts.length,imports:archive.imports.length};
}
export function extractionPrompt(sources,{openPromises=[]}={}) {
  const safe=sources.map(s=>({id:s.id,role:s.role,name:s.name,text:extractionView(s)}));
  return [
    {role:'system',content:`You are a strict, non-fictionalizing extractor for FICTIONAL roleplay. Output ONLY compact valid JSON: {"facts":[{"shelf":"chronology|people|relationships|promises|items|knowledge|locations|secrets|quotes|threads|arcs|other","text":"one atomic claim","people":[],"tags":[],"entity_key":"stable identity of promise, item or arc","promise_status":"unknown|pending|fulfilled|broken|cancelled","arc_status":"unknown|planned|active|completed|paused|abandoned","knowledge_holder":"NPC name or reader-only","knowledge_state":"unknown|knows|believes|suspects|unaware","certainty":"confirmed|belief|possibility","lifecycle":"active|closed|historical","source_ids":["exact source id"]}]}. One distinct item, quote, promise or arc PER record. A mere offer or wish is not a promise; an ambition belongs in people/threads. Objects go to items; one-time actions go to chronology. NPC knowledge means information actually learned or explicitly not learned, not ordinary narration of what someone did. Keep original language and distinctive emotional gestures. Track promise fulfillment only upon explicit completion evidence; never assume merely from time passing. Reuse the entity_key of an existing promise when a new message changes its status, and cite the NEW message. Identify NPC knowledge ONLY when scene explicitly shows hearing, witnessing, disclosure, belief or ignorance. Reader-only secrets are never NPC knowledge. Separate completed arcs from active story threads. Ignore book title/preface and formatting metadata. No guessed events, no predicted outcomes, no incompatible swipe merges. Max 20 atomic facts; keep JSON compact; if no new durable information return {"facts":[]}.`},
    {role:'user',content:JSON.stringify({task:'Extract durable atomic facts and any explicitly evidenced status changes',openPromises:openPromises.slice(0,35),messages:safe})}
  ];
}

/** Only explicit provider policy/safety reasons count as content refusal.
 * Generic API/network errors must not silently skip historical sources. */
export function isContentPolicyRejection(error) {
  if (!error) return false;
  const nested=[error,error?.cause,error?.response?.data,error?.response?.data?.error,error?.error,
    error?.details,error?.data].filter(Boolean);
  const parts=[];
  for (const v of nested) {
    if(typeof v==='string')parts.push(v);
    else if(typeof v==='object')for(const k of ['message','code','status','statusText','reason','finishReason','blockReason','blockedReason'])
      if(typeof v[k]==='string')parts.push(v[k]);
  }
  return /(?:PROHIBITED[_ -]?CONTENT|CONTENT[_ -]?POLICY|CONTENT[_ -]?FILTER|PROMPT[_ -]?BLOCKED|SAFETY[_ -]?(?:FILTER|BLOCK|REJECT|REASON)|BLOCK[_ -]?REASON|HARM[_ -]?CATEGORY)/i.test(parts.join(' '));
}

/** Diagnostic-only summary; does not try to silently "repair" conflicting canon. */
export function auditArchive(archive) {
  const facts=archive?.facts??[], sources=archive?.sources??[], batches=archive?.batches??[];
  const covered=new Set(batches.filter(b=>['done','blocked'].includes(b.status)).flatMap(b=>b.sourceIds??[]));
  const selected=sources.filter(s=>s.active&&!s.deleted);
  const imported=facts.filter(f=>f.sourceIds?.some(x=>String(x).startsWith('book-')));
  const chatFacts=facts.filter(f=>f.sourceIds?.some(x=>String(x).startsWith('m')));
  const statuses={};
  for(const shelf of Object.keys(SHELVES))if(shelf!=='recaps')statuses[shelf]=facts.filter(x=>x.shelf===shelf).length;
  const suspectedKeyVariants=[];
  for(const shelf of ['items','promises','relationships','arcs']) {
    const groups=new Map();
    for(const f of facts.filter(x=>x.shelf===shelf && x.entityKey)) {
      const normalized=cleanText(f.entityKey).toLowerCase().replace(/[\s_]+/g,'-');
      const values=groups.get(normalized)??[];values.push(f.entityKey);groups.set(normalized,values);
    }
    for(const [key,values] of groups)if(new Set(values).size>1)suspectedKeyVariants.push({shelf,key,variants:[...new Set(values)]});
  }
  return {
    selectedSources:selected.length,
    alternativeSources:sources.length-selected.length,
    activeAssistantRecaps:fullRecapRecords(archive).length,
    importedFacts:imported.length,chatFacts:chatFacts.length,
    completedBatches:batches.filter(b=>b.status==='done').length,
    blockedBatches:batches.filter(b=>b.status==='blocked').length,
    unprocessedSelected:selected.filter(s=>!covered.has(s.id)).length,
    perShelf:statuses,
    warnings:[
      ...(batches.some(b=>b.status==='blocked')?['Есть пропущенные пакеты: исходники сохранены, факты из них НЕ извлечены.']:[]),
      ...(imported.length>chatFacts.length*5?['Большая часть фактов взята из старой Memory Book, а не проверена по исходному чату.']:[]),
      ...(archive?.imports?.some(x=>(x.raw??'').length<200)?['Есть импортированный документ короче 200 символов: проверь, не была ли случайно импортирована инструкция.']:[]),
      ...(suspectedKeyVariants.length?['Некоторые entity_key отличаются лишь форматом написания; проверь объединение записей.']:[]),
    ],
    suspectedKeyVariants,
  };
}

/** Small extraction batches reduce the chance that thinking-capable providers
 * exhaust their completion budget before they finish JSON. Originals are never
 * shortened or changed in the stored archive. */
export function planChatBatches(sources,{maxSources=2}={}) {
  const size=Math.max(1,Math.min(6,Math.floor(Number(maxSources)||2)));
  const batches=[];
  for(let i=0;i<sources.length;i+=size)batches.push(sources.slice(i,i+size));
  return batches;
}
export function isJsonExtractionError(error) {
  return /(?:invalid JSON|JSON missing facts array|JSON has no facts array|Unexpected end of JSON input)/i.test(String(error?.message??''));
}
export function retryOutputTokens(current, ceiling=32768) {
  const value=Math.max(1024,Math.min(ceiling,Math.floor(Number(current)||8192)));
  return Math.min(ceiling,Math.max(value+1024,Math.ceil(value*1.5)));
}

/** Source-based scheduling: no modulo timing, no automatic bill for imported old chat history. */
export function pendingExtraction(archive,{force=false}={}) {
  const processed=new Set((archive.batches??[]).filter(b=>['done','blocked'].includes(b.status)).flatMap(b=>b.sourceIds));
  const start=force?0:Math.max(0,Number(archive.autoStartIndex)||0);
  const sources=archive.sources.filter(s=>s.active&&!s.deleted&&!processed.has(s.id)&&s.index>=start);
  return {sources,assistantCount:sources.filter(s=>s.role==='assistant').length};
}

/** Extract a concise model-facing view, while retaining the unabridged source in archives. */
export function extractionView(source) {
  const raw=String(source.raw??'');
  if(source.role==='user')return cleanText(raw).slice(0,7000);
  const recap=extractFullRecap(raw);
  const prose=raw.match(/<ru>([\s\S]*?)<\/ru>/i)?.[1]||'';
  const easel=raw.match(/<([a-z][\w-]*_easel)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2]
    ||raw.match(/<easel\b[^>]*>([\s\S]*?)<\/easel\s*>/i)?.[1]||'';
  if(!recap&&!prose)return cleanText(raw).slice(0,14000);
  return [recap?`RECAP: ${cleanText(recap).slice(0,7800)}`:'',
    prose?`PROSE (selected): ${cleanText(prose).slice(0,3200)}`:'',
    easel?`EASEL (state, NOT canon forecasts): ${cleanText(easel).slice(0,2000)}`:''].filter(Boolean).join('\n');
}
