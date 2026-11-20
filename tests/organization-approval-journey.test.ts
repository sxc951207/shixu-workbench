import assert from 'node:assert/strict';
import test from 'node:test';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyRecoveryAction} from '../cloud/company/recovery.ts';
import {companyKey,digest} from '../cloud/company/core.ts';
import {executeReport} from '../cloud/company/reports.ts';
import {executeCompanyReview} from '../cloud/company/review.ts';
import {organizationAction} from '../cloud/company/organization.ts';
import {companyDataAction} from '../cloud/company/checkpoints.ts';
import {parseCompanyArchive} from '../lib/workbench/company-archive.ts';
import type {Actor,Company} from '../cloud/company/model.ts';

for(const levels of [['店员','负责人'],['店员','店长','区域经理','总部']]){
 test(levels.length+'层公司从填日报到最后确认，配置独立并可导出', async()=>{
  const f=await companyFixture(),companyId=f.company.id,id=f.project.id;
  const current=()=>f.fixture.read('shixu_company_v1',companyKey(companyId)) as Company;
  const org=(actor:Actor,action:string,body:object={})=>f.store.run(tx=>organizationAction(tx,actor,{companyId,action,revision:current().revision,...body},COMPANY_NOW));
  const report=(actor:Actor,action:string,body:object)=>f.store.run(tx=>executeReport(tx,actor,{companyId,action,...body},COMPANY_NOW));
  const review=(actor:Actor,action:string,body:object)=>f.store.run(tx=>executeCompanyReview(tx,actor,{companyId,action,...body}));
  const chain=levels.length===2?['manager']:['manager','other','leader'];
  const levelsByLogin=levels.length===2?['staff','manager']:['staff','manager','other','leader'];
  const defaults=(await org(f.owner,'organization.read')).levels; assert.ok(defaults);
  assert.deepEqual(defaults.map((l:{name:string})=>l.name),['员工','主管','领导']);
  const assignments=current().members.map(m=>{
   const index=Math.max(0,levelsByLogin.indexOf(m.login));
   return {login:m.login,levelId:'level'+index,managerId:levelsByLogin[index+1]||'owner'};
  });
  await org(f.owner,'organization.save',{levels:levels.map((name,index)=>({name,id:'level'+index})),assignments});
  assert.equal((await f.run(f.staff,{action:'view',companyId,scope:'mine'})).me.organizationLevel,'店员');
  await org(f.owner,'organization.projectChain',{id,version:current().projects[0].version,approvalChain:chain});
  let r=(await report(f.staff,'report.create',{projectId:id,kind:'daily',periodDate:'2026-11-11'})).report;
  r=(await report(f.staff,'report.save',{id:r.id,version:r.version,progress:null,achievement:'已核实门店当日业绩',risk:'',next:'',help:'',sourceVersions:[]})).report;
  r=(await report(f.staff,'report.submit',{id:r.id,version:r.version})).report;
  assert.deepEqual(r.approvalFlow.steps,chain);
  // A live configuration change must not redirect the pending employee submission.
  await org(f.owner,'organization.projectChain',{id,version:current().projects[0].version,approvalChain:['staff']});
  async function exportCurrent(restore=false){
   const base=await f.store.run(tx=>companyDataAction(tx,f.owner,{action:'export.start',companyId}));const versions=[];
   for(let offset=0;offset<base.totalVersions;){const page=await f.store.run(tx=>companyDataAction(tx,f.owner,{action:'export.page',companyId,revision:base.revision,offset}));versions.push(...page.versions);offset=page.offset;}
   const archive=parseCompanyArchive({...base,versions});
   if(restore){
    const invoke=(action:string,body:object)=>f.store.run(tx=>companyRecoveryAction(tx,f.owner,{companyId,action,...body},COMPANY_NOW));
    const records=[base,...versions].map(value=>JSON.stringify(value));
    const source=JSON.stringify(records);
    let job=(await invoke('recovery.open',{sourceKey:digest(source),totalRecords:records.length,totalBytes:Buffer.byteLength(source)})).job;
    for(const [record,data] of records.entries())job=(await invoke('recovery.upload',{id:job.id,record,part:0,last:true,data,checksum:digest(data)})).job;
    while(job.state==='validating')job=(await invoke('recovery.validate',{id:job.id})).job;
    job=(await invoke('recovery.confirm',{id:job.id,name:'在审数据恢复演练',confirm:true})).job;
    while(['restoring','checking'].includes(job.state))job=(await invoke('recovery.step',{id:job.id})).job;
    assert.equal(job.state,'complete');
    const copy=f.fixture.read('shixu_company_v1',companyKey(job.destinationId)) as Company;
    assert.deepEqual(copy.pendingApprovers?.[copy.projects[0].id],current().pendingApprovers?.[id]);
    assert.ok(!copy.pendingApprovers?.[id]);
   }
   return archive;
  }
  assert.equal((await exportCurrent(levels.length===4)).company.organizationLevels?.length,levels.length);
  for(const [index,login] of chain.entries()){
   const actor={companyId,login};
   assert.equal(r.status,'submitted');assert.equal(r.published,null);assert.equal(r.approvalFlow.index,index);
   const page=await review(actor,'review.list',{type:'daily'});
   assert.deepEqual(page.items.map((item:{id:string})=>item.id),[r.id]);
   assert.equal((await review(actor,'review.item',{id:r.id,type:'daily'})).report.id,r.id);
   await assert.rejects(review(f.staff,'review.item',{id:r.id,type:'daily'}));
   const previousVersion=r.version;
   r=(await report(actor,'report.approve',{id:r.id,version:r.version,comment:'已核对'})).report;
   await assert.rejects(report(actor,'report.approve',{id:r.id,version:previousVersion,comment:'重复确认'}));
  }
  assert.equal(r.status,'approved');assert.equal(r.published.version,r.version);
  assert.deepEqual(current().pendingApprovers??{},{});
  assert.equal((await exportCurrent()).versions.at(-1)?.action,'report.approve');
  if(levels.length===4){
   const second=(await f.run(f.owner,{action:'project.create',companyId,name:'只需要店长确认的项目',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;
   await org(f.owner,'organization.projectChain',{id:second.id,version:second.version,approvalChain:['manager']});
   let simple=(await report(f.staff,'report.create',{projectId:second.id,kind:'daily',periodDate:'2026-11-11'})).report;
   simple=(await report(f.staff,'report.save',{id:simple.id,version:simple.version,progress:null,achievement:'完成第二个项目的核对',risk:'',next:'',help:'',sourceVersions:[]})).report;
   simple=(await report(f.staff,'report.submit',{id:simple.id,version:simple.version})).report;
   assert.deepEqual(simple.approvalFlow.steps,['manager']);
   simple=(await report(f.manager,'report.approve',{id:simple.id,version:simple.version,comment:'确认'})).report;
   assert.equal(simple.status,'approved');
   assert.equal(current().organizationLevels?.length,4);
   assert.deepEqual(current().projects.find(p=>p.id===id)?.approvalChain,['staff']);
  }
 });
}
