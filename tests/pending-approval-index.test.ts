import assert from 'node:assert/strict';
import test from 'node:test';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyKey} from '../cloud/company/core.ts';
import {hasPendingApproval} from '../cloud/company/approval-flow.ts';
import {executeOperating} from '../cloud/company/operating.ts';
import {executeReport} from '../cloud/company/reports.ts';
import {organizationAction} from '../cloud/company/organization.ts';
import type {Actor} from '../cloud/company/model.ts';

test('a routed operating batch retains each date and only counts the remaining reviewers after changes, withdrawals, and retries',async()=>{
 const f=await companyFixture(),companyId=f.company.id,projectId=f.project.id;
 const directory=()=>f.fixture.read('shixu_company_v1',companyKey(companyId));
 const ops=(actor:Actor,b:object)=>f.store.run(tx=>executeOperating(tx,actor,{companyId,projectId,...b},COMPANY_NOW));
 async function configure(approvalChain:string[]){
  const c=directory(),p=c.projects.find((p:{id:string})=>p.id===projectId);
  await f.store.run(tx=>organizationAction(tx,f.owner,{companyId,action:'organization.projectChain',id:projectId,approvalChain,version:p.version,revision:c.revision},COMPANY_NOW));
 }
 const first='member.one';
 await f.run(f.owner,{companyId,action:'member.save',login:first,name:'初审人',roles:['employee'],active:true});
 const reviewer={companyId,login:first};
 await configure([first,'leader']);
 await ops(f.manager,{action:'ops.configure',revision:directory().revision,stores:[{id:'s001',name:'一店'}]});
 const submissionBatchId='4bb7a3fd-e6b7-4c17-9b8c-3e049b73103a';
 async function submitDay(date:string){
  const {record}=await ops(f.manager,{action:'ops.save',version:0,date,sheet:'revenue',rows:[{storeId:'s001',storeName:'一店',values:{revenue:530}}]});
  return (await ops(f.manager,{action:'ops.submit',id:record.id,version:record.version,submissionBatchId})).record;
 }
 const a=await submitDay('2026-11-10'),b=await submitDay('2026-11-11');
 assert.deepEqual(a.approvalFlow.names,['初审人','leader']);
 await configure(['other']);
 for(const login of [first,'leader'])assert.ok(hasPendingApproval(directory(),projectId,login));
 await assert.rejects(ops(f.other,{action:'ops.approve',id:a.id,version:a.version}),/权限/);
 const decision={action:'ops.approve',id:a.id,version:a.version};
 const next=(await ops(reviewer,decision)).record;
 assert.equal(next.status,'submitted');
 assert.equal(next.approvalFlow.index,1);
 assert.equal(next.submissionBatchId,submissionBatchId);
 assert.equal(next.published,null);
 await assert.rejects(ops(reviewer,decision));
 await ops(f.manager,{action:'ops.withdraw',id:b.id,version:b.version});
 assert.equal(hasPendingApproval(directory(),projectId,first),false);
 assert.equal(hasPendingApproval(directory(),projectId,'leader'),true);
 const returned=(await ops(f.leader,{action:'ops.return',id:a.id,version:next.version,comment:'补充凭据'})).record;
 assert.equal(returned.submissionBatchId,undefined);
 assert.equal(returned.status,'returned');
 assert.equal(directory().pendingApprovers,undefined);
 const again=(await ops(f.manager,{action:'ops.submit',id:a.id,version:returned.version})).record;
 assert.deepEqual(again.approvalFlow.steps,['other']);
 const final=(await ops(f.other,{action:'ops.approve',id:a.id,version:again.version})).record;
 assert.equal(final.status,'approved');
 assert.equal(final.published.version,final.version);
 assert.equal(directory().pendingApprovers,undefined);
});

for(const kind of ['weekly','monthly'] as const){
 test(kind+' amendments keep their original publication through a routed return and resubmission',async()=>{
  const f=await companyFixture(),companyId=f.company.id,id=f.project.id,periodDate='2026-11-11';
  const report=(actor:Actor,action:string,body:object={})=>f.store.run(tx=>executeReport(tx,actor,{companyId,action,...body},COMPANY_NOW));
  const configure=(approvalChain:string[])=>f.store.run(async tx=>{
   const c=(await tx.get(companyKey(companyId)))!,project=c.projects.find((p:{id:string})=>p.id===id);
   return organizationAction(tx,f.owner,{action:'organization.projectChain',companyId,id,version:project.version,revision:c.revision,approvalChain},COMPANY_NOW);
  });
  let r=(await report(f.staff,'report.create',{projectId:id,kind,periodDate})).report;
  const ref=()=>({id:r.id,version:r.version});
  const fields={progress:40,achievement:'已确认成果',risk:'',next:'',help:'',sourceVersions:[]};
  r=(await report(f.staff,'report.save',{...ref(),...fields})).report;
  r=(await report(f.staff,'report.submit',ref())).report;
  await configure(['other','leader']);
  r=(await report(f.manager,'report.approve',{...ref(),comment:''})).report;
  const published=r.published;
  r=(await report(f.staff,'report.amend',ref())).report;
  r=(await report(f.staff,'report.save',{...ref(),...fields,achievement:'已更正成果'})).report;
  await configure(['staff','leader']);
  await assert.rejects(report(f.staff,'report.submit',ref()),/提交人也在项目审批名单/);
  await configure(['other','leader']);
  r=(await report(f.staff,'report.submit',ref())).report;
  for(const actor of [f.manager,f.owner,f.leader])await assert.rejects(report(actor,'report.approve',{...ref(),comment:''}),/确认权限/);
  r=(await report(f.other,'report.approve',{...ref(),comment:'初审通过'})).report;
  assert.equal(r.status,'submitted');
  assert.deepEqual(r.published,published);
  const snapshot=(await report(f.leader,'report.list',{scope:'summary',kind,periodDate})).reports[0];
  assert.equal(snapshot.achievement,published.achievement);
  r=(await report(f.leader,'report.return',{...ref(),comment:'补充说明'})).report;
  r=(await report(f.staff,'report.submit',ref())).report;
  assert.equal(r.approvalFlow.index,0);
  r=(await report(f.other,'report.approve',{...ref(),comment:''})).report;
  r=(await report(f.leader,'report.approve',{...ref(),comment:''})).report;
  assert.equal(r.published.achievement,'已更正成果');
  assert.equal(r.published.version,r.version);
 });
}
