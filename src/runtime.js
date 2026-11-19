import {SHELVES,newArchive,snapshotChat,mergeSources,syncActiveSources,sourceId,importMemoryBook,parseJsonReply,addFacts,extractionPrompt,retrieve,renderContext,validateArchive,terms,hash,pendingExtraction,extractionView,planLegacyJobs,requestLegacyFacts,segmentLegacyChunk,currentStateRecords,activeFact,fullRecapRecords,isContentPolicyRejection,auditArchive,planChatBatches,isJsonExtractionError,retryOutputTokens,approximateInputTokens,locationShelfCards,isContextLimitError} from './core.js';
import {localGet,localPut,localDelete,serverGet,serverPut,serverDelete,downloadJson} from './storage.js';
import {wipeChatMemory} from './reset.js';
import {ConnectionManagerRequestService} from '../../../shared.js';
import {readSnapshot,diffReadSnapshot} from './read-markers.js';
const KEY='sola_mnemosyne_v1';
const BASE_SETTINGS={enabled:false,profileId:'',batchEvery:40,autoUpdate:true,maxTokens:8192,contextTokens:2400,recentLookback:2,autoBackup:true,archiveOnReceive:true,successNotifications:true,inputBudgetTokens:16000};
export const log=[];
let active=null, activeId='',queue=Promise.resolve(),lastInjection='',lastSyncCount=0,autoRunning=false,resetPending=false;
let indexing={running:false,stopRequested:false,mode:'',startedAt:null};
export function indexingState(){return {...indexing,lastError:active?.lastIndexError??null,progress:active?.indexProgress??null};}
/** Cooperative stop: current paid API request may finish, no next request starts. */
export function stopIndexing(){
  if(!indexing.running)return false;
  indexing.stopRequested=true;
  sendStatus('warn','Остановка запрошена: завершаю текущий запрос, следующий пакет не начнётся.');
  return true;
}
function beginIndex(mode){
  if(indexing.running)throw Error('Индексация уже запущена. Нажми «Остановить» либо дождись завершения.');
  indexing={running:true,stopRequested:false,mode,startedAt:new Date().toISOString()};
  document.dispatchEvent(new CustomEvent('mnemosyne:indexing-changed',{detail:indexingState()}));
}

function endIndex(){indexing={...indexing,running:false,stopRequested:false};
  document.dispatchEvent(new CustomEvent('mnemosyne:indexing-changed',{detail:indexingState()}));
}
export async function resumeIndexing(){
  if(indexing.running)throw Error('Индексация уже запущена.');
  if(active?.awaitingManualScan)throw Error('Сначала нажми «Обновить архив из чата».');
  if(active?.indexProgress?.mode==='legacy-rebuild')return processLegacy({rebuild:true});
  if(active?.indexProgress?.mode==='legacy')return processLegacy();
  return processBacklog({force:true});
}

// Short scene-local character texture should not be sent on every generation.
const generationTicks=new Map(),lastTextureTicks=new Map();
function ctx(){return SillyTavern.getContext();}
function sendStatus(level,message){const item={at:new Date().toLocaleTimeString(),level,message};log.unshift(item);if(log.length>80)log.length=80;document.dispatchEvent(new CustomEvent('mnemosyne:status',{detail:item})); if(level==='error')console.error('[Mnemosyne]',message);else console.info('[Mnemosyne]',message);}
function memoryUpdated(kind,message){
  document.dispatchEvent(new CustomEvent('mnemosyne:updated',{detail:{kind,message,at:new Date().toISOString()}}));
}
export function settings(){
  const s=ctx().extensionSettings;
  if(!s[KEY])s[KEY]=structuredClone(BASE_SETTINGS);
  for(const [k,v] of Object.entries(BASE_SETTINGS))if(!(k in s[KEY]))s[KEY][k]=v;
  // Earlier releases never exposed maxTokens in the UI; 2200 was an internal
  // default, not a deliberate user choice. Upgrade it once without touching
  // contextTokens (the RP memory budget, which users may have customized).
  if(!s[KEY].archivistBudgetMigrated){
    if(s[KEY].maxTokens===2200)s[KEY].maxTokens=8192;
    s[KEY].archivistBudgetMigrated=true;
    ctx().saveSettingsDebounced();
  }
  return s[KEY];
}
export function saveSettings(){ctx().saveSettingsDebounced();}
export function connectionProfiles(){try{return ConnectionManagerRequestService.getSupportedProfiles();}catch(e){sendStatus('warn',`Connection Profiles: ${e.message}`);return [];}}
function chatIdentity(){const c=ctx();return String(c.getCurrentChatId?.()??c.chatId??'');}
function meta(){return ctx().chatMetadata?.[KEY]??null;}
function currentMeta(){return ctx().chatMetadata??null;}
function enqueue(task){queue=queue.catch(()=>{}).then(task);return queue;}
async function persist(){if(active)await localPut(active);}
export function currentArchive(){return active;}
export function currentIdentity(){return activeId;}
/** Erase all Mnemosyne data for THIS chat, including imports, facts, recap
 * copies, processing markers and read receipts. Original ST chat untouched. */
