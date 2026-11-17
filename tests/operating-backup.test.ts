import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyDataAction} from '../cloud/company/checkpoints.ts';
import {companyRecoveryAction} from '../cloud/company/recovery.ts';
import {companyKey,digest,saveDirectory} from '../cloud/company/core.ts';
import {executeReport} from '../cloud/company/reports.ts';
import {parseCompanyArchive,verifyCompanyArchiveChecksums} from '../lib/workbench/company-archive.ts';
import {executeOperating} from '../cloud/company/operating.ts';
import type {Company,Actor} from '../cloud/company/model.ts';

const opKey=(id:string,v:number)=>'operating_version_'+id+'_'+v;
const opIndex=(company:string)=>'operating_index_'+company+'_2026-11';
function head(r:any){return{id:r.id,projectId:r.projectId,sheet:r.sheet,date:r.date,status:r.status,version:r.version,publishedVersion:r.publishedVersion,submittedBy:r.submittedBy};}
async function fixture(){
 const f=await companyFixture();
 await f.store.run(t=>executeReport(t,f.staff,{action:'report.create',companyId:f.company.id,projectId:f.project.id,kind:'weekly',periodDate:'2026-11-10'},COMPANY_NOW));
 const opId='op_'+digest(f.company.id+':'+f.project.id+':revenue:2026-11-10').slice(0,32),stamp=COMPANY_NOW.toISOString();
 const record:any={id:opId,companyId:f.company.id,projectId:f.project.id,projectName:f.project.name,sheet:'revenue',date:'2026-11-10',status:'draft',version:1,publishedVersion:0,writerLogin:'manager',reviewerLogin:'owner',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',createdAt:stamp,updatedAt:stamp,rows:[{storeId:'s001',storeName:'旧店名',values:{revenue:12345}}],published:null};
 const versions:any[]=[];versions.push({operating:structuredClone(record),action:'ops.save',actor:'manager',at:stamp});record.status='submitted';record.version=2;record.submittedBy='manager';record.submittedName='manager';record.submittedAt=stamp;versions.push({operating:structuredClone(record),action:'ops.submit',actor:'manager',at:stamp});record.status='approved';record.version=3;record.publishedVersion=3;record.reviewerName='管理员';const {published,...snapshot}=structuredClone(record);record.published=snapshot;versions.push({operating:structuredClone(record),action:'ops.approve',actor:'管理员',at:stamp});record.status='draft';record.version=4;record.submittedAt=null;record.rows[0].values.revenue=999;versions.push({operating:structuredClone(record),action:'ops.amend',actor:'manager',at:stamp});
 await f.store.run(async tx=>{const c:any=await tx.get(companyKey(f.company.id));c.operatingConfigs=[{projectId:f.project.id,stores:[{id:'s001',name:'现店名'},{id:'s002',name:'新门店'}]}];c.operatingMonths={'2026-11':{revision:4,versions:4,count:1}};c.revision++;for(const v of versions){const payload=JSON.stringify(v);await tx.put(opKey(opId,v.operating.version),v);await tx.put(opKey(opId,v.operating.version),{payload,checksum:digest(payload)},true);}await tx.put(opId,record);const index={revision:4,versions:4,items:[head(record)]},payload=JSON.stringify(index);await tx.put(opIndex(c.id),index);await tx.put(opIndex(c.id)+'_4',{payload,checksum:digest(payload)},true);await saveDirectory(tx,c);});
 const data=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));
 const recovery=(b:any)=>f.store.run(t=>companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));
 return{...f,record,opId,data,recovery};
}
async function exported(f:Awaited<ReturnType<typeof fixture>>){const manifest=await f.data({action:'export.start'}),versions:any[]=[];let offset=0;while(offset<manifest.totalVersions){const page=await f.data({action:'export.page',revision:manifest.revision,offset});assert.ok(page.offset>offset,'export must advance');versions.push(...page.versions);offset=page.offset;}return{...manifest,versions};}
function unsigned(raw:any){const copy=structuredClone(raw);delete copy.manifestChecksum;for(const v of copy.versions)delete v.checksum;return copy;}
async function indicatorFixture(){
 const f=await fixture();
 const indicators=(companyId:string,actor:Actor,body:any)=>f.store.run(async tx=>{
  const c=(await tx.get<Company>(companyKey(companyId)))!;
  return executeOperating(tx,actor,{companyId,projectId:c.projects[0].id,revision:c.revision,...body},COMPANY_NOW);
 });
 const config=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).operatingConfigs[0];
 const template={id:'tpl_bookings',name:'预约单数',description:'',dimension:'total',writer:'project-owner',active:true,fields:[{key:'bookings',label:'预约单数',kind:'count',required:true}],metrics:[]};
 await indicators(f.company.id,f.staff,{action:'ops.proposeIndicators',stores:config.stores,templates:[template]});
 return {...f,indicators};
}
async function upload(f:Awaited<ReturnType<typeof fixture>>,file:any){const{versions,...m}=file,records=[m,...versions],source=JSON.stringify(records);let job=(await f.recovery({action:'recovery.open',sourceKey:digest(source),totalRecords:records.length,totalBytes:Buffer.byteLength(source)})).job;for(let record=0;record<records.length;record++){const data=JSON.stringify(records[record]),b={action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)};job=(await f.recovery(b)).job;assert.equal((await f.recovery(b)).job.nextRecord,job.nextRecord);}return job;}
async function templateFixture(){const f=await fixture(),template={id:'tpl_leads',name:'线索原模板',description:'自定义口径',dimension:'total',writer:'owner',fields:[{key:'leads',label:'线索数',kind:'count',required:true},{key:'spend',label:'花费',kind:'money',required:true}],metrics:[{key:'cpl',label:'每条线索花费',numerator:'spend',denominator:'leads',format:'money'}],active:true},templateId='op_'+digest(f.company.id+':'+f.project.id+':tpl_leads:2026-11-10').slice(0,32);
 await f.store.run(async tx=>{const c:any=await tx.get(companyKey(f.company.id));c.operatingConfigs[0].templates=[{...structuredClone(template),name:'线索现模板',writer:'supervisor'}];c.operatingConfigs[0].dimensionLabel='渠道';c.operatingConfigs[0].builtinSheets=['revenue'];let latest:any;for(let n=1;n<=4;n++){const source:any=await tx.get(opKey(f.opId,n)),value=structuredClone(source);for(const record of [value.operating,value.operating.published])if(record){record.id=templateId;record.sheet='tpl_leads';record.template=structuredClone(template);record.rows=[{storeId:'all',storeName:'合计',values:{leads:10,spend:n===4&&record.status==='draft'?555:12300}}];record.writerLogin='owner';record.reviewerLogin='manager';if(record.submittedBy)record.submittedBy='owner';if(record.submittedName)record.submittedName='管理员';if(record.reviewerName)record.reviewerName='manager';}const payload=JSON.stringify(value);await tx.put(opKey(templateId,n),value);await tx.put(opKey(templateId,n),{payload,checksum:digest(payload)},true);latest=value.operating;}await tx.put(templateId,latest);const index:any=await tx.get(opIndex(c.id));index.items.push(head(latest));index.versions+=4;index.revision++;const payload=JSON.stringify(index);await tx.put(opIndex(c.id),index);await tx.put(opIndex(c.id)+'_'+index.revision,{payload,checksum:digest(payload)},true);c.operatingMonths['2026-11']={revision:index.revision,versions:index.versions,count:2};c.revision++;await saveDirectory(tx,c);});return{...f,template,templateId};}

