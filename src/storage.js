/** Persistence: immediate local IndexedDB + explicit/periodic SillyTavern server snapshots. */
import {validateArchive} from './core.js';
const DB_NAME='sola-mnemosyne-archive-v1';
function dbOpen(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('archives'))r.result.createObjectStore('archives',{keyPath:'chatId'});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});}
export async function localGet(id){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('archives','readonly');const req=tx.objectStore('archives').get(id);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});}
export async function localPut(archive){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('archives','readwrite');tx.objectStore('archives').put(structuredClone(archive));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
/** Delete exactly one chat archive, never the entire IndexedDB database. */
export async function localDelete(id){if(!id)throw Error('Missing archive ID');const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('archives','readwrite');tx.objectStore('archives').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error??Error('Delete transaction aborted'));};});}
// Avoid an enormous JS array of one-character strings for large RP histories.
const encodedUtf8=text=>{
  const bytes=new TextEncoder().encode(text),parts=[];
  for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(parts.join(''));
};
function safeFileName(id){return `sola-mnemosyne-${id.replace(/[^a-zA-Z0-9-]/g,'').slice(0,90)}.json`;}
async function request(url,body){const headers=SillyTavern.getContext().getRequestHeaders();const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});if(!res.ok)throw Error(`${url} HTTP ${res.status}: ${(await res.text()).slice(0,160)}`);return res.json();}
/** Writes to ST's per-user files folder, not a third-party server. */
export async function serverPut(archive){const check=validateArchive(archive);if(!check.valid)throw Error(`Archive integrity: ${check.errors.slice(0,3).join('; ')}`);
  const snapshot=structuredClone(archive);snapshot.lastSync=new Date().toISOString();
  const json=JSON.stringify(snapshot);
  const data=encodedUtf8(json);
  const r=await request('/api/files/upload',{name:safeFileName(archive.chatId),data});
  if(typeof r.path!=='string'||!r.path.includes('sola-mnemosyne-'))throw Error('Unexpected upload path');
  return {path:r.path,at:snapshot.lastSync,bytes:json.length};
}
/** Delete a server snapshot ONLY when its name matches the exact old archive ID. */
export async function serverDelete(path,chatId){
  if(!chatId)throw Error('Missing old archive identity');
  const target=String(path??'').replace(/^\/+/, '');
  if(target!==`user/files/${safeFileName(chatId)}`)
    throw Error('Snapshot path does not belong to this archive');
  const res=await fetch('/api/files/delete',{
    method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),
    body:JSON.stringify({path:target}),
  });
  if(res.status===404)return {deleted:false,missing:true};
  if(!res.ok)throw Error(`HTTP ${res.status}: ${(await res.text()).slice(0,120)}`);
  return {deleted:true};
}
export async function serverGet(path){
  if(typeof path!=='string'||!/^\/?user\/files\/sola-mnemosyne-[a-zA-Z0-9-]+\.json$/.test(path))throw Error('Unexpected memory path');
  const url=path.startsWith('/')?path:`/${path}`;
  const res=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});
  if(!res.ok)throw Error(`Archive fetch failed: HTTP ${res.status}`);
  const text=await res.text();const data=JSON.parse(text);
  if(!validateArchive(data).valid)throw Error('Server archive integrity check failed');
  return data;
}
export function downloadJson(data,name){const file=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function fileAsText(file){return file.text();}