export async function resetCurrentChat(){
  if(!active||!activeId)throw Error('Открой сохранённый чат для сброса памяти.');
  if(resetPending)throw Error('Сброс уже выполняется.');
  if(indexing.running)throw Error('Сначала останови индексацию и дождись завершения текущего запроса.');
  const expected=active,chatId=activeId;
  resetPending=true;
  // Do not let the previously injected memory survive the reset.
  try{ctx().setExtensionPrompt('SOLA_MNEMOSYNE','',1,1,false);}catch{}
  try{return await enqueue(async()=>{
    if(active!==expected||activeId!==chatId||chatIdentity()!==chatId)
      throw Error('Чат изменился до сброса; ничего не удалено.');
    const c=ctx();
    const result=await wipeChatMemory({
      oldArchive:expected,chatId,chatLength:c.chat?.length??0,
      chatMetadata:c.chatMetadata,metadataKey:KEY,
      createArchive:newArchive,putLocal:localPut,deleteLocal:localDelete,
      saveMetadata:()=>c.saveMetadata(),deleteServer:serverDelete,
      newId:()=>crypto.randomUUID(),
      assertSameChat:()=>chatIdentity()===chatId&&active===expected,
    });
    active=result.archive;
    lastSyncCount=0;lastInjection='';
    generationTicks.delete(chatId);lastTextureTicks.delete(chatId);
    log.length=0;
    sendStatus(result.cleanupErrors.length?'warn':'info',
      result.cleanupErrors.length
        ?`Создан чистый архив. Предыдущие копии удалены не полностью: ${result.cleanupErrors.join('; ')}`
        :'Полный сброс памяти этого чата завершён. Теперь можешь сканировать исходный чат заново.');
    return result;
  });}finally{resetPending=false;}
}

export function getStats(){return active?{...validateArchive(active),awaitingManualScan:!!active.awaitingManualScan,blockedBatches:(active.batches??[]).filter(x=>x.status==='blocked').length,chatId:active.chatId,lastSync:active.lastSync,pending:pendingExtraction(active).assistantCount,batchEvery:settings().batchEvery,indexing:indexingState(),recentLog:log.slice(0,8)}:null;}

