import type{CompanyStore,CompanyTx}from'./store.ts';import type{Actor,Company}from'./model.ts';import{companyKey,digest,loadCompany,versionKey}from'./core.ts';import{WorkbenchError,todayShanghai}from'../../lib/workbench/domain.ts';
import type{ReportIndex}from'./model.ts';import{reportIndexKey,reportVersionKey}from'./reports.ts';
import{archiveApprovalAction,archiveRecord,archiveVersionCount,parseArchiveVersion,projectArchiveHead,sameArchiveValue}from'../../lib/workbench/company-archive.ts';
import type{ArchiveVersion}from'../../lib/workbench/company-archive.ts';
import type{OperatingIndex}from'./operating-model.ts';import{operatingIndexKey,operatingVersionKey,operatingHead}from'./operating.ts';
import {addDays} from '../../lib/workbench/productivity.ts';
type Checkpoint={id:string;kind:'daily'|'monthly'|'yearly';period:string;createdAt:string;revision:number;checksum:string};
type Health={lastAttempt?:string;lastSuccess?:string;lastFailure?:string;failureCode?:'CHECKPOINT_FAILED'};
export type PreviousCheckpointDay={date:string;status:'saved'|'missing'|'not-due'|'unavailable'};
type Drill={id:string;revision:number;state:'running'|'passed'|'failed';checked:number;total:number;startedAt:string;completedAt?:string;failureCode?:string};
const healthKey=(id:string)=>'backup_health_'+id;
function lastFailure(health:Health|null){return health?.failureCode?health.lastAttempt??health.lastFailure:health?.lastFailure;}
async function previousCheckpointDay(tx:CompanyTx,c:Company,clock:Date):Promise<PreviousCheckpointDay>{
 const date=addDays(todayShanghai(clock),-1),id='checkpoint_'+c.id+'_daily_'+date;
 try{
  const catalog=await tx.get<{items:Checkpoint[]}>('catalog_'+c.id,true);
  if(catalog&&!Array.isArray(catalog.items))return{date,status:'unavailable'};
  const entries=(catalog?.items||[]).filter(entry=>entry.id===id);
  if(entries.length===1){await verifiedCheckpoint(tx,c.id,entries[0]);return{date,status:'saved'};}
  if(entries.length>1)return{date,status:'unavailable'};
  // The last hourly trigger that could have captured this day runs at 23:00 in Shanghai.
  const eligible=Date.parse(c.createdAt)<Date.parse(date+'T23:00:00+08:00');
  return{date,status:eligible?'missing':'not-due'};
 }catch{return{date,status:'unavailable'};}
}
async function mirror(tx:CompanyTx,key:string){const d=await tx.get<{payload:string;checksum:string}>(key,true);if(!d||typeof d.payload!=='string'||digest(d.payload)!==d.checksum)throw new WorkbenchError('独立副本校验失败');return JSON.parse(d.payload);}
async function verifiedCheckpoint(tx:CompanyTx,companyId:string,meta:Checkpoint){
 const fail=():never=>{throw new WorkbenchError('备份完整性校验失败');};
 if(!['daily','monthly','yearly'].includes(meta.kind)||meta.id!=='checkpoint_'+companyId+'_'+meta.kind+'_'+meta.period||!Number.isSafeInteger(meta.revision)||meta.revision<1||typeof meta.createdAt!=='string'||!Number.isFinite(Date.parse(meta.createdAt))||typeof meta.checksum!=='string'||!(/^[a-f0-9]{64}$/).test(meta.checksum))fail();
 const doc=await tx.get<Checkpoint&{payload:string}>(meta.id,true);if(!doc)return fail();if(typeof doc.payload!=='string'||digest(doc.payload)!==meta.checksum||(['id','kind','period','createdAt','revision','checksum']as const).some(key=>doc[key]!==meta[key]))fail();
 let snapshot:any;try{snapshot=JSON.parse(doc.payload);}catch{fail();}
 const day=todayShanghai(new Date(meta.createdAt)),period=meta.kind==='daily'?day:meta.kind==='monthly'?day.slice(0,7):day.slice(0,4);
 if(snapshot?.format!=='shixu-company-checkpoint'||snapshot.version!==1||snapshot.createdAt!==meta.createdAt||snapshot.company?.id!==companyId||snapshot.company.revision!==meta.revision||!Array.isArray(snapshot.company.members)||!Array.isArray(snapshot.company.projects)||meta.period!==period)fail();
 return snapshot;
}
async function checkMirrorVersion(tx:CompanyTx,c:Company,value:ArchiveVersion){
 const total=archiveVersionCount(c);
 parseArchiveVersion(value,{format:'shixu-company-export',version:3,exportedAt:c.createdAt,company:c,revision:c.revision,totalVersions:total},{unboundedHistory:true});
 const rec=archiveRecord(value);
 if(rec.published){const ref=await mirror(tx,'project'in value?versionKey(rec.id,rec.published.version):'report'in value?reportVersionKey(rec.id,rec.published.version):operatingVersionKey(rec.id,rec.published.version)),confirmed=ref&&archiveRecord(ref);if(!confirmed||ref.action!==archiveApprovalAction(value))throw new Error('snapshot');const{published,...snapshot}=confirmed;if(!sameArchiveValue(snapshot,rec.published))throw new Error('snapshot');}
 if('project'in value){const head=c.projects.find(p=>p.id===rec.id);if(head?.version===rec.version&&!sameArchiveValue(projectArchiveHead(value.project),head))throw new Error('head');for(const p of [value.project,value.project.published])for(const n of p?.work?.nudges||[])if(n.kind==='report-review'){const ref=await mirror(tx,reportVersionKey(n.targetId,n.targetVersion));if(!ref.report||ref.report.projectId!==rec.id||ref.report.companyId!==c.id||ref.report.status!=='submitted')throw new Error('nudge');}else if(n.kind==='project-review'){const ref=await mirror(tx,versionKey(rec.id,n.targetVersion));if(!ref.project||ref.project.companyId!==c.id||ref.project.id!==rec.id||ref.project.status!=='submitted'||n.targetVersion>rec.version)throw new Error('nudge');}}
 else if('report'in value)for(const source of value.report.sourceVersions){const ref=await mirror(tx,versionKey(value.report.projectId,source));if(!ref.project||ref.project.companyId!==c.id||ref.project.id!==value.report.projectId||ref.project.version!==source||ref.action!=='project.approve'||ref.project.status!=='approved'||todayShanghai(new Date(ref.at))<value.report.start||todayShanghai(new Date(ref.at))>value.report.end)throw new Error('source');}
 else{const r=value.operating;if(r.id!=='op_'+digest(c.id+':'+r.projectId+':'+r.sheet+':'+r.date).slice(0,32))throw new Error('operating id');}
}
async function operatingIndex(tx:CompanyTx,c:Company,month:string){const meta=c.operatingMonths![month],index=await mirror(tx,operatingIndexKey(c.id,month)+'_'+meta.revision)as OperatingIndex;if(!index||index.revision!==meta.revision||index.versions!==meta.versions||!Array.isArray(index.items)||index.items.length!==meta.count||index.items.reduce((n,r)=>n+r.version,0)!==meta.versions||new Set(index.items.map(r=>r.id)).size!==index.items.length||new Set(index.items.map(r=>r.projectId+':'+r.sheet+':'+r.date)).size!==index.items.length||index.items.some(r=>!Number.isSafeInteger(r.version)||r.version<1||typeof r.date!=='string'||r.date.slice(0,7)!==month||!c.projects.some(p=>p.id===r.projectId)||!c.operatingConfigs?.some(config=>config.projectId===r.projectId)))throw new WorkbenchError('经营目录版本关系校验失败');return index;}
export async function runCompanyCheckpoints(store:CompanyStore,clock=new Date(),maxCompanies=50){
 if(Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(clock))<2)return{ok:true,skipped:'before-backup-hour'};
 const state=await store.run(async t=>({ids:(await t.get<{ids:string[]}>('registry'))?.ids||[],nextId:(await t.get<{nextId:string}>('checkpoint_cursor'))?.nextId})),ids=state.ids,day=todayShanghai(clock);let count=0,processed=0;const started=Date.now(),start=Math.max(0,ids.indexOf(state.nextId||'')),failedCompanies:string[]=[];
 for(let n=0;n<ids.length;n++){if(Date.now()-started>18000||processed>=maxCompanies)break;const i=(start+n)%ids.length,id=ids[i],nextId=ids[(i+1)%ids.length];try{const created=await store.run(async tx=>{const c=await tx.get<Company>(companyKey(id));if(!c){await tx.put('checkpoint_cursor',{nextId});return 0;}let added=0;const head=await tx.get<{payload:string;checksum:string}>('head_'+id,true);if(!head||digest(head.payload)!==head.checksum||head.payload!==JSON.stringify(c))throw new WorkbenchError('公司独立副本校验失败');const key='catalog_'+id,catalog=(await tx.get<{items:Checkpoint[]}>(key,true))?.items||[];
  for(const[kind,period]of[['daily',day],['monthly',day.slice(0,7)],['yearly',day.slice(0,4)]]as const){const bid='checkpoint_'+id+'_'+kind+'_'+period,existing=catalog.filter(x=>x.id===bid);if(existing.length){if(existing.length!==1)throw new WorkbenchError('备份目录重复');await verifiedCheckpoint(tx,id,existing[0]);continue;}const payload=JSON.stringify({format:'shixu-company-checkpoint',version:1,company:c,createdAt:clock.toISOString()}),meta={id:bid,kind,period,createdAt:clock.toISOString(),revision:c.revision,checksum:digest(payload)};await tx.put(bid,{...meta,payload},true);catalog.push(meta);added++;}
  const remove=catalog.filter(x=>x.kind==='daily').sort((a,b)=>b.period.localeCompare(a.period)).slice(c.policy.daily);for(const old of remove)await tx.remove(old.id,true);if(added||remove.length)await tx.put(key,{items:catalog.filter(x=>!remove.some(r=>r.id===x.id))},true);await tx.put('checkpoint_cursor',{nextId});
  const failure=lastFailure(await tx.get<Health>(healthKey(id)));
  await tx.put(healthKey(id),{lastAttempt:clock.toISOString(),lastSuccess:clock.toISOString(),...(failure?{lastFailure:failure}:{})});return added;
 });count+=created;}catch{failedCompanies.push(id);await store.run(async t=>{await t.put('checkpoint_cursor',{nextId});const old=await t.get<Health>(healthKey(id));await t.put(healthKey(id),{...old,lastAttempt:clock.toISOString(),lastFailure:clock.toISOString(),failureCode:'CHECKPOINT_FAILED'});});}processed++;}const pending=ids.length-processed;return{ok:pending===0&&failedCompanies.length===0,count,pending,failedCompanies};
}
export async function companyDataAction(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 const{c}=await loadCompany(tx,actor,b.companyId);if(!actor.owner)throw new WorkbenchError('只有管理员可导出或管理备份',403);
 if(b.action==='backup.health'){
  const old=await tx.get<Health>(healthKey(c.id))||{},state=old.failureCode?'failed':!old.lastSuccess?'never':clock.getTime()-Date.parse(old.lastSuccess)>36*3600000?'stale':'healthy';
  return{health:{...old,lastFailure:lastFailure(old),state,staleAfterHours:36,previousDay:await previousCheckpointDay(tx,c,clock)},drill:await tx.get<Drill>('backup_drill_'+c.id)};
 }
 if(b.action==='backup.drill.start'){const total=2+archiveVersionCount(c)+Object.keys(c.reportMonths||{}).length+Object.keys(c.operatingMonths||{}).length,drill:Drill={id:'drill_'+digest(c.id+':'+clock.toISOString()+':'+Math.random()).slice(0,24),revision:c.revision,state:'running',checked:0,total,startedAt:clock.toISOString()};await tx.put('backup_drill_'+c.id,drill);return{drill};}
 if(b.action==='backup.drill.step'){
  const drill=await tx.get<Drill>('backup_drill_'+c.id);if(!drill||b.id!==drill.id)throw new WorkbenchError('演练任务不存在或已更新',409);if(drill.state!=='running')return{drill};
  const limit=b.limit===undefined?5:b.limit;if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new WorkbenchError('演练批次无效');
  try{if(c.revision!==drill.revision){drill.failureCode='SOURCE_CHANGED';throw new Error('changed');}
   for(let n=0;n<limit&&drill.checked<drill.total;n++){
    let offset=drill.checked;if(offset<2){const copy=await mirror(tx,offset===0?'head_'+c.id:'directory_'+c.id+'_'+c.revision);if(JSON.stringify(copy)!==JSON.stringify(c))throw new Error('directory');}
    else{offset-=2;let found=false;for(const p of c.projects){if(offset>=p.version){offset-=p.version;continue;}const v=await mirror(tx,versionKey(p.id,offset+1));if(!v.project||v.project.id!==p.id||v.project.companyId!==c.id||v.project.version!==offset+1)throw new Error('project');await checkMirrorVersion(tx,c,v);found=true;break;}
     if(!found)for(const month of Object.keys(c.reportMonths||{}).sort()){const m=c.reportMonths![month];if(offset>=1+m.versions){offset-=1+m.versions;continue;}const index=await mirror(tx,reportIndexKey(c.id,month)+'_'+m.revision) as ReportIndex;if(index.revision!==m.revision||index.items.length!==m.count||index.versions!==m.versions||index.items.reduce((n,x)=>n+x.version,0)!==m.versions||new Set(index.items.map(x=>x.id)).size!==index.items.length)throw new Error('index');if(offset===0){found=true;break;}offset--;for(const r of index.items){if(offset>=r.version){offset-=r.version;continue;}const v=await mirror(tx,reportVersionKey(r.id,offset+1));if(!v.report||v.report.id!==r.id||v.report.companyId!==c.id||v.report.projectId!==r.projectId||v.report.version!==offset+1||v.report.start.slice(0,7)!==month||!c.projects.some(p=>p.id===r.projectId))throw new Error('report');await checkMirrorVersion(tx,c,v);if(v.report.version===r.version){const head={...(v.report.authorLogin?{authorLogin:v.report.authorLogin}:{}),id:v.report.id,projectId:v.report.projectId,kind:v.report.kind,start:v.report.start,end:v.report.end,status:v.report.status,version:v.report.version,publishedVersion:v.report.publishedVersion,submittedBy:v.report.submittedBy};if(!sameArchiveValue(head,r))throw new Error('report head');}found=true;break;}break;}
     if(!found)for(const month of Object.keys(c.operatingMonths||{}).sort()){const m=c.operatingMonths![month];if(offset>=1+m.versions){offset-=1+m.versions;continue;}const index=await operatingIndex(tx,c,month);if(offset===0){found=true;break;}offset--;for(const r of index.items){if(offset>=r.version){offset-=r.version;continue;}const v=await mirror(tx,operatingVersionKey(r.id,offset+1));if(!v.operating||v.operating.id!==r.id||v.operating.companyId!==c.id||v.operating.projectId!==r.projectId||v.operating.sheet!==r.sheet||v.operating.date!==r.date||v.operating.version!==offset+1)throw new Error('operating');await checkMirrorVersion(tx,c,v);if(v.operating.version===r.version&&!sameArchiveValue(operatingHead(v.operating),r))throw new Error('operating head');found=true;break;}break;}
     if(!found)throw new Error('incomplete');}
    drill.checked++;
   }
   if(drill.checked===drill.total){drill.state='passed';drill.completedAt=clock.toISOString();}
  }catch{drill.state='failed';drill.failureCode||='INTEGRITY_FAILED';drill.completedAt=clock.toISOString();}
  await tx.put('backup_drill_'+c.id,drill);return{drill};
 }
 if(b.action==='backup.list')return{backups:((await tx.get<{items:Checkpoint[]}>('catalog_'+c.id,true))?.items||[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),policy:c.policy};
 if(b.action==='backup.preview'){if(typeof b.id!=='string')throw new WorkbenchError('备份编号无效');const meta=((await tx.get<{items:Checkpoint[]}>('catalog_'+c.id,true))?.items||[]).find(x=>x.id===b.id);if(!meta)throw new WorkbenchError('备份不存在',404);const snapshot=await verifiedCheckpoint(tx,c.id,meta);return{checkpoint:meta,members:snapshot.company.members.length,projects:snapshot.company.projects.length};}
 const total=archiveVersionCount(c);
 if(b.action==='export.start'){const manifest={format:'shixu-company-export',version:3,exportedAt:clock.toISOString(),company:c,revision:c.revision,totalVersions:total};return{...manifest,manifestChecksum:digest(JSON.stringify(manifest))};}
 if(b.action!=='export.page')throw new WorkbenchError('不支持的数据保存操作');if(b.revision!==c.revision)throw new WorkbenchError('导出期间数据已发生变化，请重新导出',409);if(!Number.isSafeInteger(b.offset)||b.offset<0||b.offset>total)throw new WorkbenchError('导出位置无效');
 const versions:ArchiveVersion[]=[];let skip=b.offset;async function read(key:string,id:string,v:number,kind:'project'|'report'|'operating'){const doc=await tx.get<{payload:string;checksum:string}>(key,true);if(!doc||digest(doc.payload)!==doc.checksum)throw new WorkbenchError('独立版本副本校验失败，导出已停止');const data=JSON.parse(doc.payload),record=data[kind];if(!record||record.companyId!==c.id||record.id!==id||record.version!==v)throw new WorkbenchError('版本关系校验失败');await checkMirrorVersion(tx,c,data);versions.push({...data,checksum:doc.checksum});return record;}
 for(const item of c.projects){if(skip>=item.version){skip-=item.version;continue;}for(let v=skip+1;v<=item.version&&versions.length<10;v++)await read(versionKey(item.id,v),item.id,v,'project');skip=0;if(versions.length===10)break;}
 if(versions.length<10)for(const month of Object.keys(c.reportMonths||{}).sort()){const meta=c.reportMonths![month];if(skip>=meta.versions){skip-=meta.versions;continue;}const doc=await tx.get<{payload:string;checksum:string}>(reportIndexKey(c.id,month)+'_'+meta.revision,true);if(!doc||digest(doc.payload)!==doc.checksum)throw new WorkbenchError('报表目录副本校验失败');const index=JSON.parse(doc.payload)as ReportIndex;if(index.revision!==meta.revision||index.items.length!==meta.count||index.items.reduce((n,x)=>n+x.version,0)!==meta.versions)throw new WorkbenchError('报表目录版本关系校验失败');for(const item of index.items){if(skip>=item.version){skip-=item.version;continue;}for(let v=skip+1;v<=item.version&&versions.length<10;v++)await read(reportVersionKey(item.id,v),item.id,v,'report');skip=0;if(versions.length===10)break;}if(versions.length===10)break;}
 if(versions.length<10)for(const month of Object.keys(c.operatingMonths||{}).sort()){const meta=c.operatingMonths![month];if(skip>=meta.versions){skip-=meta.versions;continue;}const index=await operatingIndex(tx,c,month);for(const item of index.items){if(skip>=item.version){skip-=item.version;continue;}for(let v=skip+1;v<=item.version&&versions.length<10;v++){const r=await read(operatingVersionKey(item.id,v),item.id,v,'operating');if(!sameArchiveValue({projectId:r.projectId,sheet:r.sheet,date:r.date},{projectId:item.projectId,sheet:item.sheet,date:item.date})||v===item.version&&!sameArchiveValue(operatingHead(r),item))throw new WorkbenchError('经营最新版本与目录不一致');}skip=0;if(versions.length===10)break;}if(versions.length===10)break;}
 return{versions,offset:b.offset+versions.length,total};
}
