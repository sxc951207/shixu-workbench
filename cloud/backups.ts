import{createHash,randomUUID}from'node:crypto';import{parseBackup,validateEntry,validateAssociations,todayShanghai,WorkbenchError}from'../lib/workbench/domain.ts';import type{Entry}from'../lib/workbench/domain.ts';import type{CloudState,CloudStore}from'./service.ts';import type{BackupKind,BackupSummary,BackupPreview}from'../lib/workbench/backup-types.ts';
export const BACKUP_LIMITS:Record<BackupKind,number>={automatic:30,manual:10,'before-restore':10};
export interface BackupDocument extends BackupSummary{format:'shixu-cloud-snapshot';version:1;payload:string;}
export interface BackupVault{list():Promise<BackupSummary[]>;get(id:string):Promise<BackupDocument|null>;put(doc:BackupDocument):Promise<void>;remove(id:string):Promise<void>;setIndex(items:BackupSummary[]):Promise<void>;}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validBackupId(id:unknown):id is string{return typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);}
export function validateBackupIndex(raw:unknown):BackupSummary[]{
 if(!Array.isArray(raw)||raw.length>50)throw new WorkbenchError('备份目录格式错误');
 const entries=raw.map(value=>{const b=value as BackupSummary;if(!b||!validBackupId(b.id)||!Object.hasOwn(BACKUP_LIMITS,b.kind)||!Number.isSafeInteger(b.count)||b.count<0||b.count>10000||!Number.isSafeInteger(b.bytes)||b.bytes<0||!Number.isSafeInteger(b.revision)||b.revision<0||!Number.isFinite(Date.parse(b.createdAt))||!/^[a-f0-9]{64}$/.test(b.checksum))throw new WorkbenchError('备份目录格式错误');return{id:b.id,kind:b.kind,createdAt:b.createdAt,count:b.count,bytes:b.bytes,revision:b.revision,checksum:b.checksum};});
 if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new WorkbenchError('备份目录存在重复编号');return entries;
}
export async function readBackup(vault:BackupVault,id:unknown){
 if(!validBackupId(id))throw new WorkbenchError('备份编号无效');const meta=(await vault.list()).find(b=>b.id===id);if(!meta)throw new WorkbenchError('备份不存在或已过保留期',404);
 const doc=await vault.get(id);if(!doc||doc.id!==id||doc.kind!==meta.kind||doc.revision!==meta.revision||doc.count!==meta.count||doc.format!=='shixu-cloud-snapshot'||doc.version!==1||typeof doc.payload!=='string'||sha(doc.payload)!==meta.checksum||doc.checksum!==meta.checksum||Buffer.byteLength(doc.payload)!==meta.bytes)throw new WorkbenchError('备份完整性校验失败，请选择其他版本');
 let data:unknown;try{data=JSON.parse(doc.payload);}catch{throw new WorkbenchError('备份内容校验失败');}const records=parseBackup(data);validateAssociations(records);if(records.length!==meta.count)throw new WorkbenchError('备份数量校验失败');return{meta,records,backup:data as {format:string;version:number;exportedAt:string;records:Entry[]}};
}
export async function createBackup(state:CloudState,vault:BackupVault,kind:BackupKind,clock=new Date()):Promise<BackupSummary>{
 if(!Object.hasOwn(BACKUP_LIMITS,kind))throw new WorkbenchError('备份类型无效');const index=await vault.list(),id=kind==='automatic'?'auto-'+todayShanghai(clock):(kind==='manual'?'manual-':'restore-')+clock.getTime()+'-'+randomUUID().slice(0,8);
 const existing=index.find(b=>b.id===id);if(existing)return existing;
 const records=state.records.map(validateEntry);validateAssociations(records);const createdAt=clock.toISOString(),payload=JSON.stringify({format:'shixu-workbench',version:1,exportedAt:createdAt,records});
 const meta:BackupSummary={id,kind,createdAt,count:records.length,bytes:Buffer.byteLength(payload),revision:state.revision,checksum:sha(payload)},doc:BackupDocument={...meta,format:'shixu-cloud-snapshot',version:1,payload};
 const combined=[meta,...[...index].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))],counts:Record<BackupKind,number>={automatic:0,manual:0,'before-restore':0},keep=combined.filter(b=>++counts[b.kind]<=BACKUP_LIMITS[b.kind]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 // All operations remain in the caller's CloudBase transaction.
 await vault.put(doc);for(const old of index)if(!keep.some(b=>b.id===old.id))await vault.remove(old.id);await vault.setIndex(keep);return meta;
}
export async function previewBackup(state:CloudState,vault:BackupVault,id:unknown):Promise<BackupPreview>{
 const target=await readBackup(vault,id),current=new Map(state.records.map(e=>[e.id,e])),desired=new Map(target.records.map(e=>[e.id,e]));const counts:Record<string,number>={};for(const e of target.records)counts[e.kind]=(counts[e.kind]||0)+1;
 return{backup:target.meta,currentRevision:state.revision,currentCount:state.records.length,targetCount:target.records.length,added:target.records.filter(e=>!current.has(e.id)).length,removed:state.records.filter(e=>!desired.has(e.id)).length,changed:target.records.filter(e=>current.has(e.id)&&JSON.stringify(validateEntry(current.get(e.id)))!==JSON.stringify(e)).length,counts};
}
export async function restoreBackup(state:CloudState,vault:BackupVault,id:unknown,expectedRevision:unknown,clock=new Date()):Promise<CloudState>{
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==state.revision)throw new WorkbenchError('当前数据已发生变化，请重新查看备份后再确认恢复',409);
 const target=await readBackup(vault,id),generation=Math.max(state.revision,...state.records.map(e=>e.version),...target.records.map(e=>e.version))+1;if(!Number.isSafeInteger(generation))throw new WorkbenchError('记录版本超出范围，请先下载备份再处理');
 const records=target.records.map(e=>validateEntry({...e,version:generation}));validateAssociations(records);
 if(records.length>10000||Buffer.byteLength(JSON.stringify(records))>4*1024*1024)throw new WorkbenchError('备份超过当前工作台容量上限');
 await createBackup(state,vault,'before-restore',clock);return{...state,records,revision:generation};
}
export async function runAutomaticBackup(store:CloudStore,clock=new Date()){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(clock));if(hour<2)return{ok:true,skipped:'before-backup-hour'};
 const out=await store.run(async(state,vault)=>{if(!state||!vault)return{state,response:{statusCode:200,headers:{},body:JSON.stringify({ok:true,skipped:'not-enabled'}),isBase64Encoded:false}};const backup=await createBackup(state,vault,'automatic',clock);return{state,response:{statusCode:200,headers:{},body:JSON.stringify({ok:true,id:backup.id,createdAt:backup.createdAt,count:backup.count}),isBase64Encoded:false}};});return JSON.parse(out.body);
}