/** Bind a new conversation to an independent archive (or fork a copied metadata pointer). */
export async function openChat(){return enqueue(async()=>{
  if(!currentMeta()) {active=null;activeId='';return null;}
  const id=chatIdentity();if(!id){active=null;activeId='';sendStatus('warn','Chat ID unavailable. Open a saved chat to use memory.');return null;}
  if(id===activeId&&active)return active;
  const m=meta();let identity=m?.archiveId;let next=null;let fork=false;
  if(m?.originChat && m.originChat!==id){fork=true;identity=crypto.randomUUID();}
  if(!identity)identity=crypto.randomUUID();
  try{next=await localGet(fork?m.archiveId:identity);}catch(err){sendStatus('warn',`Local archive unavailable: ${err.message}`);}
  if(!next && m?.serverPath){try{next=await serverGet(m.serverPath);}catch(err){sendStatus('warn',`Server snapshot unavailable: ${err.message}`);}}
  if(fork && next){next=structuredClone(next);next.lineage=next.chatId;next.chatId=identity;next.createdAt=new Date().toISOString();next.lastSync=null;next.revision++;}
  if(!next){next=newArchive(identity,m?.archiveId&&fork?m.archiveId:'');next.autoStartIndex=ctx().chat?.length??0;}
  // Existing archives from older builds get a safe auto-processing baseline too.
  if(!Number.isInteger(next.autoStartIndex))next.autoStartIndex=ctx().chat?.length??0;
  if(!Array.isArray(next.legacyBatches))next.legacyBatches=[];
  // Chat pointers are only bound after local archive is successfully persisted.
  await localPut(next);
  const metadata=currentMeta();metadata[KEY]={archiveId:identity,originChat:id,serverPath:fork?'':(m?.serverPath??'')};
  await ctx().saveMetadata();
  active=next;activeId=id;lastSyncCount=next.sources.length;
  if(!next.awaitingManualScan)await captureCurrentChat({all:!next.sources.length,quiet:true});
  // Establish a neutral baseline on first upgrade/install. Existing archives
  // aren't incorrectly marked as thousands of new entries on first display.
  if(!active.readReceipts){
    active.readReceipts={};
    for(const shelf of Object.keys(SHELVES))active.readReceipts[shelf]=readSnapshot(shelfRecords(shelf));
    await persist();
  }
  sendStatus('info',`${fork?'Forked':'Opened'} archive: ${identity.slice(0,8)}, ${next.facts.length} facts`);
  return next;
});}
export async function captureCurrentChat({all=false,quiet=false}={}){
  if(active?.awaitingManualScan)return {inserted:0,changed:0};
  if(!active)return {inserted:0};const c=ctx();if(!Array.isArray(c.chat))return {inserted:0};
  const start=all?0:Math.max(0,c.chat.length-5),entries=snapshotChat(c.chat,start);
  const result=mergeSources(active,entries,new Set(entries.map(x=>x.index)));
  if(result.inserted||result.changed){await persist();if(!quiet)sendStatus('info',`Archived ${result.inserted} source variants`);}
  return result;
}
export async function fullRescan({notify=false}={}){if(resetPending)throw Error('Дождись завершения сброса.');if(!active)throw Error('No chat');return enqueue(async()=>{
  const list=snapshotChat(ctx().chat);const result=mergeSources(active,list,new Set(list.map(x=>x.index)));
  syncActiveSources(active,ctx().chat);delete active.awaitingManualScan;await persist();sendStatus('info',`Full scan: ${result.inserted} new, ${result.changed} updated`);if(notify&&(result.inserted||result.changed))memoryUpdated('scan',`Архив обновлён · +${result.inserted}`);return result;
});}