test('v3 exports every operating history independently with raw checksums and keeps old row names',async()=>{
 const f=await fixture(),file=await exported(f);assert.equal(file.version,3);assert.equal(file.totalVersions,f.project.version+1+4);assert.equal(file.versions.filter((v:any)=>v.operating).length,4);const parsed=parseCompanyArchive(file);assert.equal(parsed.versions.length,file.totalVersions);assert.deepEqual(await verifyCompanyArchiveChecksums(file,async v=>digest(v)),{checksummed:true});assert.equal(file.versions.at(-1).operating.rows[0].storeName,'旧店名');assert.equal(file.company.operatingConfigs[0].stores[0].name,'现店名');assert.equal(file.versions.at(-1).operating.published.rows[0].values.revenue,12345);
});

test('v2 remains valid without operating data and cannot silently contain new configs or versions',async()=>{
 const f=await fixture(),file=unsigned(await exported(f));file.version=2;assert.throws(()=>parseCompanyArchive(file),/备份|经营|版本/);file.versions=file.versions.filter((v:any)=>!v.operating);file.totalVersions=file.versions.length;delete file.company.operatingConfigs;delete file.company.operatingMonths;assert.equal(parseCompanyArchive(file).version,2);
});
test('a pending submission batch survives export and remapped recovery without entering its published snapshot',async()=>{
 const f=await fixture(),submissionBatchId=crypto.randomUUID();
 const submitted=await f.store.run(tx=>executeOperating(tx,f.manager,{action:'ops.submit',companyId:f.company.id,id:f.opId,version:f.record.version,submissionBatchId},COMPANY_NOW));
 const file=await exported(f),parsed=parseCompanyArchive(file);
 assert.deepEqual(await verifyCompanyArchiveChecksums(file),{checksummed:true});
 const source=parsed.versions.find(v=>'operating' in v&&v.operating.id===f.opId&&v.operating.version===submitted.record.version);
 assert.ok(source&&'operating' in source);
 assert.equal(source.operating.submissionBatchId,submissionBatchId);
 let job=await upload(f,file);
 while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id})).job;
 job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'批量提交恢复测试',confirm:true})).job;
 while(job.state!=='complete')job=(await f.recovery({action:'recovery.step',id:job.id,limit:2})).job;
 const copy=f.fixture.read('shixu_company_v1',companyKey(job.destinationId));
 const result=await f.store.run(tx=>executeOperating(tx,f.owner,{action:'ops.month',companyId:copy.id,projectId:copy.projects[0].id,month:'2026-11'},COMPANY_NOW));
 assert.equal(result.records[0].submissionBatchId,submissionBatchId);
 assert.equal(result.records[0].published.submissionBatchId,undefined);
});
test('v3 restores submitted and returned field proposals alongside the active configuration without approving them',async()=>{
 for(const status of ['submitted','returned']){
  const f=await indicatorFixture();
  const first=await exported(f);
  if(status==='returned')await f.indicators(f.company.id,f.manager,{action:'ops.reviewIndicators',proposalId:first.company.operatingProposals[0].id,approve:false,comment:'请核对口径'});
  const file=await exported(f),proposal=file.company.operatingProposals[0];
  assert.equal(parseCompanyArchive(file).company.operatingProposals![0].status,status);
  assert.deepEqual(await verifyCompanyArchiveChecksums(file),{checksummed:true});
  let job=await upload(f,file);
  while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id})).job;
  job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'指标恢复副本',confirm:true})).job;
  while(job.state!=='complete')job=(await f.recovery({action:'recovery.step',id:job.id,limit:2})).job;
  const copy=f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),projectId=copy.projects[0].id;
  assert.notEqual(projectId,proposal.projectId);
  assert.deepEqual(copy.operatingProposals,[{...proposal,projectId,config:{...proposal.config,projectId}}]);
  assert.deepEqual(copy.operatingConfigs,[{...file.company.operatingConfigs[0],projectId}]);
  assert.ok(copy.members.every((m:any)=>!m.active));
  assert.equal(f.fixture.read('shixu_company_v1',companyKey(f.company.id)).operatingProposals[0].status,status);
  if(status==='submitted'){
   for(const login of ['staff','manager']){
    const member=copy.members.find((m:any)=>m.login===login);
    await f.run(f.owner,{action:'member.save',companyId:copy.id,...member,active:true});
   }
   await f.indicators(copy.id,{companyId:copy.id,login:'manager'},{action:'ops.reviewIndicators',proposalId:proposal.id,approve:true});
   const approved=f.fixture.read('shixu_company_v1',companyKey(copy.id));
   assert.equal(approved.operatingConfigs[0].templates[0].id,'tpl_bookings');
   assert.deepEqual(approved.operatingProposals,[]);
   assert.equal(f.fixture.read('shixu_company_v1',companyKey(f.company.id)).operatingConfigs[0].templates,undefined);
  }
 }
});
test('v3 field proposals require a known project and submitter, one proposal per project and a valid candidate configuration',async()=>{
 const f=await indicatorFixture(),source=unsigned(await exported(f));
 for(const mutate of [
  (p:any)=>{p.projectId=p.config.projectId='p_'+'f'.repeat(24);},
  (p:any)=>{p.config.projectId='p_'+'f'.repeat(24);},
  (p:any)=>{p.submittedBy='missing-person';},
  (p:any)=>{p.status='approved';},
  (p:any)=>{p.config.templates[0].writer='owner';},
  (p:any,c:any)=>{c.operatingProposals.push({...p,id:'ip_'+'a'.repeat(24)});}
 ]){
  const file=structuredClone(source);
  mutate(file.company.operatingProposals[0],file.company);
  assert.throws(()=>parseCompanyArchive(file),/指标|关系|方案|格式|字段/);
  await assert.rejects(upload(f,file),/指标|关系|方案|格式|字段/);
 }
 const old=structuredClone(source);
 delete old.company.operatingProposals;
 assert.equal(parseCompanyArchive(old).company.operatingProposals,undefined);
 old.version=2;
 delete old.company.operatingConfigs;
 delete old.company.operatingMonths;
 old.versions=old.versions.filter((v:any)=>!v.operating);
 old.totalVersions=old.versions.length;
 assert.equal(parseCompanyArchive(old).version,2);
 old.company.operatingProposals=source.company.operatingProposals;
 assert.throws(()=>parseCompanyArchive(old),/v3|版本|备份/);
});

