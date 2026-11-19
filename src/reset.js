/** Destructive per-chat reset with a new archive identity.
 * Only this chat's Mnemosyne data is affected. Other chats, RP messages,
 * the archivist connection and the main prompt remain untouched.
 * A replacement archive and saved chat pointer must exist BEFORE old data
 * are deleted. The caller is responsible for confirmation and backup. */
export async function wipeChatMemory({
  oldArchive,chatId,chatLength,chatMetadata,metadataKey,
  createArchive,putLocal,deleteLocal,saveMetadata,deleteServer,
  newId,assertSameChat=()=>true,
}) {
  if(!oldArchive?.chatId||!chatId||!chatMetadata)throw Error('Open a saved chat first');
  const oldMetadata=chatMetadata[metadataKey];
  if(oldMetadata?.archiveId!==oldArchive.chatId||oldMetadata?.originChat!==chatId)
    throw Error('Chat pointer changed: reset cancelled');
  if(!assertSameChat())throw Error('Chat changed: reset cancelled');
  const freshId=newId();
  if(!freshId||freshId===oldArchive.chatId)throw Error('New archive identity is invalid');
  const fresh=createArchive(freshId);
  fresh.autoStartIndex=Math.max(0,Number(chatLength)||0);
  fresh.awaitingManualScan=true; // do not silently refill after refresh
  await putLocal(fresh);
  if(!assertSameChat()) {
    await deleteLocal(freshId).catch(()=>{});
    throw Error('Chat changed during reset: original archive was kept');
  }
  const oldPointer={...oldMetadata};
  chatMetadata[metadataKey]={archiveId:freshId,originChat:chatId,serverPath:''};
  try {await saveMetadata();}
  catch(error){
    chatMetadata[metadataKey]=oldPointer;
    await deleteLocal(freshId).catch(()=>{});
    throw Error(`Reset failed while saving chat pointer: ${error.message}. Original archive is kept.`);
  }
  // The empty archive now owns the chat. Failed cleanup is reported openly;
  // no hidden old snapshot can be automatically restored into it.
  const cleanupErrors=[];
  try{await deleteLocal(oldArchive.chatId);}catch(error){cleanupErrors.push(`IndexedDB: ${error.message}`);}
  const snapshot=oldPointer.serverPath||'';
  if(snapshot){
    try{await deleteServer(snapshot,oldArchive.chatId);}
    catch(error){cleanupErrors.push(`Server snapshot: ${error.message}`);}
  }
  return {archive:fresh,oldChatId:oldArchive.chatId,deletedServer:!!snapshot&&!cleanupErrors.some(x=>x.startsWith('Server snapshot:')),cleanupErrors};
}
