import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture, COMPANY_NOW} from './fixtures/company.ts';
import {companyDataAction, runCompanyCheckpoints} from '../cloud/company/checkpoints.ts';
import {companyKey, versionKey} from '../cloud/company/core.ts';
import {executeReport,reportIndexKey,reportVersionKey} from '../cloud/company/reports.ts';
import {digest} from '../cloud/company/core.ts';

test('backup health distinguishes never, success, stale and safe failure; ordinary members cannot read it', async()=>{
 const f=await companyFixture(),call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));
 assert.equal((await call({action:'backup.health'})).health.state,'never');
 await runCompanyCheckpoints(f.store,COMPANY_NOW);
 assert.equal((await call({action:'backup.health'})).health.state,'healthy');
 const later=new Date(COMPANY_NOW.getTime()+37*3600000);
 assert.equal((await f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:f.company.id},later))).health.state,'stale');
 f.fixture.failBackups(true);await runCompanyCheckpoints(f.store,later);f.fixture.failBackups(false);
 const failed=(await call({action:'backup.health'})).health;
 assert.equal(failed.state,'failed');assert.equal(failed.failureCode,'CHECKPOINT_FAILED');assert.ok(failed.lastSuccess);assert.equal(failed.lastAttempt,later.toISOString());
 await assert.rejects(f.store.run(t=>companyDataAction(t,f.staff,{action:'backup.health',companyId:f.company.id})),/管理员/);
});

test('a later failed checkpoint attempt at the same clock instant is still failed and clears only after success',async()=>{
 const f=await companyFixture(),health=()=>f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:f.company.id},COMPANY_NOW));await runCompanyCheckpoints(f.store,COMPANY_NOW);
 const original=f.fixture.read('shixu_company_backups_v1','head_'+f.company.id);f.fixture.corrupt('shixu_company_backups_v1','head_'+f.company.id,{payload:'{}',checksum:'bad'});await runCompanyCheckpoints(f.store,COMPANY_NOW);assert.equal((await health()).health.state,'failed');
 f.fixture.corrupt('shixu_company_backups_v1','head_'+f.company.id,original);await runCompanyCheckpoints(f.store,COMPANY_NOW);assert.equal((await health()).health.state,'healthy');assert.equal((await health()).health.failureCode,undefined);
});

test('previous Shanghai day checks its daily checkpoint even after a later successful run',async()=>{
 const f=await companyFixture();
 const health=async(at:string)=>(await f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:f.company.id},new Date(at)))).health;
 assert.deepEqual((await health('2026-11-13T15:59:59Z')).previousDay,{date:'2026-11-12',status:'not-due'});
 await runCompanyCheckpoints(f.store,COMPANY_NOW);
 assert.deepEqual((await health('2026-11-13T16:00:00Z')).previousDay,{date:'2026-11-13',status:'saved'});
 const key='checkpoint_'+f.company.id+'_daily_2026-11-13';
 const original=f.fixture.read('shixu_company_backups_v1',key);
 f.fixture.corrupt('shixu_company_backups_v1',key,{...original,payload:'damaged'});
 assert.equal((await health('2026-11-13T16:00:00Z')).previousDay.status,'unavailable');
 f.fixture.corrupt('shixu_company_backups_v1',key,original);
 await runCompanyCheckpoints(f.store,new Date('2026-11-15T02:00:00Z'));
 const afterGap=await health('2026-11-15T03:00:00Z');
 assert.equal(afterGap.state,'healthy');
 assert.deepEqual(afterGap.previousDay,{date:'2026-11-14',status:'missing'});
 const late=await f.run(f.owner,{action:'company.create',name:'深夜新建'},new Date('2026-11-14T15:30:00Z'));
 const firstDay=await f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:late.company.id},new Date('2026-11-14T16:00:00Z')));
 assert.equal(firstDay.health.previousDay.status,'not-due');
});