test('v3 rejects operating dangling config, project, member, missing version, forged snapshot and credentials',async()=>{
 const f=await fixture(),base=unsigned(await exported(f));
 for(const mutate of [(x:any)=>x.company.operatingConfigs=[],(x:any)=>x.company.operatingConfigs[0].projectId='p_'+'f'.repeat(24),(x:any)=>x.versions.at(-1).operating.writerLogin='unknown-user',(x:any)=>x.versions.splice(x.versions.length-2,1),(x:any)=>x.versions.at(-1).operating.published.rows[0].values.revenue=1,(x:any)=>x.versions.at(-1).operating.auth={hash:'secret'},(x:any)=>x.company.operatingMonths['2026-11'].count++]){const file=structuredClone(base);mutate(file);assert.throws(()=>parseCompanyArchive(file),/备份|经营|关系|完整|快照|格式|版本/);}
});

test('operating mirror drill checks monthly indexes, all versions and confirmation history',async()=>{
 for(const damage of ['none','index','missing','snapshot']){const f=await fixture();if(damage==='index'){const key=opIndex(f.company.id)+'_4',v=JSON.parse(f.fixture.read('shixu_company_backups_v1',key).payload);v.items[0].status='returned';const payload=JSON.stringify(v);f.fixture.corrupt('shixu_company_backups_v1',key,{payload,checksum:digest(payload)});}if(damage==='missing')await f.store.run(tx=>tx.remove(opKey(f.opId,2),true));if(damage==='snapshot'){const key=opKey(f.opId,4),v=JSON.parse(f.fixture.read('shixu_company_backups_v1',key).payload);v.operating.published.rows[0].values.revenue=1;const payload=JSON.stringify(v);f.fixture.corrupt('shixu_company_backups_v1',key,{payload,checksum:digest(payload)});}let r=await f.data({action:'backup.drill.start'});while(r.drill.state==='running')r=await f.data({action:'backup.drill.step',id:r.drill.id,limit:1});assert.equal(r.drill.state,damage==='none'?'passed':'failed',damage);if(damage==='none')assert.equal(r.drill.checked,2+f.project.version+1+1+4+1);}
});