/** Archived raw sources stay intact; only active swipe sources may affect retrieval. */
export async function archiveEvent(){if(resetPending||active?.awaitingManualScan||!settings().archiveOnReceive)return;
  await enqueue(async()=>{
    if(!active || activeId!==chatIdentity())return;
    const before=active.sources.length;await captureCurrentChat({quiet:true});
    const added=active.sources.length-before;
    if(added){sendStatus('info',`+${added} new source(s)`);if(settings().autoBackup&&active.sources.length-lastSyncCount>=20)await backupNow().catch(e=>sendStatus('error',e.message));}
  });
}
export async function selectSwipes(){return enqueue(async()=>{
  if(!active||activeId!==chatIdentity())return;
  const changed=syncActiveSources(active,ctx().chat);if(changed){await persist();sendStatus('info',`Active swipe records updated (${changed})`);}
});}
async function callArchivist(messages, maxTokens=1800){
  const p=settings().profileId;if(!p)throw Error('Choose a separate archivist Connection Profile');
  const profiles=ConnectionManagerRequestService.getSupportedProfiles();if(!profiles.find(x=>x.id===p))throw Error('Selected Connection Profile not available');
  const result=await ConnectionManagerRequestService.sendRequest(p,messages,maxTokens,
    {stream:false,extractData:true,includePreset:false,includeInstruct:false},
    {temperature:0.1,stream:false});
  return parseJsonReply(result?.content??result);
}
/** Batch extraction; broken response never marks a batch as complete. */
export async function processBacklog({force=false}={}){
  if(active?.awaitingManualScan)throw Error('После сброса сначала нажми «Обновить архив из чата».');
  if(!active)throw Error('No chat is open');if(!settings().profileId)throw Error('Select an archivist profile');
  beginIndex('chat');
  try{return await enqueue(async()=>{
    const target=active,identity=activeId;
    await captureCurrentChat({quiet:true});
    const {sources:candidates,assistantCount}=pendingExtraction(target,{force});
    if(!force&&assistantCount<settings().batchEvery)return {waiting:true,assistantCount};
    const totalSources=candidates.length;
    const inputCap=Math.max(4000,Math.min(50000,Number(settings().inputBudgetTokens)||16000));
    let count=0,created=0,blocked=0,completedSources=0;
    // The selected cap is an upper bound, not an exact token guarantee.
    const jobs=planChatBatches(candidates,{maxSources:100,maxInputTokens:inputCap})
      .map(sources=>({sources,tokenLimit:settings().maxTokens,retried:false}));
    target.indexProgress={mode:'chat',status:'running',totalSources,completedSources:0,doneBatches:0,startedAt:new Date().toISOString()};
    target.lastIndexError=null;await persist();
    for(let i=0;i<jobs.length;i++){
      if(indexing.stopRequested){target.indexProgress.status='stopped';await persist();break;}
      const job=jobs[i],batchSources=job.sources;
      const id=`batch-${hash(batchSources.map(x=>x.id).join('|'))}`;
      try{
        const openPromises=currentStateRecords(target.facts,'promises')
          .filter(f=>['unknown','pending'].includes(f.promiseStatus??'unknown')&&f.entityKey)
          .slice(0,20).map(f=>({entity_key:f.entityKey,text:f.text,status:f.promiseStatus}));
        const dynamicFacts=Math.max(25,Math.min(100,Math.floor(settings().maxTokens/115)));
        const reply=await callArchivist(extractionPrompt(batchSources,{openPromises,maxFacts:dynamicFacts}),job.tokenLimit);
        if(identity!==chatIdentity()||identity!==activeId||target!==active)
          throw Error('Чат изменился во время индексации; чужие факты не сохранены.');
        if(!Array.isArray(reply.facts))throw Error('Archivist JSON missing facts array');
        // If the model fills the entire output allowance it may have omitted
        // details. Split, rather than falsely mark the whole giant batch complete.
        if(reply.facts.length>=dynamicFacts && batchSources.length>1){
          const half=Math.ceil(batchSources.length/2);
          jobs.splice(i,1,{...job,sources:batchSources.slice(0,half)},
            {...job,sources:batchSources.slice(half)});
          i--;sendStatus('warn','Лимит фактов исчерпан: делю большой пакет для сохранения деталей.');continue;
        }
        const added=addFacts(target,batchSources.map(x=>x.id),reply.facts);
        target.batches.push({id,sourceIds:batchSources.map(x=>x.id),status:'done',facts:added.length,at:new Date().toISOString()});
        target.revision++;count++;created+=added.length;completedSources+=batchSources.length;
        target.indexProgress={...target.indexProgress,status:indexing.stopRequested?'stopping':'running',completedSources,doneBatches:count};
        target.lastIndexError=null;
        await persist();sendStatus('info',`Индексация: ${completedSources}/${totalSources} исходников · +${added.length} фактов`);
      }catch(err){
        if(identity!==chatIdentity()||target!==active)throw err;
        if(isContentPolicyRejection(err)){
          target.batches.push({id,sourceIds:batchSources.map(x=>x.id),status:'blocked',facts:0,
            reason:'provider_content_policy',at:new Date().toISOString()});
          target.diagnostics.push({at:new Date().toISOString(),kind:'content_blocked',id,
            message:'Provider policy refusal. Originals preserved; facts NOT extracted.'});
          target.revision++;blocked++;completedSources+=batchSources.length;
          target.indexProgress={...target.indexProgress,completedSources,status:'running',blocked};
          await persist();sendStatus('warn',`Провайдер отклонил пакет ${id}: сохранён оригинал, разметка пропущена.`);
          continue;
        }
        if(isContextLimitError(err)&&batchSources.length>1){
          const half=Math.ceil(batchSources.length/2);
          jobs.splice(i,1,{...job,sources:batchSources.slice(0,half)},
            {...job,sources:batchSources.slice(half)});
          i--;sendStatus('warn','Провайдер не принял большой вход: делю пакет, сохраняя исходники.');continue;
        }
        if(isJsonExtractionError(err)){
          if(!job.retried && job.tokenLimit<32768){
            jobs.splice(i,1,{...job,tokenLimit:retryOutputTokens(job.tokenLimit),retried:true});
            i--;sendStatus('warn','Некорректный JSON: повторяю с большим лимитом вывода.');continue;
          }
          if(batchSources.length>1){
            const half=Math.ceil(batchSources.length/2);
            jobs.splice(i,1,{sources:batchSources.slice(0,half),tokenLimit:settings().maxTokens,retried:false},
              {sources:batchSources.slice(half),tokenLimit:settings().maxTokens,retried:false});
            i--;sendStatus('warn','Некорректный JSON: делю пакет; уже сохранённые факты не трогаю.');continue;
          }
        }
        target.lastIndexError={id,firstMessageIndex:batchSources[0]?.index??null,
          sourceIds:batchSources.map(x=>x.id),message:String(err?.message||err),at:new Date().toISOString()};
        target.indexProgress={...target.indexProgress,status:'error',completedSources,failedBatchId:id};
        target.diagnostics.push({at:new Date().toISOString(),kind:'extract_error',id,message:String(err?.message||err)});
        await persist();sendStatus('error',`Остановка на пакете ${id} (сообщение #${(batchSources[0]?.index??0)+1}). После исправления нажми «Продолжить»: ${err.message}`);throw err;
      }
    }
    if(!indexing.stopRequested)target.indexProgress={...target.indexProgress,status:'done'};
    if(settings().autoBackup && (count||blocked)){
      try{await backupNow();}catch(err){sendStatus('warn',`Факты сохранены локально, но серверная копия не создана: ${err.message}`);}
    }
    await persist();
    if(count||blocked)memoryUpdated('extract',`${count} пакетов, +${created} фактов; ${blocked} отклонено`);
    return {batches:count,facts:created,blocked,stopped:indexing.stopRequested,completedSources,totalSources};
  });}finally{endIndex();}
}

