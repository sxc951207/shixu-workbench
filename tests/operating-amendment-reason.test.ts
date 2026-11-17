import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyKey,digest} from '../cloud/company/core.ts';
import {executeOperating,operatingVersionKey} from '../cloud/company/operating.ts';
import {companyDataAction} from '../cloud/company/checkpoints.ts';
import {operatingRecordSchema} from '../lib/workbench/operating-data.ts';
import {parseCompanyArchive,verifyCompanyArchiveChecksums} from '../lib/workbench/company-archive.ts';
import type {OperatingRecord} from '../cloud/company/operating-model.ts';

async function setup(){
 const f=await companyFixture();let writes=0;
 const call=(actor:any,body:any)=>f.store.run(tx=>executeOperating({...tx,put:async(id,value,backup)=>{writes++;await tx.put(id,value,backup);}},actor,{companyId:f.company.id,...body},COMPANY_NOW));
 await call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:[{id:'s001',name:'合成门店'}],builtinSheets:['revenue']});
 let record:OperatingRecord=(await call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date:'2026-11-12',version:0,rows:[{storeId:'s001',storeName:'合成门店',values:{revenue:10000}}]})).record;
 record=(await call(f.manager,{action:'ops.submit',id:record.id,version:record.version})).record;
 record=(await call(f.owner,{action:'ops.approve',id:record.id,version:record.version,comment:'原确认意见'})).record;
 const amend=(current:OperatingRecord,reason:unknown)=>call(f.manager,{action:'ops.amend',id:current.id,version:current.version,reason});
 const save=(current:OperatingRecord,extra:any={})=>call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:current.sheet,date:current.date,version:current.version,rows:[{storeId:'s001',storeName:'合成门店',values:{revenue:20000}}],...extra});
 const data=(body:any)=>f.store.run(tx=>companyDataAction(tx,f.owner,{companyId:f.company.id,...body},COMPANY_NOW));
 const snapshot=()=>f.fixture.keys().sort().map(key=>{const slash=key.indexOf('/');return [key,f.fixture.read(key.slice(0,slash),key.slice(slash+1))];});
 return {...f,call,record,amend,save,data,snapshot,writeCount:()=>writes};
}

for(const [label,reason] of [['missing',undefined],['null',null],['number',123],['object',{}],['empty',''],['blank',' \n\t '],['overlong','更'.repeat(1001)]] as const){
 test('new amendment rejects '+label+' reason before any write',async()=>{
  const f=await setup(),before=f.snapshot(),writes=f.writeCount();
  await assert.rejects(f.amend(f.record,reason),/原因|填写|长度|内容/);
  assert.equal(f.writeCount(),writes,'invalid input must not even attempt a write');
  assert.deepEqual(f.snapshot(),before,'record/index/company/history/backups stay untouched');
 });
}

test('amendment stores a trimmed separate reason and preserves the old approved comment and snapshot',async()=>{
 const f=await setup(),approved=structuredClone(f.record);
 const record=(await f.amend(approved,'  核对原始小票，补录漏记的核销金额。 \n')).record;
 assert.equal(record.amendmentReason,'核对原始小票，补录漏记的核销金额。');
 assert.equal(record.comment,'');assert.equal(record.status,'draft');assert.equal(record.version,approved.version+1);
 assert.deepEqual(record.published,approved.published);assert.equal(record.published.comment,'原确认意见');assert.equal(record.published.amendmentReason,undefined);
 const history=await f.call(f.manager,{action:'ops.history',id:record.id});
 assert.equal(history.versions[0].action,'ops.amend');assert.equal(history.versions[0].operating.amendmentReason,'核对原始小票，补录漏记的核销金额。');
 const backup=f.fixture.read('shixu_company_backups_v1',operatingVersionKey(record.id,record.version));
 assert.equal(digest(backup.payload),backup.checksum);assert.equal(JSON.parse(backup.payload).operating.amendmentReason,'核对原始小票，补录漏记的核销金额。');
 const leader=await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11',scope:'summary'});
 assert.equal(leader.pendingChanges,1);assert.equal(leader.records[0].version,approved.version);assert.equal(leader.records[0].amendmentReason,undefined);
});