test('operating recovery resumes into inactive independent company, remaps config, snapshots and indexes',async()=>{
 const f=await fixture(),file=await exported(f);let job=await upload(f,file),preview:any;while(job.state==='validating'){const r=await f.recovery({action:'recovery.validate',id:job.id,limit:1});job=r.job;preview=r.preview;}assert.equal(preview.operating,1);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'经营独立恢复',confirm:true})).job;
 f.fixture.failBackups(true);await assert.rejects(f.recovery({action:'recovery.step',id:job.id,limit:1}),/backup unavailable/);f.fixture.failBackups(false);assert.equal((await f.recovery({action:'recovery.status',id:job.id})).job.restored,0);
 while(job.state!=='complete'){job=(await f.recovery({action:'recovery.step',id:job.id,limit:1})).job;if(job.state!=='complete')assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);}
 const c=f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),projectId=c.projects[0].id,id='op_'+digest(c.id+':'+projectId+':revenue:2026-11-10').slice(0,32),r=f.fixture.read('shixu_company_v1',id);assert.ok(c.members.every((m:any)=>!m.active));assert.equal(c.operatingConfigs[0].projectId,projectId);assert.equal(r.projectId,projectId);assert.equal(r.companyId,c.id);assert.equal(r.published.id,id);assert.equal(r.published.projectId,projectId);assert.equal(r.published.companyId,c.id);assert.equal(r.rows[0].storeName,'旧店名');assert.deepEqual(c.operatingMonths,file.company.operatingMonths);for(let v=1;v<=4;v++){const raw=f.fixture.read('shixu_company_backups_v1',opKey(id,v));assert.equal(digest(raw.payload),raw.checksum);}assert.equal(f.fixture.read('shixu_company_v1',opIndex(c.id)).items[0].id,id);assert.equal(f.fixture.keys().filter(k=>k.includes('/account_')).length,0);assert.equal(f.fixture.read('shixu_company_v1',f.opId).rows[0].values.revenue,999);
 const data=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:c.id,...b},COMPANY_NOW)),manifest=await data({action:'export.start'}),versions:any[]=[];for(let offset=0;offset<manifest.totalVersions;){const p=await data({action:'export.page',revision:manifest.revision,offset});versions.push(...p.versions);offset=p.offset;}assert.equal(parseCompanyArchive({...manifest,versions}).totalVersions,file.totalVersions);assert.ok(!JSON.stringify(versions).includes(f.company.id));
});

