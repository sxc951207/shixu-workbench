import {registerCompany} from './login-company.ts';
import {randomUUID} from 'node:crypto';
import {WorkbenchError,todayShanghai} from '../../lib/workbench/domain.ts';
import {ARCHIVE_MAX_BYTES,ARCHIVE_MAX_VERSIONS,archiveApprovalAction,archiveRecord,archiveManifest,parseArchiveVersion,projectArchiveHead,sameArchiveValue,withoutArchiveChecksum} from '../../lib/workbench/company-archive.ts';
import type {ArchiveManifest,ArchiveVersion} from '../../lib/workbench/company-archive.ts';
import type {Actor,Company,Project,PeriodReport,ReportHead,ReportIndex} from './model.ts';
import type {CompanyTx} from './store.ts';
import {companyKey,digest,loadCompany,saveDirectory,versionKey} from './core.ts';
import {reportIndexKey,reportVersionKey} from './reports.ts';
import type {OperatingRecord,OperatingIndex} from './operating-model.ts';
import {operatingIndexKey,operatingVersionKey,operatingHead} from './operating.ts';

import {updatePendingApprovers} from './approval-flow.ts';
type Job={pendingApprovers?:Company['pendingApprovers'];id:string;anchorId:string;sourceKey:string;destinationId:string;state:'uploading'|'validating'|'ready'|'restoring'|'checking'|'complete';totalRecords:number;totalBytes:number;nextRecord:number;nextPart:number;recordBytes:number;uploadedBytes:number;validated:number;restored:number;checked:number;indexesWritten:number;indexesChecked:number;createdAt:string;completedAt?:string;name?:string;reportTail?:{id:string;version:number;month:string};operatingTail?:{id:string;version:number;month:string};months:Record<string,{count:number;versions:number}>;operatingMonths?:Record<string,{count:number;versions:number}>;legacyChecksums:boolean};
const jobKey=(id:string)=>'recovery_'+id,recordKey=(id:string,n:number)=>'recovery_record_'+id+'_'+n,partKey=(id:string,n:number,p:number)=>'recovery_part_'+id+'_'+n+'_'+p,indexKey=(id:string,month:string,kind='report')=>'recovery_index_'+id+'_'+(kind==='operating'?'operating_':'')+month,pointerKey=(id:string,key:string,v:number)=>'recovery_pointer_'+id+'_'+key+'_'+v;
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
function publicJob(j:Job){return{id:j.id,destinationId:j.destinationId,state:j.state,totalRecords:j.totalRecords,nextRecord:j.nextRecord,nextPart:j.nextPart,validated:j.validated,restored:j.restored,checked:j.checked,totalVersions:j.totalRecords-1,createdAt:j.createdAt,completedAt:j.completedAt,name:j.name,legacyChecksums:j.legacyChecksums};}
async function readRecord(tx:CompanyTx,j:Job,n:number){const d=await tx.get<{payload:string;checksum:string}>(recordKey(j.id,n));if(!d||digest(d.payload)!==d.checksum)fail('暂存备份校验失败');return JSON.parse(d.payload);}
async function manifest(tx:CompanyTx,j:Job){return archiveManifest(await readRecord(tx,j,0));}
async function sourceAt(tx:CompanyTx,j:Job,id:string,v:number){const p=await tx.get<{record:number}>(pointerKey(j.id,id,v));if(!p)fail('历史版本引用不完整');return readRecord(tx,j,p.record) as Promise<ArchiveVersion>;}
function newProject(j:Job,id:string){return'p_'+digest(j.destinationId+':'+id).slice(0,24);}
import {reportId} from './confirmed-reports.ts';
function newReport(j:Job,r:Pick<PeriodReport,'projectId'|'kind'|'start'|'authorLogin'>){return reportId(j.destinationId,newProject(j,r.projectId),r.kind,r.start,r.authorLogin);}
function newOperating(j:Job,r:Pick<OperatingRecord,'projectId'|'sheet'|'date'>){return'op_'+digest(j.destinationId+':'+newProject(j,r.projectId)+':'+r.sheet+':'+r.date).slice(0,32);}
const reportHead=(r:PeriodReport):ReportHead=>({...(r.approvalFlow?{approvalFlow:r.approvalFlow}:{}),...(r.authorLogin?{authorLogin:r.authorLogin}:{}),id:r.id,projectId:r.projectId,kind:r.kind,start:r.start,end:r.end,status:r.status,version:r.version,publishedVersion:r.publishedVersion,submittedBy:r.submittedBy});
async function transformed(tx:CompanyTx,j:Job,v:ArchiveVersion):Promise<ArchiveVersion>{
 const value=structuredClone(withoutArchiveChecksum(v)) as ArchiveVersion;
 if('project'in value){const p=value.project;for(const snapshot of [p,p.published])if(snapshot){snapshot.id=newProject(j,snapshot.id);snapshot.companyId=j.destinationId;for(const n of snapshot.work?.nudges||[])if(n.kind==='project-review')n.targetId=newProject(j,n.targetId);else if(n.kind==='report-review'){const ref=await sourceAt(tx,j,n.targetId,n.targetVersion);if(!('report'in ref))fail('督办报表引用无效');n.targetId=newReport(j,ref.report);}}}
 else if('report'in value){for(const r of [value.report,value.report.published])if(r){r.id=newReport(j,r);r.projectId=newProject(j,r.projectId);r.companyId=j.destinationId;}}
 else for(const r of [value.operating,value.operating.published])if(r){r.id=newOperating(j,r);r.projectId=newProject(j,r.projectId);r.companyId=j.destinationId;}
 return value;
}
async function validateRelations(tx:CompanyTx,j:Job,v:ArchiveVersion){
 const rec=archiveRecord(v);
 if(rec.published){const ref=await sourceAt(tx,j,rec.id,rec.published.version),confirmed=archiveRecord(ref),{published,...snapshot}=confirmed;if(ref.action!==archiveApprovalAction(v)||!sameArchiveValue(snapshot,rec.published))fail('确认快照与历史版本不一致');}
 if('report'in v){const r=v.report;for(const n of r.sourceVersions){const ref=await sourceAt(tx,j,r.projectId,n);if(!('project'in ref)||ref.action!=='project.approve'||ref.project.status!=='approved'||todayShanghai(new Date(ref.at))<r.start||todayShanghai(new Date(ref.at))>r.end)fail('报表参考来源无效');}}
 else if('project'in v)for(const p of [v.project,v.project.published])for(const n of p?.work?.nudges||[]){
  if(n.kind==='report-review'){const ref=await sourceAt(tx,j,n.targetId,n.targetVersion);if(!('report'in ref)||ref.report.projectId!==v.project.id||ref.report.status!=='submitted')fail('报表督办目标版本无效');}
  else if(n.kind==='project-review'){const ref=await sourceAt(tx,j,v.project.id,n.targetVersion);if(!('project'in ref)||ref.project.status!=='submitted'||n.targetVersion>v.project.version)fail('项目督办目标版本无效');}
 }
}
function batch(b:any){const limit=b.limit===undefined?5:b.limit;if(!Number.isSafeInteger(limit)||limit<1||limit>10)fail('恢复批次无效');return limit;}
const targetVersionKey=(v:ArchiveVersion)=>{const r=archiveRecord(v);return'project'in v?versionKey(r.id,r.version):'report'in v?reportVersionKey(r.id,r.version):operatingVersionKey(r.id,r.version);};
function recoveryMonths(m:ArchiveManifest){return[...Object.keys(m.company.reportMonths||{}).sort().map(month=>({month,kind:'report' as const})),...Object.keys(m.company.operatingMonths||{}).sort().map(month=>({month,kind:'operating' as const}))];}
async function recoveredIndex(tx:CompanyTx,j:Job,m:ArchiveManifest,entry:{month:string;kind:'report'|'operating'}){
 const key=indexKey(j.id,entry.month,entry.kind),source=await tx.get<ReportIndex|OperatingIndex>(key),meta=(entry.kind==='report'?m.company.reportMonths:m.company.operatingMonths)?.[entry.month];
 if(!source||!meta||source.revision!==meta.revision||source.versions!==meta.versions||!Array.isArray(source.items)||source.items.length!==meta.count||new Set(source.items.map(r=>r.id)).size!==source.items.length||source.items.some(r=>!Number.isSafeInteger(r.version)||r.version<1)||source.items.reduce((n,r)=>n+r.version,0)!==meta.versions)fail('恢复报表或经营目录不完整');
 const checksum=await tx.get<{checksum:string}>(key+'_checksum');
 // Recovery jobs created before v3 have report indexes without this companion checksum.
 if(entry.kind==='operating'&&!checksum||checksum&&digest(JSON.stringify(source))!==checksum.checksum)fail('恢复报表或经营目录校验失败');
 if(entry.kind==='report'){
  const index=source as ReportIndex;
  return{key:reportIndexKey(j.destinationId,entry.month),index:{...index,items:index.items.map(r=>({...r,id:newReport(j,r),projectId:newProject(j,r.projectId)}))}};
 }
 const index=source as OperatingIndex;
 return{key:operatingIndexKey(j.destinationId,entry.month),index:{...index,items:index.items.map(r=>({...r,id:newOperating(j,r),projectId:newProject(j,r.projectId)}))}};
}

