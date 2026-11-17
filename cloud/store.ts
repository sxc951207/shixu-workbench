import type {CloudStore,CloudState} from './service.ts';
import{validateBackupIndex}from'./backups.ts';import type{BackupVault,BackupDocument}from'./backups.ts';import type{BackupSummary}from'../lib/workbench/backup-types.ts';
export function createCloudStore(db:any):CloudStore{return{async run(fn){
 const result=await db.runTransaction(async(transaction:any)=>{
  const doc=transaction.collection('shixu_private_v1').doc('owner');
  const response=await doc.get();const raw=Array.isArray(response.data)?response.data[0]:response.data;
  const current:CloudState|null=raw?{auth:raw.auth,records:JSON.parse(raw.recordsJson||'[]'),revision:raw.revision||0}:null;
  let index:BackupSummary[]|null=null;const backupCollection=transaction.collection('shixu_backups_v1'),catalog=backupCollection.doc('catalog');
  const vault:BackupVault={
   async list(){if(index===null){const r=await catalog.get(),raw=Array.isArray(r.data)?r.data[0]:r.data;index=validateBackupIndex(raw?JSON.parse(raw.itemsJson||'[]'):[]);}return[...index];},
   async get(id){const r=await backupCollection.doc(id).get();return(Array.isArray(r.data)?r.data[0]:r.data)||null as BackupDocument|null;},
   async put(data){await backupCollection.doc(data.id).set(data);},async remove(id){await backupCollection.doc(id).remove();},
   async setIndex(items){const clean=validateBackupIndex(items);await catalog.set({version:1,itemsJson:JSON.stringify(clean)});index=clean;}
  };
  const out=await fn(current,vault);
  if(out.state&&out.state!==current)await doc.set({auth:out.state.auth,recordsJson:JSON.stringify(out.state.records),revision:out.state.revision});
  return out.response;
 });return result.result??result;
}};}