test('the last failure remains visible after recovery, including an older failure record',async()=>{
 const f=await companyFixture(),key='backup_health_'+f.company.id;
 const health=async()=>(await f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:f.company.id},COMPANY_NOW))).health;
 f.fixture.failBackups(true);await runCompanyCheckpoints(f.store,COMPANY_NOW);f.fixture.failBackups(false);
 assert.equal((await health()).lastFailure,COMPANY_NOW.toISOString());
 await f.store.run(t=>t.put(key,{lastAttempt:COMPANY_NOW.toISOString(),failureCode:'CHECKPOINT_FAILED'}));
 assert.equal((await health()).lastFailure,COMPANY_NOW.toISOString());
 const later=new Date(COMPANY_NOW.getTime()+3600000);
 await runCompanyCheckpoints(f.store,later);
 const recovered=await health();
 assert.equal(recovered.state,'healthy');assert.equal(recovered.failureCode,undefined);
 assert.equal(recovered.lastSuccess,later.toISOString());assert.equal(recovered.lastFailure,COMPANY_NOW.toISOString());
});

test('mirror drill is resumable and cannot finish before every historical version is checked',async()=>{
 const f=await companyFixture(),call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));
 const first=await call({action:'backup.drill.start'});assert.equal(first.drill.state,'running');assert.equal(first.drill.checked,0);
 let r=first;while(r.drill.state==='running')r=await call({action:'backup.drill.step',id:r.drill.id,limit:1});
 assert.equal(r.drill.state,'passed');assert.ok(r.drill.checked>=f.project.version);assert.ok(r.drill.completedAt);
 const next=await call({action:'backup.drill.start'}),key=versionKey(f.project.id,2);
 f.fixture.corrupt('shixu_company_backups_v1',key,{payload:'{}',checksum:'broken'});
 let bad=next;while(bad.drill.state==='running')bad=await call({action:'backup.drill.step',id:bad.drill.id,limit:1});
 assert.equal(bad.drill.state,'failed');assert.equal(bad.drill.failureCode,'INTEGRITY_FAILED');
 assert.equal(f.fixture.read('shixu_company_v1',companyKey(f.company.id)).id,f.company.id);
});

test('mirror drill rejects a forged confirmation snapshot even when its outer checksum is valid',async()=>{
 const f=await companyFixture(),key=versionKey(f.project.id,f.project.version),doc=f.fixture.read('shixu_company_backups_v1',key),v=JSON.parse(doc.payload);v.project.published.achievement='伪造确认';const payload=JSON.stringify(v);f.fixture.corrupt('shixu_company_backups_v1',key,{payload,checksum:digest(payload)});
 const call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));let r=await call({action:'backup.drill.start'});while(r.drill.state==='running')r=await call({action:'backup.drill.step',id:r.drill.id});assert.equal(r.drill.state,'failed');
});

async function exportedFixture(){const f=await companyFixture();let report=(await f.store.run(t=>executeReport(t,f.staff,{action:'report.create',companyId:f.company.id,projectId:f.project.id,kind:'weekly',periodDate:'2026-11-10'},COMPANY_NOW))).report;for(const[action,actor,extra]of [['report.save',f.staff,{progress:35,achievement:'本期成果',risk:'',next:'',help:'',changeReason:'周末延长营业时段',sourceVersions:[4]}],['report.submit',f.staff,{}],['report.approve',f.manager,{comment:''}]]as const)report=(await f.store.run(t=>executeReport(t,actor,{action,companyId:f.company.id,id:report.id,version:report.version,...extra},COMPANY_NOW))).report;
 const start=await f.store.run(t=>companyDataAction(t,f.owner,{action:'export.start',companyId:f.company.id})),versions=[];let offset=0;while(offset<start.totalVersions){const p=await f.store.run(t=>companyDataAction(t,f.owner,{action:'export.page',companyId:f.company.id,revision:start.revision,offset}));versions.push(...p.versions);offset=p.offset;}return{...f,report,manifest:start,versions};}