test('reason survives save, submit, return, resubmit and approval independently of reviewer comments',async()=>{
 const f=await setup(),reason='更正合成门店漏录的当日收入';let r=(await f.amend(f.record,reason)).record;
 r=(await f.save(r,{reason:'不允许在保存时替换',amendmentReason:'伪造替换'})).record;assert.equal(r.amendmentReason,reason);
 r=(await f.call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;assert.equal(r.amendmentReason,reason);assert.equal(r.comment,'');
 r=(await f.call(f.owner,{action:'ops.return',id:r.id,version:r.version,comment:'请补齐原始凭证'})).record;assert.equal(r.amendmentReason,reason);assert.equal(r.comment,'请补齐原始凭证');
 r=(await f.save(r)).record;assert.equal(r.amendmentReason,reason);
 r=(await f.call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;
 r=(await f.call(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:'凭证与更正金额核对一致'})).record;
 assert.equal(r.amendmentReason,reason);assert.equal(r.comment,'凭证与更正金额核对一致');assert.equal(r.published.amendmentReason,reason);assert.equal(r.published.comment,'凭证与更正金额核对一致');
 assert.ok(operatingRecordSchema.safeParse(r).success);
});

test('a later amendment records its new reason without changing previous reasons in snapshots or history',async()=>{
 const f=await setup();let r=(await f.amend(f.record,'第一次更正：补记漏录')).record;
 r=(await f.call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;
 r=(await f.call(f.owner,{action:'ops.approve',id:r.id,version:r.version})).record;
 const previousVersion=r.version;
 r=(await f.amend(r,'第二次更正：撤销重复录入')).record;
 assert.equal(r.amendmentReason,'第二次更正：撤销重复录入');assert.equal(r.published.amendmentReason,'第一次更正：补记漏录');assert.equal(r.published.version,previousVersion);
 const history=await f.call(f.manager,{action:'ops.history',id:r.id});
 assert.deepEqual(history.versions.filter((v:any)=>v.action==='ops.amend').map((v:any)=>v.operating.amendmentReason),['第二次更正：撤销重复录入','第一次更正：补记漏录']);
});

test('strict record and archive schemas accept optional valid reasons while older history stays valid',async()=>{
 const f=await setup(),legacy={...f.record,status:'draft' as const,version:f.record.version+1};
 assert.ok(operatingRecordSchema.safeParse(legacy).success,'legacy amendment without recorded reason remains valid');
 assert.ok(operatingRecordSchema.safeParse({...legacy,amendmentReason:'历史补录核对'}).success);
 for(const amendmentReason of ['', '  ',123,'更'.repeat(1001)])assert.equal(operatingRecordSchema.safeParse({...legacy,amendmentReason}).success,false);
 let r=(await f.amend(f.record,'补录合成数据核对依据')).record;r=(await f.save(r)).record;
 const manifest=await f.data({action:'export.start'}),versions:any[]=[];
 for(let offset=0;offset<manifest.totalVersions;){const page=await f.data({action:'export.page',revision:manifest.revision,offset});assert.ok(page.offset>offset);versions.push(...page.versions);offset=page.offset;}
 const file={...manifest,versions},archive=parseCompanyArchive(file);
 assert.equal(archive.versions.filter(v=>'operating'in v).at(-1)?.operating.amendmentReason,'补录合成数据核对依据');
 assert.deepEqual(await verifyCompanyArchiveChecksums(file,async value=>digest(value)),{checksummed:true});
 let drill=await f.data({action:'backup.drill.start'});while(drill.drill.state==='running')drill=await f.data({action:'backup.drill.step',id:drill.drill.id,limit:5});assert.equal(drill.drill.state,'passed');
});

test('new valid reasons accept the 1000 character boundary without changing authorization or state checks',async()=>{
 const f=await setup();await assert.rejects(f.call(f.staff,{action:'ops.amend',id:f.record.id,version:f.record.version}),/权限/);
 const reason='更'.repeat(1000),r=(await f.amend(f.record,reason)).record;assert.equal(r.amendmentReason,reason);
 await assert.rejects(f.amend(r,'重复发起'),/已确认|状态/);
});
