/** Entry point. Importing this file doesn't alter a user's RP preset or chat. */
import * as mn from './src/runtime.js';
import {SHELVES, retrieve, validateArchive, splitMemoryBook} from './src/core.js';
import {initNotifications, notifyMemoryUpdated} from './src/notifications.js';
import {recordKey} from './src/read-markers.js';
const BASE=new URL('.',import.meta.url);
let selectedShelf='chronology',activeTab='archive',candidates=[],visibleShelfChanges=new Map(),recapShown=30;
const $ = selector=>document.querySelector(`#mnemosyne-panel ${selector}`);
function status(message,bad=false){const el=$('#mn-status');if(el){el.textContent=message;el.dataset.level=bad?'error':'info';}}
function displayError(error){status(error?.message??String(error),true);console.error('[Mnemosyne]',error);}
function bind(selector,event,fn){const el=$(selector);el?.addEventListener(event,async ev=>{try{await fn(ev);}catch(e){displayError(e);}});}
function mkOption(value,label){const option=document.createElement('option');option.value=value;option.textContent=label;return option;}
function renderProfiles(){const sel=$('#mn-profile');if(!sel)return;sel.replaceChildren(mkOption('','— Выберите дешёвую модель —'));
  for(const p of mn.connectionProfiles())sel.append(mkOption(p.id,`${p.name} · ${p.model??p.api??''}`));sel.value=mn.settings().profileId??'';
}
function updateChat(){const s=mn.getStats(),v=$('#mn-overview');if(!v)return;
  v.textContent=s?.awaitingManualScan?'Память этого чата очищена. Для нового прохода сначала нажми «Обновить архив из чата».':s?`Источников: ${s.sourceCount} · фактов: ${s.factCount} · фрагментов оригинала: ${s.chunkCount} · импортов: ${s.imports} · заблокированных пакетов: ${s.blockedBatches} · новых ответов до автообновления: ${Math.max(0,s.batchEvery-s.pending)} · ${s.valid?'целостность OK':'ОШИБКИ'}`:'Открой сохранённый чат для работы с памятью.';
  renderOriginals();
  $('#mn-sync').textContent=s?.lastSync?`Снимок сервера: ${new Date(s.lastSync).toLocaleString()}`:'Резервная копия ещё не создана';
  $('#mn-injection').textContent=mn.injectionInfo()||'Память ещё не подставлялась в запрос';
  renderShelves();renderLog();
}
/** Controlled disclosure avoids theme-wide <details>/<summary> styling from escaping its row. */
function makeRecordRow(label, body, metadata=''){
  const row=document.createElement('div');row.className='mn-record';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='mn-record-toggle';
  toggle.textContent=String(label??'');toggle.setAttribute('aria-expanded','false');
  const content=document.createElement('div');content.className='mn-record-content';content.hidden=true;
  if(metadata){const meta=document.createElement('div');meta.className='mn-meta';meta.textContent=metadata;content.append(meta);}
  const pre=document.createElement('pre');pre.className='mn-record-text';pre.textContent=String(body??'');content.append(pre);
  toggle.addEventListener('click',()=>{
    content.hidden=!content.hidden;
    toggle.setAttribute('aria-expanded',String(!content.hidden));
  });
  row.append(toggle,content);return row;
}
function renderShelves(){const parent=$('#mn-shelves');if(!parent)return;parent.replaceChildren();
  for(const [id,name] of Object.entries(SHELVES)){
    const button=document.createElement('button');button.type='button';button.className=`mn-chip${id===selectedShelf?' current':''}`;
    button.append(document.createTextNode(name));
    const changes=mn.shelfChanges(id);
    for(const [kind,count] of [['new',changes.added],['changed',changes.changed]]){
      if(!count)continue;
      const pill=document.createElement('span');pill.className=`mn-unread mn-unread-${kind}`;
      pill.textContent=`${kind==='new'?'✦':'◆'} ${count}`;
      pill.title=kind==='new'?`${count} новых записей`:`${count} изменённых записей`;
      button.append(pill);
    }
    button.addEventListener('click',async()=>{
      if(id!==selectedShelf)recapShown=30;
      selectedShelf=id;
      // Keep visual highlights for the opened shelf, but clear unread counters
      // persistently for this chat. Other shelves retain their unread status.
      visibleShelfChanges=mn.shelfChanges(id).entries;
      renderShelves();
      try{await mn.markShelfRead(id);renderShelves();}catch(e){displayError(e);}
    });
    parent.append(button);
  }
  const list=$('#mn-records');list.replaceChildren();
  const allItems=mn.shelfRecords(selectedShelf);
  const items=allItems.slice(0,selectedShelf==='recaps'?recapShown:80);
  if(!items.length){list.textContent=selectedShelf==='recaps'
    ?'В архиве этого чата пока нет распознанных recap. Нажми «Обновить архив из чата»: исходные ответы будут прочитаны без обращения к архивариусу и без повторного импорта Memory Book.'
    :'Структурированных записей здесь пока нет. Оригинальная Memory Book сохранена во вкладке «Наследие»; при необходимости запусти переразметку.';return;}
  const promiseNames={unknown:'не определён',pending:'ожидает выполнения',fulfilled:'выполнено',broken:'нарушено',cancelled:'отменено'};
  const arcNames={unknown:'не определён',planned:'планируется',active:'идёт',completed:'завершена',paused:'приостановлена',abandoned:'оставлена'};
  for(const item of items){
    const promiseMark={unknown:'? статус не подтверждён',pending:'○ ожидает',fulfilled:'✓ выполнено',broken:'! нарушено',cancelled:'× отменено'};
    const arcMark={unknown:'? статус неизвестен',planned:'○ планируется',active:'◐ продолжается',completed:'✓ завершена',paused:'Ⅱ на паузе',abandoned:'× прекращена'};
    const prefix=selectedShelf==='promises'?`[${promiseMark[item.promiseStatus]??promiseMark.unknown}] `:
      selectedShelf==='arcs'?`[${arcMark[item.arcStatus]??arcMark.unknown}] `:'';
    const summary=selectedShelf==='recaps'
      ?`Recap · сообщение #${item.messageIndex+1} · ${item.text.replace(/\s+/g,' ').slice(0,110)}`
      :prefix+item.text.slice(0,145);
    const status=selectedShelf==='promises'?` · Обещание: ${promiseNames[item.promiseStatus]??'не определён'}`:
      selectedShelf==='arcs'?` · Арка: ${arcNames[item.arcStatus]??'не определён'}`:
      selectedShelf==='knowledge'?` · Кому известно: ${item.knowledge||'не установлено'} (${item.knowledgeState||'unknown'})`:'';
    const metadata=selectedShelf==='recaps'
      ?`Полный оригинальный recap · источник: ${item.sourceId} · свайп ${item.swipe+1} · ${item.text.length} символов${item.sourceDate?' · '+item.sourceDate:''}`
      :`Источник: ${item.sourceIds?.join(', ')??'—'} · ${item.certainty??'неизвестно'} · ${item.lifecycle??''}${status}`;
    const row=makeRecordRow(summary,item.text,metadata);
    const diff=visibleShelfChanges.get(recordKey(item));
    if(diff){
      row.classList.add(`mn-record-${diff.kind}`);
      const mark=document.createElement('span');mark.className=`mn-record-marker mn-record-marker-${diff.kind}`;
      mark.textContent=diff.kind==='new'?'✦ Новое':'◆ Изменено';
      mark.title=diff.kind==='new'?'Добавлено после последнего просмотра полочки':'Обновлено после последнего просмотра полочки';
      const button=row.querySelector('.mn-record-toggle');
      if(button)button.append(mark);
      if(diff.kind==='changed'&&diff.previous){
        const previous=diff.previous;
        const prior=selectedShelf==='promises'?previous.promiseStatus:selectedShelf==='arcs'?previous.arcStatus:
          selectedShelf==='knowledge'?previous.knowledgeState:'';
        const now=selectedShelf==='promises'?item.promiseStatus:selectedShelf==='arcs'?item.arcStatus:
          selectedShelf==='knowledge'?item.knowledgeState:'';
        if(prior&&now&&prior!==now){const note=row.querySelector('.mn-meta');
          if(note)note.textContent+=` · Статус: ${prior} → ${now}`;}
      }
    }
    list.append(row);
  }
  if(selectedShelf==='recaps'&&allItems.length>items.length){
    const more=document.createElement('button');more.type='button';more.className='mn-show-more';
    more.textContent=`Показать ещё 30 recap · отображено ${items.length} из ${allItems.length}`;
    more.addEventListener('click',()=>{recapShown+=30;renderShelves();});
    list.append(more);
  }
}
function renderOriginals(){
  const select=$('#mn-original-select');if(!select)return;
  const originals=mn.legacySources();
  const old=select.value;
  if(select.options.length!==originals.length+1||originals.some((x,i)=>select.options[i+1]?.value!==x.id)){
    select.replaceChildren(mkOption('','— Выбери импортированную Memory Book —'));
    originals.forEach(x=>select.append(mkOption(x.id,`${x.label} · ${x.raw?.length??0} символов`)));
    select.value=old||'';
  }
  const original=originals.find(x=>x.id===select.value);
  const view=$('#mn-original-content');if(view)view.value=original?.raw??'';
}
function renderLog(){const root=$('#mn-log');if(!root)return;root.replaceChildren();for(const l of mn.log.slice(0,35)){
  const line=document.createElement('div');line.className=`mn-log-line ${l.level}`;line.textContent=`${l.at} · ${l.level}: ${l.message}`;root.append(line);
}}
function switchTab(tab){activeTab=tab;for(const button of document.querySelectorAll('#mnemosyne-panel [data-tab]'))button.classList.toggle('current',button.dataset.tab===tab);
  for(const section of document.querySelectorAll('#mnemosyne-panel [data-page]'))section.hidden=section.dataset.page!==tab;
}
function getInput(){return $('#mn-import-text').value;}
async function listDetection(){candidates=mn.detectLegacy();const sel=$('#mn-detected');sel.replaceChildren(mkOption('','— выбери найденный документ —'));
  candidates.forEach((x,i)=>sel.append(mkOption(String(i),`${x.path} (${x.length.toLocaleString('ru')} символов)`)));
  status(candidates.length?`Обнаружено ${candidates.length} похожих источников; выбери и просмотри.`:'Автоматически Memory Book не найдена; можно вставить текст или выбрать файл.');
}
async function restoreFile(file){const text=await file.text();const r=await mn.restoreBackup(text);status(`Восстановлено: ${r.sourceCount} исходников, ${r.factCount} фактов`);updateChat();}
async function initUI(){const container=document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings')||document.querySelector('#extensions_settings_container');
  if(!container)throw Error('SillyTavern extension settings area not found');
  const html=await fetch(new URL('./settings.html',BASE)).then(r=>{if(!r.ok)throw Error('Settings template missing');return r.text();});
  const host=document.createElement('div');host.innerHTML=html;container.append(host);
  const s=mn.settings();$('#mn-enabled').checked=s.enabled;$('#mn-interval').value=s.batchEvery;$('#mn-budget').value=s.contextTokens;$('#mn-archivist-tokens').value=s.maxTokens;$('#mn-auto-update').checked=s.autoUpdate;$('#mn-auto-backup').checked=s.autoBackup;$('#mn-success-notifications').checked=s.successNotifications;
  for(const b of document.querySelectorAll('#mnemosyne-panel [data-tab]'))b.addEventListener('click',()=>switchTab(b.dataset.tab));
  bind('#mn-enabled','change',()=>{s.enabled=$('#mn-enabled').checked;mn.saveSettings();status(s.enabled?'Подстановка памяти включена.':'Подстановка памяти выключена.');});
  bind('#mn-profile','change',()=>{s.profileId=$('#mn-profile').value;mn.saveSettings();status('Профиль архивариуса сохранён; основная модель RP не менялась.');});
  bind('#mn-interval','change',()=>{s.batchEvery=Math.max(1,Math.min(200,Number($('#mn-interval').value)||40));$('#mn-interval').value=s.batchEvery;mn.saveSettings();});
  bind('#mn-budget','change',()=>{s.contextTokens=Math.max(300,Math.min(12000,Number($('#mn-budget').value)||2400));$('#mn-budget').value=s.contextTokens;mn.saveSettings();});
  bind('#mn-archivist-tokens','change',()=>{s.maxTokens=Math.max(1024,Math.min(32768,Number($('#mn-archivist-tokens').value)||8192));$('#mn-archivist-tokens').value=s.maxTokens;mn.saveSettings();});
  bind('#mn-auto-update','change',()=>{s.autoUpdate=$('#mn-auto-update').checked;mn.saveSettings();status(s.autoUpdate?'Автообновление включено.':'Автообновление выключено.');});
  bind('#mn-auto-backup','change',()=>{s.autoBackup=$('#mn-auto-backup').checked;mn.saveSettings();});
  bind('#mn-success-notifications','change',()=>{s.successNotifications=$('#mn-success-notifications').checked;mn.saveSettings();});
  bind('#mn-scan','click',async()=>{await mn.fullRescan({notify:true});updateChat();});
  bind('#mn-extract','click',async()=>{status('Архивариус обрабатывает новые события…');const r=await mn.processBacklog({force:true});status(`Готово: ${r.batches} пакетов, +${r.facts} фактов, заблокировано ${r.blocked??0}. Пропуски не считаются извлечёнными фактами.`);updateChat();});
  bind('#mn-skip-failed','click',async()=>{
    if(!window.confirm('Пропустить один ранее ошибочный пакет? Его оригинальные сообщения останутся сохранёнными, но ФАКТЫ из них не будут извлечены. Продолжить?'))return;
    const r=await mn.skipFailedBatch();status(`Пропущен проблемный пакет ${r.id}: ${r.messages} исходников сохранены локально без разметки. Нажми «Обработать новые события», чтобы продолжить.`);updateChat();
  });
  bind('#mn-sync-now','click',async()=>{status('Сохраняю резервную копию на сервер SillyTavern…');const r=await mn.backupNow();status(`Сохранено: ${r.path}`);updateChat();});
  bind('#mn-export','click',()=>{mn.exportBackup();status('Полный архив экспортирован в JSON.');});
  bind('#mn-reset-current','click',async()=>{
    const a=mn.currentArchive();
    if(!a)throw Error('Сначала открой сохранённый чат.');
    const summary=`${a.sources?.length??0} исходников, ${a.facts?.length??0} фактов, ${a.imports?.length??0} импортов и все recap`;
    if(!window.confirm(`ПОЛНЫЙ СБРОС ПАМЯТИ ТЕКУЩЕГО ЧАТА\n\nБудет очищено: ${summary}.\n\nЧат SillyTavern и настройки подключения останутся, но Mnemosyne забудет всё.\n\nТы уже скачала и проверила резервный JSON?`))return;
    const typed=window.prompt('Для безвозвратного сброса введи СБРОС заглавными буквами. Чтобы отменить — закрой окно.');
    if(typed!=='СБРОС'){status('Сброс отменён. Память не изменена.');return;}
    $('#mn-reset-current').disabled=true;
    try{
      status('Создаю новый пустой архив и удаляю данные Мнемозины текущего чата…');
      const result=await mn.resetCurrentChat();
      candidates=[];visibleShelfChanges=new Map();selectedShelf='chronology';recapShown=30;
      $('#mn-search').value='';$('#mn-results').replaceChildren();
      $('#mn-import-text').value='';$('#mn-import-file').value='';
      $('#mn-detected').replaceChildren(mkOption('','— источники ещё не искали —'));
      $('#mn-diagnostics').textContent='Архив сброшен. Новая диагностика ещё не запускалась.';
      updateChat();
      status(result.cleanupErrors.length
        ?`Новый пустой архив готов, но некоторые старые копии не удалось удалить: ${result.cleanupErrors.join('; ')}`
        :'Полный сброс завершён. Далее: «Обновить архив из чата» → «Обработать новые события». При желании заново импортируй Memory Book.',
        result.cleanupErrors.length>0);
    }finally{$('#mn-reset-current').disabled=false;}
  });
  bind('#mn-restore','change',async()=>{const f=$('#mn-restore').files?.[0];if(!f)return;if(!window.confirm('Заменить текущий архив этой резервной копией? Сначала экспортируй текущую!'))return;await restoreFile(f);});
  bind('#mn-detect','click',listDetection);
  bind('#mn-original-select','change',renderOriginals);
  bind('#mn-detected','change',()=>{const i=Number($('#mn-detected').value);if(Number.isInteger(i)&&candidates[i])$('#mn-import-text').value=candidates[i].text;});
  bind('#mn-import-file','change',async()=>{const f=$('#mn-import-file').files?.[0];if(f){$('#mn-import-text').value=await f.text();status(`Прочитан файл: ${f.name}`);}});
  bind('#mn-legacy-deep','click',async()=>{const n=mn.currentArchive()?.chunks?.length||0;if(!n)throw Error('Сначала импортируй Memory Book.');if(!window.confirm(`Архивариус дополнительно проиндексирует ${n} фрагментов старой Memory Book с оплатой запросов к выбранной модели. Продолжить?`))return;status('Разбираю наследие небольшими порциями; ошибки JSON будут автоматически перепроверены…');const v=await mn.processLegacy();status(`Готово: ${v.batches} пакетов, ${v.facts} новых фактов`);updateChat();});
  bind('#mn-legacy-rebuild','click',async()=>{
    const n=mn.currentArchive()?.chunks?.length||0;
    if(!n)throw Error('Сначала импортируй Memory Book.');
    if(!window.confirm(`Повторно обработать ${n} фрагментов старой книги? Это платные запросы архивариусу. Пока не завершится ВСЯ книга, прежние записи останутся нетронутыми. Перед запуском скачай полный архив.`))return;
    status('Провожу полную переразметку. Результаты сохраняются по частям; старые записи пока не меняются…');
    const result=await mn.processLegacy({rebuild:true});
    status(`Полная переразметка завершена: ${result.total} структурированных записей. Оригинал сохранён.`);updateChat();
  });
  bind('#mn-import','click',async()=>{const text=getInput();if(!text.trim())throw Error('Выбери Memory Book, вставь текст или загрузите файл.');
    const chunks=splitMemoryBook(text);if(!window.confirm(`Импортировать ${chunks.length} разделов/фрагментов? Оригинал сохранится целиком; Summarize не изменится.`))return;
    const r=await mn.importLegacy(text,$('#mn-import-name').value.trim()||'Memory Book');
    status(r.duplicate?'Эта версия уже импортирована':`Готово: ${r.count} записей сохранено с оригиналом; ошибок покрытия: ${r.missing.length}`);updateChat();});
  bind('#mn-check','click',async()=>{const r=await mn.checkHealth();$('#mn-diagnostics').textContent=JSON.stringify(r,null,2);status(r.valid?'Проверка целостности пройдена.':'Обнаружены проблемы, смотри диагностику.',!r.valid);});
  bind('#mn-search','input',()=>{const a=mn.currentArchive();const q=$('#mn-search').value.trim();const output=$('#mn-results');output.replaceChildren();if(!a||q.length<3)return;
    const words=q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const sourceHits=a.sources.filter(x=>words.every(w=>x.raw.toLocaleLowerCase().includes(w))).slice(-10).reverse();
    const memoryHits=retrieve(a,q,{maxCharacters:3200,maxItems:8});
    for(const match of memoryHits){const div=document.createElement('div');div.className='mn-hit';div.textContent=match.text;output.append(div);}
    for(const match of sourceHits){
      const label=`Исходник ${match.id} · ${match.role} ${match.active?'(активный свайп)':'(архивная версия)'}`;
      output.append(makeRecordRow(label,match.raw));
    }
  });
  document.addEventListener('mnemosyne:status',()=>{renderLog();updateChat();});
  document.addEventListener('mnemosyne:injected',()=>updateChat());
  document.addEventListener('mnemosyne:updated',event=>notifyMemoryUpdated(event.detail?.message,mn.settings().successNotifications));
  renderProfiles();switchTab('archive');updateChat();
}