test('independent recovery resumes upload, preserves all business versions, remaps IDs and publishes only verified inactive clone',async()=>{
 const mod=await import('../cloud/company/recovery.ts').catch(()=>null);assert.equal(typeof mod?.companyRecoveryAction,'function','company recovery handler exists');
 const restoredAt=new Date('2026-11-20T08:00:00Z'),f=await exportedFixture(),run=(b:any)=>f.store.run(t=>mod!.companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},restoredAt));
 const latest=f.versions.find((v:any)=>v.project?.version===f.project.version);latest.project.work={items:[{id:'wi_test',kind:'milestone',title:'节点',notes:'',assignee:'staff',start:'2026-11-10',due:'2026-11-20',status:'open',meetingDate:null,createdAt:COMPANY_NOW.toISOString(),updatedAt:COMPANY_NOW.toISOString(),completedAt:null}],nudges:[{id:'nu_report',kind:'report-review',targetId:f.report.id,recipient:'manager',by:'staff',at:COMPANY_NOW.toISOString(),targetVersion:3},{id:'nu_project',kind:'project-review',targetId:f.project.id,recipient:'manager',by:'staff',at:COMPANY_NOW.toISOString(),targetVersion:3}]};latest.project.published.work=structuredClone(latest.project.work);delete latest.checksum;
 const source=JSON.stringify({manifest:f.manifest,versions:f.versions}),key=digest(source),opened=await run({action:'recovery.open',sourceKey:key,totalRecords:1+f.versions.length,totalBytes:Buffer.byteLength(source)});let job=opened.job;
 await assert.rejects(f.store.run(t=>mod!.companyRecoveryAction(t,f.staff,{action:'recovery.status',companyId:f.company.id,id:job.id})),/管理员/);
 const records=[f.manifest,...f.versions];for(let record=0;record<records.length;record++){const data=JSON.stringify(records[record]),args={action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)};job=(await run(args)).job;const repeat=await run(args);assert.equal(repeat.job.nextRecord,job.nextRecord);}
 assert.equal((await run({action:'recovery.open',sourceKey:key,totalRecords:records.length,totalBytes:Buffer.byteLength(source)})).job.id,job.id);
 while(job.state==='validating')job=(await run({action:'recovery.validate',id:job.id,limit:1})).job;
 assert.equal(job.state,'ready');assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);assert.ok(!(await f.run(f.owner,{action:'companies'})).companies.some((c:any)=>c.id===job.destinationId));
 await assert.rejects(f.run(f.owner,{action:'view',companyId:job.destinationId,scope:'manage'}),/公司不存在/);
 await assert.rejects(run({action:'recovery.confirm',id:job.id,name:'恢复副本'}),/确认/);
 job=(await run({action:'recovery.confirm',id:job.id,name:'恢复副本',confirm:true})).job;
 let one=await run({action:'recovery.step',id:job.id,limit:1});job=one.job;assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
 await assert.rejects(f.run(f.owner,{action:'view',companyId:job.destinationId,scope:'manage'}),/公司不存在/);
 while(job.state==='restoring'||job.state==='checking')job=(await run({action:'recovery.step',id:job.id,limit:1})).job;
 assert.equal(job.state,'complete');const copy=f.fixture.read('shixu_company_v1',companyKey(job.destinationId));assert.equal(copy.name,'恢复副本');assert.ok(copy.members.every((m:any)=>m.active===false));assert.notEqual(copy.projects[0].id,f.project.id);
 const clonedProject=f.fixture.read('shixu_company_v1',copy.projects[0].id);assert.equal(clonedProject.published.companyId,copy.id);assert.equal(clonedProject.published.id,clonedProject.id);assert.equal(clonedProject.version,f.project.version);
 const expectedReport='pr_'+digest(copy.id+':'+clonedProject.id+':weekly:'+f.report.start).slice(0,32),clonedReport=f.fixture.read('shixu_company_v1',expectedReport);assert.equal(clonedReport.projectId,clonedProject.id);assert.equal(clonedReport.published.id,expectedReport);assert.deepEqual(clonedReport.sourceVersions,[4]);assert.equal(clonedReport.changeReason,'周末延长营业时段');assert.equal(clonedReport.published.changeReason,clonedReport.changeReason);
 assert.equal(clonedProject.work.nudges[0].targetId,expectedReport);assert.equal(clonedProject.published.work.nudges[1].targetId,clonedProject.id);
 for(let v=1;v<=clonedProject.version;v++)assert.ok(f.fixture.read('shixu_company_backups_v1',versionKey(clonedProject.id,v)));
 for(let v=1;v<=clonedReport.version;v++)assert.ok(f.fixture.read('shixu_company_backups_v1',reportVersionKey(clonedReport.id,v)));
 assert.equal(f.fixture.keys().filter(k=>k.includes('/account_')).length,0);assert.deepEqual(f.fixture.read('shixu_company_v1',companyKey(f.company.id)).members.find((m:any)=>m.login==='staff').active,true);
 const restoredHealth=await f.store.run(t=>companyDataAction(t,f.owner,{action:'backup.health',companyId:copy.id},restoredAt));assert.equal(restoredHealth.health.previousDay.status,'not-due');
 const existing=await f.store.run(t=>executeReport(t,f.owner,{action:'report.create',companyId:copy.id,projectId:clonedProject.id,kind:'weekly',periodDate:'2026-11-10'},COMPANY_NOW));assert.equal(existing.existing,true);assert.equal(existing.report.id,expectedReport);
 const start=await f.store.run(t=>companyDataAction(t,f.owner,{action:'export.start',companyId:copy.id})),page=await f.store.run(t=>companyDataAction(t,f.owner,{action:'export.page',companyId:copy.id,revision:start.revision,offset:0})),{parseCompanyArchive}=await import('../lib/workbench/company-archive.ts');assert.equal(parseCompanyArchive({...start,versions:page.versions}).totalVersions,f.manifest.totalVersions);assert.ok(!JSON.stringify(page.versions).includes(f.company.id));assert.ok(!JSON.stringify(page.versions).includes(f.project.id));assert.ok(!JSON.stringify(page.versions).includes(f.report.id));
 assert.equal((await run({action:'recovery.step',id:job.id})).job.state,'complete');
});

