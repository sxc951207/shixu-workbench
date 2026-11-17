import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyDataAction} from '../cloud/company/checkpoints.ts';
import {parseCompanyArchive} from '../lib/workbench/company-archive.ts';
import {executeReport} from '../cloud/company/reports.ts';

test('individual daily submissions stay separate and weekly sources include only supervisor-confirmed employee versions',async()=>{
 const f=await companyFixture();
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version:f.project.version,name:'项目甲',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff','other']});
 const api=(actor:any,body:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 const daily={action:'report.create',projectId:f.project.id,kind:'daily',periodDate:'2026-11-11'};
 let a=(await api(f.staff,daily)).report;
 const b=(await api(f.other,daily)).report;
 assert.notEqual(a.id,b.id);
 assert.equal((await api(f.staff,daily)).report.id,a.id);
 const list={action:'report.list',scope:'summary',kind:'daily',periodDate:daily.periodDate};
 const week=(await api(f.staff,{...daily,kind:'weekly'})).report;
 const sources=()=>api(f.staff,{action:'report.dailySources',id:week.id});
 a=(await api(f.staff,{action:'report.save',id:a.id,version:a.version,achievement:'交付门店清单',risk:'待复核',next:'回访',help:'',progress:null,sourceVersions:[]})).report;
 await assert.rejects(api(f.other,{action:'report.get',id:a.id}));
 a=(await api(f.staff,{action:'report.submit',id:a.id,version:a.version})).report;
 assert.equal((await api(f.leader,list)).total,0);
 assert.equal((await sources()).sources.length,0);
 a=(await api(f.manager,{action:'report.approve',id:a.id,version:a.version,comment:''})).report;
 assert.equal((await api(f.leader,list)).reports[0].achievement,a.achievement);
 assert.equal((await sources()).sources[0].achievement,a.achievement);
 await api(f.staff,{action:'report.amend',id:a.id,version:a.version});
 assert.equal((await sources()).sources[0].version,a.version);
 const backup=(body:any)=>f.store.run(tx=>companyDataAction(tx,f.owner,{companyId:f.company.id,...body}));
 const manifest=await backup({action:'export.start'}),versions=[];
 for(let offset=0;offset<manifest.totalVersions;){const page=await backup({action:'export.page',revision:manifest.revision,offset});versions.push(...page.versions);offset=page.offset;}
 assert.equal(parseCompanyArchive({...manifest,versions}).totalVersions,manifest.totalVersions);
});

test('a reviewing supervisor can submit a personal daily to the designated project leader',async()=>{
 const f=await companyFixture();
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version:f.project.version,name:'项目甲',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff'],progressLeaderLogin:'leader'});
 const api=(actor:any,body:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 let r=(await api(f.manager,{action:'report.create',projectId:f.project.id,kind:'daily',periodDate:'2026-11-12'})).report;
 r=(await api(f.manager,{action:'report.save',id:r.id,version:r.version,achievement:'完成抽查',risk:'',next:'',help:'',progress:null,sourceVersions:[]})).report;
 r=(await api(f.manager,{action:'report.submit',id:r.id,version:r.version})).report;
 assert.equal(r.reviewerLogin,'leader');
 assert.equal((await api(f.leader,{action:'report.list',kind:'daily',periodDate:r.start,scope:'review'})).reports.length,1);
 await assert.rejects(api(f.manager,{action:'report.approve',id:r.id,version:r.version,comment:''}));
 assert.equal((await api(f.leader,{action:'report.approve',id:r.id,version:r.version,comment:''})).report.status,'approved');
});
test('a monthly suggestion reads approved weeks spanning either month boundary and retains the published version during correction',async()=>{
 const f=await companyFixture();
 const api=(actor:any,body:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 const create=(kind:string,periodDate:string)=>api(f.staff,{action:'report.create',projectId:f.project.id,kind,periodDate});
 const month=(await create('monthly','2026-11')).report;
 for(const day of ['2026-10-31','2026-11-05']){
  let w=(await create('weekly',day)).report;
  w=(await api(f.staff,{action:'report.save',id:w.id,version:w.version,achievement:'周成果',progress:40,risk:'',next:'',help:'',sourceVersions:[]})).report;
  w=(await api(f.staff,{action:'report.submit',id:w.id,version:w.version})).report;
  w=(await api(f.manager,{action:'report.approve',id:w.id,version:w.version,comment:''})).report;
  await api(f.staff,{action:'report.amend',id:w.id,version:w.version});
 }
 await create('weekly','2026-11-10');
 const rows=(await api(f.staff,{action:'report.weeklySources',id:month.id})).sources;
 assert.deepEqual(rows.map((s:any)=>s.start),['2026-10-26','2026-11-02']);
 assert.ok(rows.every((s:any)=>s.version===4));
});

test('company administrator can write an own daily report and submit to the project supervisor',async()=>{
 const f=await companyFixture();
 const api=(actor:any,b:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...b},COMPANY_NOW));
 const projects=await api(f.owner,{action:'report.projects',kind:'daily'});
 assert.ok(projects.projects.some((p:any)=>p.id===f.project.id));
 let r=(await api(f.owner,{action:'report.create',projectId:f.project.id,kind:'daily',periodDate:'2026-11-11'})).report;
 assert.equal(r.authorLogin,'owner');
 r=(await api(f.owner,{action:'report.save',id:r.id,version:r.version,achievement:'核对日报',progress:null,risk:'',next:'',help:'',sourceVersions:[]})).report;
 r=(await api(f.owner,{action:'report.submit',id:r.id,version:r.version})).report;
 assert.equal(r.submittedName,'管理员');
 await assert.rejects(api(f.owner,{action:'report.approve',id:r.id,version:r.version}));
 assert.equal((await api(f.manager,{action:'report.approve',id:r.id,version:r.version,comment:''})).report.status,'approved');
 await assert.rejects(api(f.other,{action:'report.create',projectId:f.project.id,kind:'daily',periodDate:r.start}));
});

test('daily writing entry preserves own project status outside the visible list page and excludes peers and confirmed-only scopes',async()=>{
 const f=await companyFixture();
 const api=(actor:any,body:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 const day={kind:'daily',periodDate:'2026-11-12'};
 await api(f.staff,{...day,action:'report.create',projectId:f.project.id});
 await api(f.manager,{...day,action:'report.create',projectId:f.project.id});
 const query={...day,action:'report.list',scope:'mine',page:1};
 const listing=await api(f.staff,query);
 assert.deepEqual(listing.reports,[]);
 assert.deepEqual(listing.myDailyStatuses,{[f.project.id]:'draft'});
 assert.deepEqual((await api(f.other,query)).myDailyStatuses,{});
 assert.equal((await api(f.leader,{...query,scope:'summary'})).myDailyStatuses,undefined);
 assert.equal((await api(f.manager,{...query,scope:'review'})).myDailyStatuses,undefined);
});
