import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {executeReport} from '../cloud/company/reports.ts';
import {executeCompanyReview} from '../cloud/company/review.ts';

test('daily queue finds a submitter by name or account and returns a short authorized preview',async()=>{
 const f=await companyFixture();
 await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'staff',name:'张文',roles:['employee'],active:true});
 const report=(body:any)=>f.store.run(tx=>executeReport(tx,f.staff,{...body,companyId:f.company.id},COMPANY_NOW));
 const queue=(search:string)=>f.store.run(tx=>executeCompanyReview(tx,f.manager,{action:'review.list',companyId:f.company.id,type:'daily',search}));
 let r=(await report({action:'report.create',projectId:f.project.id,kind:'daily',periodDate:'2026-11-11'})).report;
 r=(await report({action:'report.save',id:r.id,version:r.version,achievement:'完成门店对账。\n另附明细。',risk:'',next:'',help:'',progress:null,sourceVersions:[]})).report;
 assert.equal((await queue('张文')).items.length,0);
 await report({action:'report.submit',id:r.id,version:r.version});
 for(const term of ['张','STAFF']){
  const items=(await queue(term)).items;
  assert.equal(items.length,1);
  assert.equal(items[0].submittedName,'张文');
  assert.equal(items[0].excerpt,'完成门店对账。');
 }
 assert.equal((await queue('无此人')).items.length,0);
});