test('operating restore independently rejects forged confirmation history before any copy is visible',async()=>{
 const f=await fixture(),file=unsigned(await exported(f));file.versions.at(-1).operating.published.rows[0].values.revenue=1;let job=await upload(f,file);await assert.rejects(async()=>{while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id,limit:1})).job;},/快照|历史/);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
});

test('operating exports stop on a broken version checksum and never return a partial file as complete',async()=>{
 const f=await fixture(),start=await f.data({action:'export.start'}),key=opKey(f.opId,2),doc=f.fixture.read('shixu_company_backups_v1',key);f.fixture.corrupt('shixu_company_backups_v1',key,{...doc,checksum:'0'.repeat(64)});await assert.rejects(f.data({action:'export.page',revision:start.revision,offset:0}),/校验/);
});

test('server upload rejects noncontiguous operating histories and leaves the copy unpublished',async()=>{
 const f=await fixture(),file=unsigned(await exported(f)),{versions,...m}=file,records=[m,...versions],raw=JSON.stringify(records);let job=(await f.recovery({action:'recovery.open',sourceKey:digest(raw),totalRecords:records.length,totalBytes:Buffer.byteLength(raw)})).job;
 const start=1+versions.findIndex((v:any)=>v.operating);for(let record=0;record<start;record++){const data=JSON.stringify(records[record]);job=(await f.recovery({action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)})).job;}const data=JSON.stringify(records[start+1]);await assert.rejects(f.recovery({action:'recovery.upload',id:job.id,record:start,part:0,last:true,data,checksum:digest(data)}),/序列|完整/);assert.equal((await f.recovery({action:'recovery.status',id:job.id})).job.nextRecord,start);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
});