export async function companyRecoveryAction(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 if(!actor.owner)fail('只有管理员可使用公司恢复工具',403);const{c:anchor}=await loadCompany(tx,actor,b.companyId);
 if(b.action==='recovery.open'){
  if(typeof b.sourceKey!=='string'||!(/^[a-f0-9]{64}$/).test(b.sourceKey)||!Number.isSafeInteger(b.totalRecords)||b.totalRecords<1||b.totalRecords>ARCHIVE_MAX_VERSIONS+1||!Number.isSafeInteger(b.totalBytes)||b.totalBytes<1||b.totalBytes>ARCHIVE_MAX_BYTES)fail('备份容量或校验编号无效');
  const id='restore_'+digest(anchor.id+':'+b.sourceKey).slice(0,32),existing=await tx.get<Job>(jobKey(id));if(existing){if(existing.totalRecords!==b.totalRecords||existing.totalBytes!==b.totalBytes)fail('相同备份编号的容量不一致');return{job:publicJob(existing)};}
  const registry=await tx.get<{ids:string[]}>('registry')||{ids:[]};if(registry.ids.length>=50)fail('公司数量已达测试版容量');
  const job:Job={id,anchorId:anchor.id,sourceKey:b.sourceKey,destinationId:'co_'+randomUUID().replaceAll('-','').slice(0,12),state:'uploading',totalRecords:b.totalRecords,totalBytes:b.totalBytes,nextRecord:0,nextPart:0,recordBytes:0,uploadedBytes:0,validated:0,restored:0,checked:0,indexesWritten:0,indexesChecked:0,createdAt:clock.toISOString(),months:{},legacyChecksums:false};await tx.put(jobKey(id),job);return{job:publicJob(job)};
 }
 if(typeof b.id!=='string'||!/^restore_[a-f0-9]{32}$/.test(b.id))fail('恢复任务编号无效');const job=await tx.get<Job>(jobKey(b.id));if(!job||job.anchorId!==anchor.id)fail('恢复任务不存在',404);
 const response=async()=>{await tx.put(jobKey(job.id),job);return{job:publicJob(job)};};
 if(b.action==='recovery.status')return{job:publicJob(job)};
 if(b.action==='recovery.upload'){
  if(!Number.isSafeInteger(b.record)||b.record<0||b.record>=job.totalRecords||!Number.isSafeInteger(b.part)||b.part<0||b.part>110||typeof b.data!=='string'||b.data.length>12000||Buffer.byteLength(b.data)>50000||typeof b.last!=='boolean'||digest(b.data)!==b.checksum)fail('上传分片校验或容量无效');
  const receipt=await tx.get<{checksum:string;last:boolean}>(partKey(job.id,b.record,b.part));if(receipt){if(receipt.checksum!==b.checksum||receipt.last!==b.last)fail('已上传分片内容不一致',409);return{job:publicJob(job)};}
  if(job.state!=='uploading'||b.record!==job.nextRecord||b.part!==job.nextPart)fail('上传位置已变化，请读取任务后续传',409);
  const bytes=Buffer.byteLength(b.data);if(job.recordBytes+bytes>1024*1024||job.uploadedBytes+bytes>job.totalBytes)fail('上传内容超过备份容量');
  await tx.put(partKey(job.id,b.record,b.part),{data:b.data,checksum:b.checksum,last:b.last});job.uploadedBytes+=bytes;job.recordBytes+=bytes;job.nextPart++;
  if(b.last){let payload='';for(let part=0;part<=b.part;part++){const p=await tx.get<{data:string;checksum:string}>(partKey(job.id,b.record,part));if(!p||digest(p.data)!==p.checksum)fail('上传分片不完整');payload+=p.data;}let raw:any;try{raw=JSON.parse(payload);}catch{fail('备份记录不是有效JSON');}
   let parsed:any;if(b.record===0){parsed=archiveManifest(raw);if(parsed.totalVersions+1!==job.totalRecords)fail('备份版本数量不一致');const{manifestChecksum,...base}=raw;if(manifestChecksum&&digest(JSON.stringify(base))!==manifestChecksum)fail('公司清单校验值不匹配');job.legacyChecksums=!manifestChecksum;}
   else{const m=await manifest(tx,job);parsed=parseArchiveVersion(raw,m);if(raw.checksum&&digest(JSON.stringify(withoutArchiveChecksum(raw)))!==raw.checksum)fail('版本校验值不匹配');if(!raw.checksum)job.legacyChecksums=true;const rec=archiveRecord(parsed);
    if(await tx.get(pointerKey(job.id,rec.id,rec.version)))fail('备份版本编号重复');let offset=b.record-1,expected:typeof m.company.projects[number]|undefined;for(const p of m.company.projects){if(offset>=p.version){offset-=p.version;continue;}expected=p;break;}
    if(expected){if(!('project'in parsed)||rec.id!==expected.id||rec.version!==offset+1)fail('项目历史版本序列不完整');if(rec.version===expected.version&&!sameArchiveValue(projectArchiveHead(rec as Project),expected))fail('最新项目与公司目录不一致');}
    else if(offset<Object.values(m.company.reportMonths||{}).reduce((n,x)=>n+x.versions,0)){if(!('report'in parsed))fail('报表历史版本顺序无效');const r=parsed.report as PeriodReport,month=r.start.slice(0,7),tail=job.reportTail;if(tail&&month<tail.month||r.version!==1&&(!tail||r.id!==tail.id||r.version!==tail.version+1))fail('报表历史版本序列不完整');
     const key=indexKey(job.id,month),index=await tx.get<ReportIndex>(key)||{revision:m.company.reportMonths![month].revision,versions:0,items:[]};if(r.version===1){if(index.items.some(x=>x.id===r.id||x.projectId===r.projectId&&x.kind===r.kind&&x.start===r.start&&x.authorLogin===r.authorLogin)||index.items.length>=m.company.reportMonths![month].count)fail('报表编号重复或数量过多');index.items.push(reportHead(r));job.months[month]||={count:0,versions:0};job.months[month].count++;}else{const previous=index.items.find(x=>x.id===r.id);if(!previous||previous.projectId!==r.projectId||previous.start!==r.start||previous.kind!==r.kind)fail('报表周期关系不一致');index.items=index.items.map(x=>x.id===r.id?reportHead(r):x);}index.versions++;job.months[month].versions++;if(index.versions>m.company.reportMonths![month].versions)fail('报表版本数量过多');await tx.put(key,index);await tx.put(key+'_checksum',{checksum:digest(JSON.stringify(index))});job.reportTail={id:r.id,version:r.version,month};
    }
    else{if(!('operating'in parsed))fail('经营历史版本顺序无效');const r=parsed.operating,month=r.date.slice(0,7),tail=job.operatingTail;if(tail&&month<tail.month||r.version!==1&&(!tail||r.id!==tail.id||r.version!==tail.version+1))fail('经营历史版本序列不完整');if(r.id!=='op_'+digest(m.company.id+':'+r.projectId+':'+r.sheet+':'+r.date).slice(0,32))fail('经营编号或周期关系无效');
     const key=indexKey(job.id,month,'operating'),meta=m.company.operatingMonths![month],index=await tx.get<OperatingIndex>(key)||{revision:meta.revision,versions:0,items:[]};job.operatingMonths||={};if(r.version===1){if(index.items.some(x=>x.id===r.id||x.projectId===r.projectId&&x.sheet===r.sheet&&x.date===r.date)||index.items.length>=meta.count)fail('经营编号重复或数量过多');index.items.push(operatingHead(r));job.operatingMonths[month]||={count:0,versions:0};job.operatingMonths[month].count++;}else{const previous=index.items.find(x=>x.id===r.id);if(!previous||previous.projectId!==r.projectId||previous.sheet!==r.sheet||previous.date!==r.date)fail('经营周期关系不一致');index.items=index.items.map(x=>x.id===r.id?operatingHead(r):x);}index.versions++;job.operatingMonths[month].versions++;if(index.versions>meta.versions)fail('经营版本数量过多');await tx.put(key,index);await tx.put(key+'_checksum',{checksum:digest(JSON.stringify(index))});job.operatingTail={id:r.id,version:r.version,month};
    }
    await tx.put(pointerKey(job.id,rec.id,rec.version),{record:b.record});
   }
   const canonical=JSON.stringify(parsed);await tx.put(recordKey(job.id,b.record),{payload:canonical,checksum:digest(canonical)});job.nextRecord++;job.nextPart=0;job.recordBytes=0;
   if(job.nextRecord===job.totalRecords){const m=await manifest(tx,job);for(const[month,meta]of Object.entries(m.company.reportMonths||{}))if(job.months[month]?.count!==meta.count||job.months[month]?.versions!==meta.versions)fail('报表历史版本不完整');for(const[month,meta]of Object.entries(m.company.operatingMonths||{}))if(job.operatingMonths?.[month]?.count!==meta.count||job.operatingMonths?.[month]?.versions!==meta.versions)fail('经营历史版本不完整');job.state='validating';}
  }
  return response();
 }
 if(b.action==='recovery.validate'){
  if(job.state==='complete')return{job:publicJob(job)};if(!['validating','ready'].includes(job.state))fail('请先完整上传备份');const m=await manifest(tx,job),limit=batch(b);for(let n=0;n<limit&&job.validated<job.totalRecords-1;n++){const v=parseArchiveVersion(await readRecord(tx,job,job.validated+1),m);await validateRelations(tx,job,v);if('project'in v)for(const p of [v.project,v.project.published])for(const reminder of p?.work?.nudges||[])if(!(reminder.recipient==='owner'||m.company.members.some(member=>member.login===reminder.recipient)))fail('督办成员关系无效');job.validated++;}if(job.validated===job.totalRecords-1)job.state='ready';const result=await response();return{...result,preview:job.state==='ready'?{sourceName:m.company.name,sourceId:m.company.id,members:m.company.members.length,projects:m.company.projects.length,reports:Object.values(m.company.reportMonths||{}).reduce((n,x)=>n+x.count,0),operating:Object.values(m.company.operatingMonths||{}).reduce((n,x)=>n+x.count,0),versions:m.totalVersions,allMembersInactive:true}:undefined};
 }
 if(b.action==='recovery.confirm'){
  if(job.state==='complete'||job.state==='restoring'||job.state==='checking')return{job:publicJob(job)};if(job.state!=='ready'||b.confirm!==true)fail('请先校验并明确确认创建独立公司副本');if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>60)fail('副本公司名称无效');job.name=b.name.trim();job.state='restoring';return response();
 }
 if(b.action==='recovery.step'){
  if(job.state==='complete')return{job:publicJob(job)};if(!['restoring','checking'].includes(job.state))fail('请先确认恢复预览');const m=await manifest(tx,job),limit=batch(b),months=recoveryMonths(m);
  if(job.state==='restoring'){
   for(let n=0;n<limit&&job.restored<m.totalVersions;n++){const v=await transformed(tx,job,parseArchiveVersion(await readRecord(tx,job,job.restored+1),m)),rec=archiveRecord(v),key=targetVersionKey(v),payload=JSON.stringify(v);await tx.put(key,v);await tx.put(key,{payload,checksum:digest(payload)},true);await tx.put(rec.id,rec);job.restored++;}
   if(job.restored===m.totalVersions){for(let n=0;n<limit&&job.indexesWritten<months.length;n++){const{index,key}=await recoveredIndex(tx,job,m,months[job.indexesWritten]),payload=JSON.stringify(index);await tx.put(key,index);await tx.put(key+'_'+index.revision,{payload,checksum:digest(payload)},true);job.indexesWritten++;}if(job.indexesWritten===months.length)job.state='checking';}
  }else{
   for(let n=0;n<limit&&job.checked<m.totalVersions;n++){const source=parseArchiveVersion(await readRecord(tx,job,job.checked+1),m),v=await transformed(tx,job,source),rec=archiveRecord(v),key=targetVersionKey(v),mirror=await tx.get<{payload:string;checksum:string}>(key,true),primary=await tx.get(key);if(!mirror||digest(mirror.payload)!==mirror.checksum||!sameArchiveValue(JSON.parse(mirror.payload),v)||!sameArchiveValue(primary,v))fail('恢复副本完整性校验失败');let latest=false;if('project'in source)latest=source.project.version===m.company.projects.find(p=>p.id===source.project.id)!.version;else if('report'in source){const index=await tx.get<ReportIndex>(indexKey(job.id,source.report.start.slice(0,7)));latest=source.report.version===index?.items.find(r=>r.id===source.report.id)?.version;}else{const index=await tx.get<OperatingIndex>(indexKey(job.id,source.operating.date.slice(0,7),'operating'));latest=source.operating.version===index?.items.find(r=>r.id===source.operating.id)?.version;}if(latest&&'projectId'in rec)updatePendingApprovers(job,rec.projectId,undefined,rec);if(latest&&!sameArchiveValue(await tx.get(rec.id),rec))fail('恢复当前版本不一致');job.checked++;}
   if(job.checked===m.totalVersions){for(let n=0;n<limit&&job.indexesChecked<months.length;n++){const{index,key}=await recoveredIndex(tx,job,m,months[job.indexesChecked]),backup=await tx.get<{payload:string;checksum:string}>(key+'_'+index.revision,true);if(!sameArchiveValue(await tx.get(key),index)||!backup||digest(backup.payload)!==backup.checksum||!sameArchiveValue(JSON.parse(backup.payload),index))fail('恢复报表或经营目录校验失败');job.indexesChecked++;}}
   if(job.checked===m.totalVersions&&job.indexesChecked===months.length){
    const registry=await tx.get<{ids:string[]}>('registry')||{ids:[]};if(registry.ids.length>=50)fail('公司数量已达容量，请保留恢复任务稍后重试');if(registry.ids.includes(job.destinationId)||await tx.get(companyKey(job.destinationId)))fail('恢复目标公司编号冲突',409);
    const expectedPending=Object.fromEntries(Object.entries(m.company.pendingApprovers||{}).map(([projectId,counts])=>[newProject(job,projectId),counts]));
    if(!sameArchiveValue(expectedPending,job.pendingApprovers||{}))fail('恢复审批待办目录与记录不一致');
    const copy:Company={...structuredClone(m.company),...(m.company.pendingApprovers?{pendingApprovers:expectedPending}:{}),id:job.destinationId,createdAt:clock.toISOString(),name:job.name!,members:m.company.members.map(member=>({...member,active:false})),projects:m.company.projects.map(p=>({...p,id:newProject(job,p.id)})),reportMonths:{...m.company.reportMonths},...(m.company.operatingConfigs?{operatingConfigs:m.company.operatingConfigs.map(config=>({...structuredClone(config),projectId:newProject(job,config.projectId)}))}:{}),...(m.company.operatingMonths?{operatingMonths:structuredClone(m.company.operatingMonths)}:{})};
    for(const schedule of copy.dailySchedules||[])schedule.projectId=newProject(job,schedule.projectId);
    for(const proposal of copy.operatingProposals||[]){
     const projectId=newProject(job,proposal.projectId);
     proposal.projectId=projectId;
     proposal.config.projectId=projectId;
    }
    await saveDirectory(tx,copy);await registerCompany(tx,registry,copy);job.state='complete';job.completedAt=clock.toISOString();
   }
  }
  return response();
 }
 fail('不支持的公司恢复操作');
}