test('fragmented uploads reject changes and failed mirror writes can retry without publishing an incomplete company',async()=>{
 const {companyRecoveryAction}=await import('../cloud/company/recovery.ts'),f=await exportedFixture(),run=(b:any)=>f.store.run(t=>companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW)),records=[f.manifest,...f.versions],source=JSON.stringify(records);let job=(await run({action:'recovery.open',sourceKey:digest(source),totalRecords:records.length,totalBytes:Buffer.byteLength(source)})).job;
 for(let record=0;record<records.length;record++){const raw=JSON.stringify(records[record]),parts=[raw.slice(0,20),raw.slice(20)];for(let part=0;part<parts.length;part++){const data=parts[part];job=(await run({action:'recovery.upload',id:job.id,record,part,data,last:part===1,checksum:digest(data)})).job;}if(record===0)await assert.rejects(run({action:'recovery.upload',id:job.id,record:0,part:0,data:'changed',last:false,checksum:digest('changed')}),/不一致/);}
 while(job.state==='validating')job=(await run({action:'recovery.validate',id:job.id})).job;job=(await run({action:'recovery.confirm',id:job.id,name:'重试副本',confirm:true})).job;
 f.fixture.failBackups(true);await assert.rejects(run({action:'recovery.step',id:job.id,limit:1}),/backup unavailable/);f.fixture.failBackups(false);
 assert.equal((await run({action:'recovery.status',id:job.id})).job.restored,0);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
 while(job.state!=='complete')job=(await run({action:'recovery.step',id:job.id})).job;assert.ok(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)));
});