/** Explicit opt-in for generic API errors that conceal their real cause.
 * A skipped batch remains part of the raw archive and cannot be mistaken for processed facts. */
export async function skipFailedBatch(){
  if(!active)throw Error('No chat is open');
  if(indexing.running)throw Error('Останови текущую обработку перед пропуском.');
  return enqueue(async()=>{
    await captureCurrentChat({quiet:true});
    const previous=active.lastIndexError;
    if(!previous?.id||!Array.isArray(previous.sourceIds)||!previous.sourceIds.length)
      throw Error('Нет сохранённой ошибки пакета. Нажми «Продолжить» для обычного повтора.');
    const remaining=new Set(pendingExtraction(active,{force:true}).sources.map(x=>x.id));
    if(!previous.sourceIds.every(id=>remaining.has(id)))
      throw Error('Ошибка относится к уже обработанным или неактивным сообщениям; пропуск запрещён.');
    if(!(active.diagnostics??[]).some(x=>x.id===previous.id&&x.kind==='extract_error'))
      throw Error('Не найдено подтверждение предыдущей ошибки.');
    const record={id:previous.id,sourceIds:[...previous.sourceIds],status:'blocked',facts:0,
      reason:'manually_skipped_after_error',at:new Date().toISOString()};
    active.batches.push(record);
    active.diagnostics.push({at:record.at,kind:'manual_skip',id:record.id,
      message:'Package skipped by user. Original sources retained, NO facts extracted.'});
    active.lastIndexError=null;active.revision++;await persist();
    sendStatus('warn',`Пропущен ровно ошибочный пакет ${record.id}; ${record.sourceIds.length} источников в архиве сохранены.`);
    return {id:record.id,messages:record.sourceIds.length};
  });
}

/** Automatically process only NEW assistant replies collected since activation. */
export async function maybeAutoProcess(){
  if(resetPending||active?.awaitingManualScan||autoRunning||indexing.running||!active||!settings().autoUpdate||!settings().profileId)return {waiting:true};
  const due=pendingExtraction(active).assistantCount;
  if(due<settings().batchEvery)return {waiting:true,assistantCount:due};
  autoRunning=true;
  try {return await processBacklog({force:false});}
  finally {autoRunning=false;}
}
/** The full unabridged Memory Book is always preserved. Normal deep import
 * commits per original source chunk. Reindex stages replacements in separate
 * local storage and never changes visible facts until ALL jobs succeed. */