/** Asynchronous generation interceptor: independent archive queries and prompt injection. */
globalThis.solaMnemosyneBeforeGeneration=async (_chat,_contextSize,_abort,type)=>{
  try{await mn.beforeGeneration(type);}catch(e){console.error('[Mnemosyne] interceptor',e);}
};

async function init(){initNotifications();await initUI();const c=SillyTavern.getContext();
  const events=c.event_types,source=c.eventSource;
  source.on(events.CHAT_CHANGED,async()=>{try{recapShown=30;visibleShelfChanges=new Map();await mn.openChat();updateChat();}catch(e){displayError(e);}});
  source.on(events.MESSAGE_RECEIVED,async()=>{try{await mn.archiveEvent();const a=mn.currentArchive();const count=a?.sources.filter(s=>s.active&&s.role==='assistant').length??0;
    if(mn.settings().autoUpdate&&mn.settings().profileId&&a){mn.maybeAutoProcess().then(updateChat).catch(displayError);}
    updateChat();}catch(e){displayError(e);}});
  for(const name of ['MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED'])if(events[name])source.on(events[name],async()=>{
    try{await mn.fullRescan();updateChat();}catch(e){displayError(e);}
  });
  try{await mn.openChat();}catch(e){displayError(e);}
  updateChat();
}
init().catch(e=>{console.error('[Mnemosyne] Could not initialize',e);});
