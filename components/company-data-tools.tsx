'use client';
import React,{useEffect,useRef,useState} from 'react';
import {companyRequest as api} from '../cloud/company-root';
import {ARCHIVE_MAX_BYTES,archiveRecordChunks,parseCompanyArchive,verifyCompanyArchiveChecksums,archiveSha256} from '../lib/workbench/company-archive';
import type {CompanyArchive} from '../lib/workbench/company-archive';
import type {PreviousCheckpointDay} from '../cloud/company/checkpoints';
import '../app/company-data-tools.css';

type Drill={id:string;state:'running'|'passed'|'failed';checked:number;total:number;startedAt:string;completedAt?:string;failureCode?:string};
export type CompanyBackupHealth={state:'never'|'healthy'|'stale'|'failed'|'unavailable';lastAttempt?:string;lastSuccess?:string;lastFailure?:string;previousDay?:PreviousCheckpointDay};
type Job={id:string;destinationId:string;state:'uploading'|'validating'|'ready'|'restoring'|'checking'|'complete';totalRecords:number;nextRecord:number;nextPart:number;totalVersions:number;validated:number;restored:number;checked:number;legacyChecksums:boolean;name?:string};
type LocalFile={archive:CompanyArchive;records:string[];sourceKey:string;totalBytes:number;checksummed:boolean};
type Preview={sourceName:string;members:number;projects:number;reports:number;operating:number;versions:number};
const date=(v?:string)=>v?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'尚无记录';
const healthText={never:'尚无自动备份运行记录',healthy:'最近一次自动备份成功',stale:'超过36小时没有成功备份',failed:'最近一次自动备份未成功',unavailable:'暂时无法读取备份状态，请刷新重试'};
const dayText={saved:'日检查点已留存并通过校验',missing:'缺少日检查点',unavailable:'日检查点暂时无法核实', 'not-due':'公司当时尚未赶上定时保存，无需补查'};
export function companyBackupAlert(health:CompanyBackupHealth){
 const messages=[];
 if(health.state==='failed'||health.state==='stale'||health.state==='unavailable')messages.push(healthText[health.state]);
 const day=health.previousDay;
 if(day&&(day.status==='missing'||day.status==='unavailable'))messages.push(day.date+' '+dayText[day.status]);
 return messages.join('。');
}
const jobText={uploading:'分片上传',validating:'核对历史与确认快照',ready:'已通过校验，等待确认',restoring:'写入独立副本',checking:'复核副本及独立镜像',complete:'独立副本已完成'};