test('logical duplicate reports cannot collide when IDs are remapped to a copied company',async()=>{
 const {parseCompanyArchive}=await import('../lib/workbench/company-archive.ts'),f=await exportedFixture(),manifest=structuredClone(f.manifest);delete manifest.manifestChecksum;const duplicate=f.versions.filter((v:any)=>v.report).map((v:any)=>({...v,report:{...v.report,id:'pr_'+'f'.repeat(32),published:v.report.published?{...v.report.published,id:'pr_'+'f'.repeat(32)}:null}}));
 manifest.totalVersions+=duplicate.length;const month=f.report.start.slice(0,7);manifest.company.reportMonths[month].count++;manifest.company.reportMonths[month].versions+=duplicate.length;
 assert.throws(()=>parseCompanyArchive({...manifest,versions:[...f.versions,...duplicate]}),/重复|周期/);
 const {companyRecoveryAction}=await import('../cloud/company/recovery.ts');for(const v of duplicate)delete v.checksum;const records=[manifest,...f.versions,...duplicate],raw=JSON.stringify(records),run=(b:any)=>f.store.run(t=>companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));let job=(await run({action:'recovery.open',sourceKey:digest(raw),totalRecords:records.length,totalBytes:Buffer.byteLength(raw)})).job;for(let record=0;record<1+f.versions.length;record++){const data=JSON.stringify(records[record]);job=(await run({action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)})).job;}const data=JSON.stringify(duplicate[0]);await assert.rejects(run({action:'recovery.upload',id:job.id,record:1+f.versions.length,part:0,last:true,data,checksum:digest(data)}),/报表编号重复/);
});

test('recovery independently rejects credentials and noncontiguous histories before creating company data',async()=>{
 const {companyRecoveryAction}=await import('../cloud/company/recovery.ts'),f=await exportedFixture(),run=(b:any)=>f.store.run(t=>companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));
 const malicious=structuredClone(f.manifest);delete malicious.manifestChecksum;malicious.company.members[0].auth={hash:'forbidden'};const raw=JSON.stringify(malicious),job=(await run({action:'recovery.open',sourceKey:digest(raw),totalRecords:f.versions.length+1,totalBytes:Buffer.byteLength(JSON.stringify([malicious,...f.versions]))})).job;await assert.rejects(run({action:'recovery.upload',id:job.id,record:0,part:0,last:true,data:raw,checksum:digest(raw)}),/格式|字段/);
 assert.equal((await run({action:'recovery.status',id:job.id})).job.nextRecord,0);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);assert.equal(f.fixture.keys().filter(k=>k.includes('/account_')).length,0);
 const source=JSON.stringify(f.manifest),other=(await run({action:'recovery.open',sourceKey:digest(source),totalRecords:f.versions.length+1,totalBytes:Buffer.byteLength(JSON.stringify([f.manifest,...f.versions]))})).job;await run({action:'recovery.upload',id:other.id,record:0,part:0,last:true,data:source,checksum:digest(source)});const data=JSON.stringify(f.versions[1]);await assert.rejects(run({action:'recovery.upload',id:other.id,record:1,part:0,last:true,data,checksum:digest(data)}),/序列/);
});

test('a changed current company stops the existing mirror drill instead of mixing revisions',async()=>{
 const f=await companyFixture(),call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW)),started=await call({action:'backup.drill.start'});await f.run(f.owner,{action:'policy',companyId:f.company.id,daily:180});const r=await call({action:'backup.drill.step',id:started.drill.id});assert.equal(r.drill.state,'failed');assert.equal(r.drill.failureCode,'SOURCE_CHANGED');assert.equal(r.drill.checked,0);
});