test('corrupt staged operating index cannot publish a copy with omitted records',async()=>{
 const f=await fixture(),file=await exported(f);let job=await upload(f,file);while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id})).job;const key='recovery_index_'+job.id+'_operating_2026-11',index=f.fixture.read('shixu_company_v1',key);index.items=[];f.fixture.corrupt('shixu_company_v1',key,index);job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'不得出现的残缺副本',confirm:true})).job;await assert.rejects(async()=>{while(job.state!=='complete')job=(await f.recovery({action:'recovery.step',id:job.id,limit:1})).job;},/目录|完整|经营/);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
});

test('template v3 histories and embedded schema survive export, drill and remapped independent recovery',async()=>{
 const f=await templateFixture(),file=await exported(f);assert.equal(parseCompanyArchive(file).totalVersions,file.totalVersions);assert.deepEqual(file.versions.at(-1).operating.template,f.template);assert.equal(file.company.operatingConfigs[0].templates[0].name,'线索现模板');assert.deepEqual(await verifyCompanyArchiveChecksums(file,async v=>digest(v)),{checksummed:true});let drill=await f.data({action:'backup.drill.start'});while(drill.drill.state==='running')drill=await f.data({action:'backup.drill.step',id:drill.drill.id,limit:2});assert.equal(drill.drill.state,'passed');
 let job=await upload(f,file);while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id})).job;job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'模板完整副本',confirm:true})).job;while(job.state!=='complete')job=(await f.recovery({action:'recovery.step',id:job.id,limit:2})).job;const c=f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),id='op_'+digest(c.id+':'+c.projects[0].id+':tpl_leads:2026-11-10').slice(0,32),record=f.fixture.read('shixu_company_v1',id);assert.deepEqual(record.template,f.template);assert.deepEqual(record.published.template,f.template);assert.deepEqual(c.operatingConfigs[0].templates,file.company.operatingConfigs[0].templates);assert.equal(c.operatingConfigs[0].dimensionLabel,'渠道');assert.equal(record.published.rows[0].values.spend,12300);assert.equal(record.rows[0].values.spend,555);
 const dangling=unsigned(file);dangling.company.operatingConfigs[0].templates=[];assert.throws(()=>parseCompanyArchive(dangling),/模板|关系|经营/);
});

test('v2 recovery jobs without newer staging index checksums can still resume safely',async()=>{
 const f=await fixture(),file=unsigned(await exported(f));file.version=2;delete file.company.operatingConfigs;delete file.company.operatingMonths;file.versions=file.versions.filter((v:any)=>!v.operating);file.totalVersions=file.versions.length;let job=await upload(f,file);while(job.state==='validating')job=(await f.recovery({action:'recovery.validate',id:job.id})).job;await f.store.run(tx=>tx.remove('recovery_index_'+job.id+'_2026-11_checksum'));job=(await f.recovery({action:'recovery.confirm',id:job.id,name:'旧任务兼容副本',confirm:true})).job;while(job.state!=='complete')job=(await f.recovery({action:'recovery.step',id:job.id,limit:1})).job;const c=f.fixture.read('shixu_company_v1',companyKey(job.destinationId));assert.equal(c.operatingConfigs,undefined);assert.equal(c.operatingMonths,undefined);assert.ok(c.members.every((m:any)=>!m.active));
});
