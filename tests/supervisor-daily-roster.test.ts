import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {executeReport} from '../cloud/company/reports.ts';
import {companyDataAction} from '../cloud/company/checkpoints.ts';
import {archiveManifest} from '../lib/workbench/company-archive.ts';
import {companyRecoveryAction} from '../cloud/company/recovery.ts';
import {companyKey,digest} from '../cloud/company/core.ts';

test('a supervisor sees explicit assignments and submitted states without access to an employee draft',async()=>{
 const f=await companyFixture(),date='2026-11-11';
 const api=(actor:any,action:string,body:object={})=>f.store.run(tx=>executeReport(tx,actor,{action,companyId:f.company.id,projectId:f.project.id,periodDate:date,...body},COMPANY_NOW));
 const list=(actor=f.manager)=>api(actor,'report.dailyRoster');
 const schedule=(assigned:boolean,revision:number,login='staff')=>api(f.manager,'report.dailySchedule',{login,assigned,revision});
 const blank=await list();
 assert.deepEqual(blank.rows,[]);
 assert.deepEqual(blank.projects[0].employees.map((e:any)=>e.login),['staff']);
 await assert.rejects(schedule(true,blank.companyRevision,'other'));
 await assert.rejects(list(f.staff));
 await assert.rejects(list(f.leader));
 await assert.rejects(api(f.manager,'report.dailySchedule',{assigned:true,login:'staff',revision:blank.companyRevision,projectId:'p_'+'f'.repeat(24)}));
 await schedule(true,blank.companyRevision);
 const assigned=await list();
 assert.deepEqual(assigned.rows.map((r:any)=>[r.login,r.status,r.assigned]),[['staff','due',true]]);
 const mine={kind:'daily',scope:'mine'};
 assert.deepEqual((await api(f.staff,'report.list',mine)).assignedProjectIds,[f.project.id]);
 assert.deepEqual((await api(f.other,'report.list',mine)).assignedProjectIds,[]);
 assert.deepEqual((await api(f.staff,'report.list',{...mine,periodDate:'2026-11-12'})).assignedProjectIds,[]);
 assert.deepEqual((await api(f.manager,'report.dailyRoster',{periodDate:'2026-11-12'})).rows,[]);
 const manifest=await f.store.run(tx=>companyDataAction(tx,f.owner,{companyId:f.company.id,action:'export.start'}));
 assert.deepEqual(archiveManifest(manifest).company.dailySchedules,[{projectId:f.project.id,login:'staff',month:'2026-11',days:[11]}]);
 let r=(await api(f.staff,'report.create',{kind:'daily'})).report;
 r=(await api(f.staff,'report.save',{id:r.id,version:r.version,achievement:'仅本人可见的草稿',risk:'',next:'',help:'',progress:null,sourceVersions:[]})).report;
 const draft=await list();
 assert.equal(draft.rows[0].status,'due');
 assert.ok(!JSON.stringify(draft).includes('仅本人可见的草稿'));
 await assert.rejects(api(f.manager,'report.get',{id:r.id}));
 await assert.rejects(schedule(false,assigned.companyRevision));
 await schedule(false,draft.companyRevision);
 assert.deepEqual((await api(f.staff,'report.list',mine)).assignedProjectIds,[]);
 assert.deepEqual((await list()).rows,[]);
 r=(await api(f.staff,'report.submit',{id:r.id,version:r.version})).report;
 let roster=await list();
 assert.deepEqual(roster.rows.map((v:any)=>[v.status,v.assigned,v.review?.id]),[['submitted',false,r.id]]);
 r=(await api(f.manager,'report.return',{id:r.id,version:r.version,comment:'补充日期'})).report;
 assert.equal((await list()).rows[0].status,'returned');
 r=(await api(f.staff,'report.submit',{id:r.id,version:r.version})).report;
 r=(await api(f.manager,'report.approve',{id:r.id,version:r.version,comment:''})).report;
 await api(f.staff,'report.amend',{id:r.id,version:r.version});
 roster=await list();
 assert.equal(roster.rows[0].status,'approved');
 assert.equal(roster.rows[0].review,undefined);
});