export default function CompanyDataTools({companyId,companyName,onRestored,onBusy,disabled=false,onExport}:{disabled?:boolean;onExport?:()=>void;companyId:string;companyName:string;onRestored?:()=>void;onBusy?:(busy:boolean)=>void}){
 const[health,setHealth]=useState<CompanyBackupHealth|null>(null),[drill,setDrill]=useState<Drill|null>(null),[file,setFile]=useState<LocalFile|null>(null),[job,setJob]=useState<Job|null>(null),[preview,setPreview]=useState<Preview|null>(null),[name,setName]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[pasted,setPasted]=useState('');const pause=useRef(false),mounted=useRef(true),storageKey='shixu-company-recovery:'+companyId;
 const request=(body:any)=>api({companyId,...body});
 const locked=busy||disabled;
 async function loadHealth(){try{const r=await request({action:'backup.health'});if(mounted.current){setHealth(r.health);setDrill(r.drill);}}catch(e){if(mounted.current){setHealth({state:'unavailable'});setDrill(null);}throw e;}}
 function showJob(value:Job){if(mounted.current)setJob(value);try{localStorage.setItem(storageKey,value.id);}catch{}}
 async function task(work:()=>Promise<void>){if(locked)return;pause.current=false;setBusy(true);onBusy?.(true);setError('');setNotice('');try{await work();}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);onBusy?.(false);}}
 useEffect(()=>{mounted.current=true;pause.current=false;void loadHealth().catch(e=>setError(e.message));let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{}if(saved)void request({action:'recovery.status',id:saved}).then(async r=>{if(!mounted.current)return;showJob(r.job);if(r.job.state==='ready'){const checked=await request({action:'recovery.validate',id:saved});if(mounted.current){setPreview(checked.preview);setName(checked.preview.sourceName.slice(0,54)+' · 恢复副本');}}}).catch(()=>{});return()=>{mounted.current=false;pause.current=true;};},[companyId]);
 async function chooseFile(selected?:File){if(!selected)return;await task(async()=>{setFile(null);setPreview(null);setConfirmed(false);setJob(null);if(selected.size>ARCHIVE_MAX_BYTES)throw Error('请选择64 MiB以内的完整公司独立备份');let raw:CompanyArchive;try{raw=JSON.parse(await selected.text());}catch{throw Error('无法读取JSON备份文件');}parseCompanyArchive(raw);const checked=await verifyCompanyArchiveChecksums(raw),{versions,...manifest}=raw,records=[JSON.stringify(manifest),...versions.map(v=>JSON.stringify(v))],totalBytes=records.reduce((n,r)=>n+new TextEncoder().encode(r).byteLength,0);if(totalBytes>ARCHIVE_MAX_BYTES)throw Error('备份内容超过64 MiB');const sourceKey=await archiveSha256(JSON.stringify({manifest,versions}));if(!mounted.current)return;setFile({archive:raw,records,sourceKey,totalBytes,checksummed:checked.checksummed});setName(raw.company.name.slice(0,54)+' · 恢复副本');setNotice('本地结构与完整历史检查通过。上传校验后，可预览并确认创建新副本。');});}
 async function drillRun(start:boolean){await task(async()=>{let value:Drill=start?(await request({action:'backup.drill.start'})).drill:drill!;setDrill(value);while(value.state==='running'&&!pause.current){value=(await request({action:'backup.drill.step',id:value.id})).drill;if(mounted.current)setDrill(value);}if(mounted.current&&value.state==='passed')setNotice('完整性演练已完成，全部独立镜像记录通过校验。');});}
 async function uploadAndValidate(){await task(async()=>{let value:Job=job!;if(file){value=(await request({action:'recovery.open',sourceKey:file.sourceKey,totalRecords:file.records.length,totalBytes:file.totalBytes})).job;showJob(value!);}if(!value)throw Error('请先选择独立备份文件');if(value.state==='uploading'&&!file)throw Error('请重新选择同一份备份文件，继续上传');while(value.state==='uploading'&&!pause.current){const data=file!.records[value.nextRecord],parts=archiveRecordChunks(data),part=value.nextPart,chunk=parts[part];value=(await request({action:'recovery.upload',id:value.id,record:value.nextRecord,part,last:part===parts.length-1,data:chunk,checksum:await archiveSha256(chunk)})).job;showJob(value!);}while(value!.state==='validating'&&!pause.current){const r=await request({action:'recovery.validate',id:value!.id});value=r.job;showJob(value!);if(r.preview)setPreview(r.preview);}if(value!.state==='ready'&&!pause.current){const r=await request({action:'recovery.validate',id:value!.id});setPreview(r.preview);setNotice('服务端已验证完整版本、来源关系和确认快照。请核对副本名称并确认。');}});}
 async function restore(confirm:boolean){await task(async()=>{if(!job)return;let value=job;if(confirm){if(!confirmed)throw Error('请先勾选确认项');value=(await request({action:'recovery.confirm',id:job.id,name,confirm:true})).job;showJob(value);}while(['restoring','checking'].includes(value.state)&&!pause.current){value=(await request({action:'recovery.step',id:value.id})).job;showJob(value);}if(value.state==='complete'){setNotice('独立公司副本已创建，全部导入成员保持停用。请在成员与项目中按需重新配置测试身份。');onRestored?.();}});}
 const progress=job?job.state==='uploading'?job.nextRecord:job.state==='validating'?job.validated:job.state==='restoring'?job.restored:job.state==='checking'?job.checked:job.totalVersions:0,total=job?.state==='uploading'?job.totalRecords:job?.totalVersions||0;
 return <div className="company-data-tools">
  <section className="co-panel cdt-health">
   <div className="co-section-head"><h2>自动备份</h2><button className="co-text" disabled={locked} onClick={()=>void task(loadHealth)}>刷新状态</button></div>
   <p className={'cdt-state '+(health?.state||'loading')} role={health&&['failed','stale','unavailable'].includes(health.state)?'alert':'status'}>{health?healthText[health.state]:'正在读取备份状态…'}</p>
   <div className="co-backup-latest"><span>最近成功备份</span><strong>{health?health.state==='unavailable'?'暂时无法确认':date(health.lastSuccess):'读取中…'}</strong></div>
   {health&&health.state!=='unavailable'&&<p className="co-muted">最近失败：{date(health.lastFailure||(health.state==='failed'?health.lastAttempt:undefined))}</p>}
   {health?.lastAttempt&&health.lastAttempt!==health.lastSuccess&&<p className="co-muted">最近尝试 {date(health.lastAttempt)}</p>}
   {health?.previousDay&&<p className={['missing','unavailable'].includes(health.previousDay.status)?'cdt-state stale':'co-muted'} role={['missing','unavailable'].includes(health.previousDay.status)?'alert':'status'}>上一业务日（北京时间） {health.previousDay.date} · {dayText[health.previousDay.status]}</p>}
   <p className="co-muted">自动检查点保存在当前云环境，可在下方查看和校验。月结后请点“下载独立备份”，将含业务版本的 JSON 文件另存到公司保管的位置，可用于恢复公司副本。</p>
   <div className="cdt-actions">{onExport&&<button className="co-primary" disabled={locked} onClick={onExport}>下载独立备份</button>}
    <button className="co-text" disabled={locked} onClick={()=>void drillRun(drill?.state!=='running')}>{drill?.state==='running'?'继续演练':'开始完整性演练'}</button></div>
   {drill&&<p className="cdt-progress" role={drill.state==='failed'?'alert':'status'}>{drill.state==='failed'?'完整性演练未通过':drill.state==='passed'?'完整性演练通过':'完整性演练进行中'} · 已核对 {drill.checked} / {drill.total} 条{drill.completedAt?' · '+date(drill.completedAt):''}{drill.state==='failed'?(drill.failureCode==='SOURCE_CHANGED'?' · 期间数据变化，请重新开始':' · 请保留独立备份并检查备份服务'):''}</p>}
  </section>
  <details className="co-panel co-admin-disclosure"><summary>从独立 JSON 恢复公司副本{job&&job.state!=='complete'?' · '+jobText[job.state]:''}</summary><p>核对文件并确认后，系统会创建一家独立公司。导入的成员全部停用，当前公司“{companyName}”继续使用原数据。</p><p className="co-muted">支持 v2 / v3 公司备份，最多 20,000 个版本、64 MiB。v3 包含经营数据和门店配置。恢复范围不含账号密码、历史设置变更和定时检查点。</p>
   <label className="cdt-file">选择独立备份<input type="file" accept=".json,application/json" disabled={locked} onChange={e=>void chooseFile(e.target.files?.[0])}/></label>
   <details className="cdt-paste"><summary>无法选择文件？也可以粘贴JSON备份</summary><label>JSON备份内容<textarea rows={5} maxLength={ARCHIVE_MAX_BYTES} value={pasted} disabled={locked} spellCheck={false} placeholder="粘贴完整的公司JSON备份；检查通过后，仍需你确认才会创建副本。" onChange={e=>setPasted(e.target.value)}/></label><div className="cdt-actions"><button className="co-text" disabled={locked||!pasted.trim()} onClick={()=>void chooseFile(new File([pasted],'公司独立备份.json',{type:'application/json'}))}>检查粘贴内容</button><button className="co-text" disabled={locked||!pasted} onClick={()=>setPasted('')}>清空文本</button></div><small>仅本页暂存，先在本地检查，不会自动上传。</small></details>
   {file&&<div className="cdt-preview"><strong>本地检查：{file.archive.company.name}</strong><p>{file.archive.company.members.length} 位成员 · {file.archive.company.projects.length} 个项目 · {Object.values(file.archive.company.operatingMonths||{}).reduce((n,x)=>n+x.count,0)} 份经营记录 · {file.archive.totalVersions} 个业务版本</p><p>{file.checksummed?'清单及全部版本的校验值匹配':'旧版备份未附完整校验值；已核对字段、完整版本与确认快照，服务端将重新计算并验证暂存校验值。'}</p><button className="co-primary" disabled={locked} onClick={()=>void uploadAndValidate()}>上传并校验 / 续传</button></div>}
   {job&&<div className="cdt-job" role="status"><strong>{jobText[job.state]}</strong><p>{progress} / {total} {job.state==='uploading'?'条记录':'个业务版本'}{job.state==='complete'?' · '+job.destinationId:''}</p><progress aria-label="公司恢复进度" max={Math.max(1,total)} value={progress}/>{!busy&&job.state==='validating'&&<button className="co-text" onClick={()=>void uploadAndValidate()}>继续校验</button>}{!busy&&['restoring','checking'].includes(job.state)&&<button className="co-primary" onClick={()=>void restore(false)}>继续恢复 / 重试</button>}</div>}
   {preview&&job?.state==='ready'&&<form className="cdt-confirm" onSubmit={e=>{e.preventDefault();void restore(true);}}><h3>核对恢复预览</h3><p>来源：{preview.sourceName}<br/>{preview.members} 位成员 · {preview.projects} 个项目 · {preview.reports} 份报表 · {preview.operating||0} 份经营记录 · {preview.versions} 个业务版本</p><label>新公司副本名称<input required maxLength={60} value={name} disabled={locked} onChange={e=>setName(e.target.value)}/></label><label className="cdt-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)}/><span>确认创建独立副本；全部导入成员保持停用，完成后由管理员重新配置身份。</span></label><button className="co-primary" disabled={locked||!confirmed||!name.trim()}>确认创建独立副本</button></form>}
  </details>
  {busy&&<div className="cdt-busy"><span role="status">正在处理，可安全暂停并在本页继续。</span><button className="co-text" onClick={()=>{pause.current=true;setNotice('将在当前批次完成后暂停，进度已保留。');}}>暂停</button></div>}
  {error&&<p className="co-error" role="alert">{error}</p>}{notice&&<p className="co-notice" role="status">{notice}</p>}
 </div>;
}