test('mirror drill verifies reports and keeps its completion separate from actual checkpoint success',async()=>{
 const f=await exportedFixture(),run=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));let result=await run({action:'backup.drill.start'});while(result.drill.state==='running')result=await run({action:'backup.drill.step',id:result.drill.id,limit:2});assert.equal(result.drill.state,'passed');assert.equal(result.drill.checked,2+f.manifest.totalVersions+1);assert.equal((await run({action:'backup.health'})).health.state,'never');
 const key=reportVersionKey(f.report.id,f.report.version),doc=f.fixture.read('shixu_company_backups_v1',key),record=JSON.parse(doc.payload);record.report.published.projectId='p_'+'f'.repeat(24);const payload=JSON.stringify(record);f.fixture.corrupt('shixu_company_backups_v1',key,{payload,checksum:digest(payload)});result=await run({action:'backup.drill.start'});while(result.drill.state==='running')result=await run({action:'backup.drill.step',id:result.drill.id});assert.equal(result.drill.state,'failed');
});

test('review: unknown report and project snapshot identities are rejected locally, by recovery and by drill; inactive known members remain valid',async()=>{
 const f=await exportedFixture(),{parseCompanyArchive,parseArchiveVersion}=await import('../lib/workbench/company-archive.ts'),{companyRecoveryAction}=await import('../cloud/company/recovery.ts');
 const badVersions=structuredClone(f.versions),draft=badVersions.find((v:any)=>v.report) as any;for(const key of ['ownerLogin','reviewerLogin','submittedBy'])draft.report[key]='unknown-'+key.toLowerCase();delete draft.checksum;
 assert.throws(()=>parseCompanyArchive({...f.manifest,versions:badVersions}),/成员|人员|关系/);
 for(const field of ['ownerLogin','reviewerLogin','submittedBy']){const historical=structuredClone(f.versions.find((v:any)=>v.report)) as any;historical.report[field]='unknown-person';assert.throws(()=>parseArchiveVersion(historical,f.manifest),/成员|人员|关系/);const current=structuredClone(f.versions.at(-1)) as any;current.report.published[field]='unknown-person';assert.throws(()=>parseArchiveVersion(current,f.manifest),/成员|人员|关系/);const project=structuredClone(f.versions.find((v:any)=>v.project?.published)) as any;project.project.published[field]='unknown-person';assert.throws(()=>parseArchiveVersion(project,f.manifest),/成员|人员|关系/);}
 const inactive=structuredClone(f.manifest);inactive.company.members.forEach((m:any)=>{m.active=false;});assert.equal(parseCompanyArchive({...inactive,versions:f.versions}).totalVersions,f.manifest.totalVersions);const ownerDraft=structuredClone(f.versions.find((v:any)=>v.report)) as any;Object.assign(ownerDraft.report,{ownerLogin:'owner',reviewerLogin:'owner',submittedBy:''});assert.ok(parseArchiveVersion(ownerDraft,inactive));
 const records=[f.manifest,...badVersions],raw=JSON.stringify(records),run=(b:any)=>f.store.run(t=>companyRecoveryAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));let job=(await run({action:'recovery.open',sourceKey:digest(raw),totalRecords:records.length,totalBytes:Buffer.byteLength(raw)})).job;for(let record=0;record<1+f.project.version;record++){const data=JSON.stringify(records[record]);job=(await run({action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)})).job;}const data=JSON.stringify(draft);await assert.rejects(run({action:'recovery.upload',id:job.id,record:1+f.project.version,part:0,last:true,data,checksum:digest(data)}),/成员|人员|关系/);assert.equal(f.fixture.read('shixu_company_v1',companyKey(job.destinationId)),undefined);
 const payload=JSON.stringify(draft);f.fixture.corrupt('shixu_company_backups_v1',reportVersionKey(draft.report.id,1),{payload,checksum:digest(payload)});const drill=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW));let result=await drill({action:'backup.drill.start'});while(result.drill.state==='running')result=await drill({action:'backup.drill.step',id:result.drill.id});assert.equal(result.drill.state,'failed');
});

