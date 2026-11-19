import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedAmountChange} from '../cloud/company/confirmed-amount-change.ts';
import type {CompanyTx} from '../cloud/company/store.ts';
import type {OperatingHead} from '../cloud/company/operating-model.ts';

test('confirmed changes count a correction by its delta, include real zero, and exclude a different submission',async()=>{
 const docs=new Map<string,unknown>();
 const heads:OperatingHead[]=[];
 for(const [i,after,before,batch] of [[1,100,null,'old'],[2,800,1200,'new'],[3,0,null,'new']] as const){
  const date='2026-11-0'+i,id='entry'+i;
  const base={id,projectId:'p',companyId:'c',sheet:'revenue' as const,date,version:4,publishedVersion:4,status:'approved' as const,updatedAt:date,submittedBy:'staff'};
  const rows=(value:number)=>[{storeId:'store',storeName:'直营店',values:{revenue:value}}];
  heads.push(base);docs.set(id,{published:{...base,rows:rows(after)}});
  docs.set(id+'/3',{operating:{...base,version:3,status:'submitted',submissionBatchId:batch,published:before===null?null:{...base,version:1,rows:rows(before)}}});
 }
 const tx={get:(key:string)=>Promise.resolve(docs.get(key))} as CompanyTx;
 const result=await confirmedAmountChange(tx,heads,'c','revenue',(id,v)=>id+'/'+v);
 assert.equal(result.total,-400);
 assert.deepEqual(result.rows.map(row=>[row.date,row.delta,row.first]),[['2026-11-02',-400,false],['2026-11-03',0,true]]);
});