test('schedule capacity agrees with export validation and still permits changes to existing employee-months',async()=>{
 const f=await companyFixture();
 const key=companyKey(f.company.id);
 const c=f.fixture.read('shixu_company_v1',key);
 const schedules=Array.from({length:3000},(_,i)=>({projectId:f.project.id,login:i<1500?'staff':'other',month:(1970+Math.floor(i%1500/12))+'-'+String(i%1500%12+1).padStart(2,'0'),days:[1]}));
 await f.store.run(tx=>tx.put(key,{...c,dailySchedules:schedules}));
 const change=(date:string,assigned:boolean,revision=c.revision)=>f.store.run(tx=>executeReport(tx,f.manager,{companyId:c.id,action:'report.dailySchedule',projectId:f.project.id,login:'staff',periodDate:date,assigned,revision},COMPANY_NOW));
 await assert.rejects(change('2100-01-01',true),/容量/);
 const changed=await change('2026-11-15',true);
 await change('2026-11-15',false,changed.companyRevision);
 const manifest=await f.store.run(tx=>companyDataAction(tx,f.owner,{action:'export.start',companyId:c.id},COMPANY_NOW));
 assert.equal(archiveManifest(manifest).company.dailySchedules?.length,3000);
 manifest.company.dailySchedules.push({projectId:f.project.id,login:'staff',month:'2100-01',days:[1]});
 assert.throws(()=>archiveManifest(manifest));
});

test('schedules survive export and restore with the new project identity and no artificial employee draft',async()=>{
 const f=await companyFixture();
 const call=(body:object)=>f.store.run(tx=>executeReport(tx,f.manager,{companyId:f.company.id,periodDate:'2026-11-12',...body},COMPANY_NOW));
 const state=await call({action:'report.dailyRoster'});
 const command={action:'report.dailySchedule',projectId:f.project.id,login:'staff',assigned:true,revision:state.companyRevision};
 const written=await call(command);
 assert.equal((await call(command)).companyRevision,written.companyRevision);
 await call({...command,periodDate:'2026-11-13',revision:written.companyRevision});
 const backup=(body:object)=>f.store.run(tx=>companyDataAction(tx,f.owner,{companyId:f.company.id,...body},COMPANY_NOW));
 const manifest=await backup({action:'export.start'}),records=[manifest];
 assert.equal(manifest.company.reportMonths,undefined);
 for(let offset=0;offset<manifest.totalVersions;){
  const page=await backup({action:'export.page',revision:manifest.revision,offset});
  records.push(...page.versions);offset=page.offset;
 }
 const invalid=structuredClone(manifest);
 invalid.company.dailySchedules[0].days=[31];
 assert.throws(()=>archiveManifest(invalid),/日期/);
 const source=JSON.stringify(records),run=(body:object)=>f.store.run(tx=>companyRecoveryAction(tx,f.owner,{companyId:f.company.id,...body},COMPANY_NOW));
 let {job}=await run({action:'recovery.open',sourceKey:digest(source),totalRecords:records.length,totalBytes:Buffer.byteLength(source)});
 for(const [record,value] of records.entries()){
  const data=JSON.stringify(value);
  ({job}=await run({action:'recovery.upload',id:job.id,record,part:0,last:true,data,checksum:digest(data)}));
 }
 while(job.state==='validating')({job}=await run({action:'recovery.validate',id:job.id}));
 ({job}=await run({action:'recovery.confirm',id:job.id,name:'名单副本',confirm:true}));
 while(job.state==='restoring'||job.state==='checking')({job}=await run({action:'recovery.step',id:job.id}));
 assert.equal(job.state,'complete');
 const copy=f.fixture.read('shixu_company_v1',companyKey(job.destinationId));
 assert.notEqual(copy.projects[0].id,f.project.id);
 assert.deepEqual(copy.dailySchedules,[{projectId:copy.projects[0].id,login:'staff',month:'2026-11',days:[12,13]}]);
});