test('review: existing daily, monthly and yearly checkpoint documents must be verified before advancing backup success',async()=>{
 for(const kind of ['daily','monthly','yearly']){const f=await companyFixture();await runCompanyCheckpoints(f.store,COMPANY_NOW);const call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW)),before=(await call({action:'backup.health'})).health,last=(await call({action:'backup.list'})).backups.find((x:any)=>x.kind===kind),original=f.fixture.read('shixu_company_backups_v1',last.id);f.fixture.corrupt('shixu_company_backups_v1',last.id,{...original,payload:'damaged'});const later=new Date(COMPANY_NOW.getTime()+3600000),run=await runCompanyCheckpoints(f.store,later);assert.equal(run.ok,false,kind+' checkpoint damage fails the backup attempt');const after=(await call({action:'backup.health'})).health;assert.equal(after.state,'failed');assert.equal(after.lastSuccess,before.lastSuccess);assert.equal(after.lastAttempt,later.toISOString());await assert.rejects(call({action:'backup.preview',id:last.id}),/校验失败/);}
});

test('review: missing checkpoints and mismatched document metadata cannot be treated as successful existing archives',async()=>{
 for(const mode of ['missing','metadata']){const f=await companyFixture();await runCompanyCheckpoints(f.store,COMPANY_NOW);const call=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW)),checkpoint=(await call({action:'backup.list'})).backups.find((x:any)=>x.kind==='yearly');if(mode==='missing')await f.store.run(tx=>tx.remove(checkpoint.id,true));else{const doc=f.fixture.read('shixu_company_backups_v1',checkpoint.id);f.fixture.corrupt('shixu_company_backups_v1',checkpoint.id,{...doc,revision:doc.revision+1});}assert.equal((await runCompanyCheckpoints(f.store,new Date(COMPANY_NOW.getTime()+3600000))).ok,false);assert.equal((await call({action:'backup.health'})).health.state,'failed');await assert.rejects(call({action:'backup.preview',id:checkpoint.id}),/校验失败/);}
});

test('review: mirror drills validate fields beyond the import capacity instead of skipping schema checks',async()=>{
 const f=await companyFixture(),company=f.fixture.read('shixu_company_v1',companyKey(f.company.id));company.projects[0].version=20001;await f.store.run(async tx=>{const payload=JSON.stringify(company);await tx.put(companyKey(company.id),company);await tx.put('head_'+company.id,{payload,checksum:digest(payload)},true);await tx.put('directory_'+company.id+'_'+company.revision,{payload,checksum:digest(payload)},true);});const key=versionKey(f.project.id,1),doc=f.fixture.read('shixu_company_backups_v1',key),bad=JSON.parse(doc.payload);bad.project.auth={hash:'unrelated'};const payload=JSON.stringify(bad);f.fixture.corrupt('shixu_company_backups_v1',key,{payload,checksum:digest(payload)});const run=(b:any)=>f.store.run(t=>companyDataAction(t,f.owner,{companyId:f.company.id,...b},COMPANY_NOW)),started=await run({action:'backup.drill.start'}),result=await run({action:'backup.drill.step',id:started.drill.id,limit:3});assert.equal(result.drill.state,'failed');assert.equal(result.drill.checked,2);
 const {parseArchiveVersion}=await import('../lib/workbench/company-archive.ts'),high=JSON.parse(doc.payload);high.project.version=20001;const manifest={format:'shixu-company-export' as const,version:2 as const,exportedAt:COMPANY_NOW.toISOString(),company,revision:company.revision,totalVersions:20001};assert.ok(parseArchiveVersion(high,manifest,{unboundedHistory:true}));assert.throws(()=>parseArchiveVersion(high,manifest),/容量|数量|版本/);
});