async function extractChunk(chunk){
  const parts=segmentLegacyChunk(chunk);
  const jobs=planLegacyJobs(parts,{maxChunks:2,maxCharacters:2300});
  const all=[];
  for(const block of jobs){
    if(indexing.stopRequested)break;
    const ask=async(group)=>requestLegacyFacts(group,(prompt,tokenLimit)=>callArchivist(prompt,tokenLimit),{
      maxAttempts:2,maxTokens:settings().maxTokens,
      onRetry:()=>sendStatus('warn','Архивариус вернул некорректный JSON, повторяю маленький фрагмент.')});
    try{all.push(...await ask(block));}
    catch(err){
      if(indexing.stopRequested)break;
      if(block.length===1)throw err;
      sendStatus('warn','Разбиваю проблемный фрагмент на отдельные части.');
      for(const one of block){if(indexing.stopRequested)break;all.push(...await ask([one]));}
    }
  }
  return all;
}
export async function processLegacy({rebuild=false}={}){
  if(!active)throw Error('No chat is open');
  if(!settings().profileId)throw Error('Select an archivist Connection Profile');
  beginIndex(rebuild?'legacy-rebuild':'legacy');
  try{return await enqueue(async()=>{
    const initial=active,identity=activeId;
    const completed=new Set((initial.legacyBatches??[]).filter(b=>b.status==='done').flatMap(b=>b.chunkIds));
    const pending=rebuild?initial.chunks:initial.chunks.filter(c=>!completed.has(c.id));
    let batches=0,facts=0;
    if(rebuild){
      const fingerprint=hash(initial.chunks.map(c=>`${c.id}:${hash(c.raw)}`).join('|'));
      if(initial.legacyRebuild && initial.legacyRebuild.fingerprint!==fingerprint)
        throw Error('Imported sources changed during reindex; export the archive first.');
      initial.legacyRebuild??={fingerprint,doneIds:[],stagedFacts:[],startedAt:new Date().toISOString()};
      await persist();
    }
    initial.indexProgress={mode:rebuild?'legacy-rebuild':'legacy',status:'running',totalSources:pending.length,completedSources:0,startedAt:new Date().toISOString()};
    for(const chunk of pending){
      if(indexing.stopRequested){initial.indexProgress.status='stopped';await persist();break;}
      if(identity!==chatIdentity()||activeId!==identity||active!==initial)
        throw Error('Chat changed during legacy migration; processing paused without losing archived data');
      if(rebuild&&initial.legacyRebuild.doneIds.includes(chunk.id))continue;
      let candidates;
      try{candidates=await extractChunk(chunk);}
      catch(error){
        initial.diagnostics.push({at:new Date().toISOString(),kind:'legacy_error',chunkIds:[chunk.id],message:error.message});
        await persist();sendStatus('error',`Legacy index paused; resume is safe: ${error.message}`);throw error;
      }
      if(indexing.stopRequested){initial.indexProgress.status='stopped';await persist();break;}
      if(identity!==chatIdentity()||activeId!==identity||active!==initial)
        throw Error('Chat changed during legacy migration; uncommitted result discarded');
      if(rebuild){
        const staging={facts:initial.legacyRebuild.stagedFacts,revision:0};
        const added=addFacts(staging,[chunk.id],candidates);
        initial.legacyRebuild.doneIds.push(chunk.id);
        initial.legacyRebuild.stagedFacts=staging.facts;
        facts+=added.length;
      }else{
        const added=addFacts(initial,[chunk.id],candidates);
        initial.legacyBatches.push({chunkIds:[chunk.id],status:'done',at:new Date().toISOString(),facts:added.length});
        facts+=added.length;
      }
      initial.revision++;batches++;initial.indexProgress={...initial.indexProgress,completedSources:batches,status:indexing.stopRequested?'stopping':'running'};await persist();
      sendStatus('info',`${rebuild?'Переразметка':'Наследие'}: ${batches} источников обработано, +${facts} фактов`);
    }
    if(rebuild&&!indexing.stopRequested){
      // Retain facts originating in live chat; only replace old legacy-only
      // classifications after complete success. A failed run never touches them.
      const chunkIds=new Set(initial.chunks.map(c=>c.id));
      const retained=[];
      for(const f of initial.facts){
        const liveRefs=f.sourceIds.filter(id=>!chunkIds.has(id));
        if(!liveRefs.length)continue;
        retained.push({...f,sourceIds:liveRefs});
      }
      const temp={facts:[],revision:0};
      for(const f of initial.legacyRebuild.stagedFacts){
        const existing=temp.facts.find(x=>x.id===f.id);
        if(existing)existing.sourceIds=[...new Set([...existing.sourceIds,...f.sourceIds])];
        else temp.facts.push(f);
      }
      // Older imported facts precede newer live chat updates in state order.
      for(const f of retained){
        const existing=temp.facts.find(x=>x.id===f.id);
        if(existing)existing.sourceIds=[...new Set([...existing.sourceIds,...f.sourceIds])];
        else temp.facts.push(f);
      }
      initial.facts=temp.facts;
      initial.legacyBatches=[{chunkIds:initial.chunks.map(x=>x.id),status:'done',at:new Date().toISOString(),facts:initial.legacyRebuild.stagedFacts.length,reindexed:true}];
      initial.lastReindex=new Date().toISOString();
      delete initial.legacyRebuild;
      initial.revision++;await persist();
      sendStatus('info','Переразметка завершена. Старые классификации заменены, первоисточники и чат сохранены.');
    }
    if(settings().autoBackup&&batches)try{await backupNow();}catch(e){sendStatus('warn',`Факты сохранены локально; серверная копия не создана: ${e.message}`);}
    if(!indexing.stopRequested)initial.indexProgress={...initial.indexProgress,status:'done'};await persist();
    if(batches||(!indexing.stopRequested&&rebuild))memoryUpdated('legacy',rebuild?`Полочки переразмечены · ${initial.facts.length} структурированных записей`:`Наследие разобрано · +${facts} фактов`);
    return {batches,facts,total:initial.facts.length,rebuild,stopped:indexing.stopRequested};
  });}finally{endIndex();}
}
/** Prefer the newest player action to an older assistant recap.
 * Short continuation commands may require context from the preceding scene. */
