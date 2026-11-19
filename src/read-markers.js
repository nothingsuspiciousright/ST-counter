/** Per-chat read receipts: stable, semantic, independent from UI and storage. */
export function recordKey(record) {
  if(record.shelf==='recaps')return `recap:message:${record.messageIndex}`;
  const key=String(record.entityKey??'').trim().toLocaleLowerCase();
  return key?`entity:${record.shelf}:${key}`:`fact:${record.id}`;
}
// Recap read receipts must NOT copy thousands of full texts into the archive.
// Hash only the text for the UI change marker; originals remain in sources[].raw.
function compactHash(value){
  let h=2166136261;
  for(const ch of String(value)){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,'0');
}
export function recordSignature(record) {
  if(record.shelf==='recaps')return `recap:${record.text.length}:${compactHash(record.text)}`;
  // Additional source citations do not mean a new fact or changed state.
  return JSON.stringify([
    record.text??'',record.promiseStatus??'',record.arcStatus??'',
    record.knowledgeState??'',record.knowledge??'',record.lifecycle??'',
    record.certainty??'',record.people??[],record.tags??[],
  ]);
}
export function readSnapshot(records) {
  const result={};
  for(const record of records)result[recordKey(record)]={signature:recordSignature(record),
    text:String(record.text??'').slice(0,150),promiseStatus:record.promiseStatus??'',
    arcStatus:record.arcStatus??'',knowledgeState:record.knowledgeState??''};
  return result;
}
export function diffReadSnapshot(records,seen={}) {
  const entries=new Map();let added=0,changed=0;
  for(const record of records){
    const key=recordKey(record),old=seen?.[key];
    const kind=!old?'new':old.signature!==recordSignature(record)?'changed':'';
    if(!kind)continue;
    if(kind==='new')added++;else changed++;
    entries.set(key,{kind,previous:old??null});
  }
  return {added,changed,entries};
}