function sourceQuery(){
  const chat=ctx().chat??[];
  const plain=m=>String(m?.mes??'')
    .replace(/<([a-z][\w-]*_easel)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<en>[\s\S]*?<\/en>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const lastUser=[...chat].reverse().find(m=>m?.is_user);
  const lastAssistant=[...chat].reverse().find(m=>m&&!m.is_user&&!m.is_system);
  const userText=plain(lastUser);
  const assistantText=plain(lastAssistant);
  // Short 'continue' commands need the active scene; substantive player posts take precedence.
  if(terms(userText).length<2)return assistantText.slice(-1200);
  return [userText.slice(-1700),assistantText.slice(-300)].filter(Boolean).join(' ');
}
/** Inject before outgoing generation; no direct mutation of ST messages. */
export async function beforeGeneration(type){
  const c=ctx();if(resetPending||active?.awaitingManualScan||!settings().enabled||!active||activeId!==chatIdentity()){
    c.setExtensionPrompt('SOLA_MNEMOSYNE','',1,1,false);return;
  }
  if(['quiet','impersonate'].includes(type)){c.setExtensionPrompt('SOLA_MNEMOSYNE','',1,1,false);return;}
  try{
    // Always retrieve directly relevant history and active state. One optional
    // background association is allowed only once per five generation attempts.
    const tick=(generationTicks.get(activeId)??0)+1;
    generationTicks.set(activeId,tick);
    const allowTexture=tick-(lastTextureTicks.get(activeId)??-100)>=5;
    const chosen=retrieve(active,sourceQuery(),{
      maxCharacters:Math.max(1000,Math.round(settings().contextTokens*2.4)),
      maxItems:16,mode:'automatic',maxAnchors:allowTexture?1:0,
    });
    const prompt=renderContext(chosen);
    c.setExtensionPrompt('SOLA_MNEMOSYNE',prompt,1,1,false);
    if(chosen.some(x=>x.anchor))lastTextureTicks.set(activeId,tick);
    lastInjection=`${new Date().toLocaleTimeString()} · ${chosen.length} records · ${prompt.length} characters`;
    document.dispatchEvent(new CustomEvent('mnemosyne:injected',{detail:lastInjection}));
  }catch(e){c.setExtensionPrompt('SOLA_MNEMOSYNE','',1,1,false);sendStatus('error',`Prompt injection failed: ${e.message}`);}
}
export function injectionInfo(){return lastInjection;}
export async function importLegacy(text,label='Memory Book') {
  if(!active)throw Error('Open a chat first');
  return enqueue(async()=>{const out=importMemoryBook(active,text,{label});await persist();sendStatus('info',out.duplicate?'Legacy source already imported':`Migrated ${out.count} chunks from ${label}`);if(!out.duplicate)memoryUpdated('import',`Наследие сохранено · ${out.count} записей`);return out;});
}
export function detectLegacy(){const c=ctx();const matches=[];
  const visited=new Set();
  function walk(obj,path,depth){if(depth>5||obj==null)return;
    if(typeof obj==='string'){if(obj.length>200&&/MEMORY BOOK|\[Events Chronicle|\[Main characters|\[Changes in personality/i.test(obj))matches.push({path,length:obj.length,text:obj});return;}
    if(typeof obj!=='object'||visited.has(obj))return;visited.add(obj);
    for(const [key,val] of Object.entries(obj).slice(0,200))if(!/key|token|password|secret|auth/i.test(key))walk(val,`${path}.${key}`,depth+1);
  }
  walk(c.chatMetadata,'chatMetadata',0);
  // Only read narrowly identified prior Summarize data; never depend on Summarize itself.
  walk(c.extensionSettings?.memory,'settings.memory',0);
  walk(c.extensionSettings?.summarize,'settings.summarize',0);
  for(const [i,m] of (c.chat??[]).entries())if(/MEMORY BOOK|\[Events Chronicle|\[Main characters/i.test(m.mes??''))matches.push({path:`chat[${i}]`,length:m.mes.length,text:m.mes});
  const seen=new Set();return matches.filter(m=>{const h=hash(m.text);if(seen.has(h))return false;seen.add(h);return true;}).sort((a,b)=>b.length-a.length);
}
export function preview(text){return {label:'Memory Book',chunks:(text.match(/\n\s*\n/g)||[]).length+1,characters:text.length};}
export async function backupNow(){if(!active)throw Error('No archive');
  await persist();const identity=active.chatId;
  const backup=await serverPut(active);
  // Don't attach a server pointer to the wrong chat if navigation happened mid-upload.
  if(active?.chatId===identity&&chatIdentity()===activeId){
    active.lastSync=backup.at;await persist();const m=currentMeta();if(m?.[KEY]?.archiveId===identity){m[KEY].serverPath=backup.path;await ctx().saveMetadata();}
    lastSyncCount=active.sources.length;
  }
  sendStatus('info',`Server backup saved: ${backup.bytes} characters`);
  return backup;
}
export function exportBackup(){if(!active)throw Error('No archive');downloadJson(active,`Sola-Mnemosyne-${active.chatId}-${new Date().toISOString().slice(0,10)}.json`);}
export async function restoreBackup(json){if(!active)throw Error('Open a chat');
  const data=typeof json==='string'?JSON.parse(json):json;const valid=validateArchive(data);if(!valid.valid)throw Error(valid.errors.join('; '));
  return enqueue(async()=>{
    const restored=structuredClone(data);restored.lineage=restored.chatId;restored.chatId=active.chatId;restored.revision++;restored.lastSync=null;
    active=restored;await persist();sendStatus('warn','Restored archive from backup; export a new snapshot before continuing.');memoryUpdated('restore','Архив восстановлен из копии');return validateArchive(active);
  });
}
export function shelfRecords(shelf){
  if(!active)return [];
  if(shelf==='recaps')return fullRecapRecords(active);
  const activeFacts=active.facts.filter(f=>activeFact(f,active));
  if(['promises','arcs'].includes(shelf))return currentStateRecords(activeFacts,shelf).slice(0,400);
  if(shelf==='locations')return locationShelfCards(activeFacts.filter(x=>x.shelf==='locations').slice().reverse()).slice(0,400);
  return activeFacts.filter(x=>x.shelf===shelf).slice(-400).reverse();
}
export function shelfChanges(shelf){
  if(!active)return {added:0,changed:0,entries:new Map()};
  // Older archives are baseline-initialized by openChat; do not manufacture unread.
  return diffReadSnapshot(shelfRecords(shelf),active.readReceipts?.[shelf]??readSnapshot(shelfRecords(shelf)));
}
export async function markShelfRead(shelf){
  if(!SHELVES[shelf]||!active)return;
  const target=active,identity=activeId;
  return enqueue(async()=>{
    if(active!==target||activeId!==identity)return;
    target.readReceipts??={};
    target.readReceipts[shelf]=readSnapshot(shelfRecords(shelf));
    await persist();
  });
}
export function legacySources(){return active?.imports??[];}
export async function checkHealth(){if(!active)return {valid:false,errors:['No archive']};const v=validateArchive(active);v.connectionReady=!!settings().profileId&&connectionProfiles().some(x=>x.id===settings().profileId);v.serverSynced=!!active.lastSync;v.injection=lastInjection;v.quality=auditArchive(active);return v;}
