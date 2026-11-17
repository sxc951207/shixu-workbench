import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {OperatingRecord,OperatingSheet} from '../cloud/company/operating-model.ts';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyKey} from '../cloud/company/core.ts';
import {executeOperating} from '../cloud/company/operating.ts';

const companyId='co_012345abcdef',projectId='p_'+'a'.repeat(24),otherId='p_'+'b'.repeat(24),now=new Date('2026-11-15T02:00:00Z');
const filter={companyId,date:'2026-11-13',now};
const project={id:projectId,name:'项目甲',enabled:true};
const config={projectId,stores:[{id:'s001',name:'门店甲'}]};
async function reader(){const mod=await import('../lib/workbench/company-day-overview.ts').catch(()=>null);assert.equal(typeof mod?.loadCompanyDayOverview,'function','company day overview reader is implemented');return mod!.loadCompanyDayOverview;}
function record(date='2026-11-13',sheet:OperatingSheet='revenue',pid=projectId):OperatingRecord{
 const stamp='2026-11-13T02:00:00.000Z',financial={orderedCoupons:0,orderAmount:0,verifiedCoupons:0,verifiedAmount:0,refundOrders:0,refundAmount:0,adSpend:0};
 const values:Record<string,number|null>=sheet==='targets'?{target:500000}:sheet==='revenue'?{revenue:0}:sheet==='meituan'||sheet==='meituan-stores'?{...financial,naturalExposure:null,paidExposure:null,consultations:null,leads:null,positiveReviews:null,stars:null}:financial;
 if(sheet==='meituan-stores'){delete values.naturalExposure;delete values.paidExposure;delete values.consultations;delete values.leads;}
 const base={id:'op_'+createHash('sha256').update(pid+sheet+date).digest('hex').slice(0,32),companyId,projectId:pid,projectName:pid===projectId?'项目甲':'项目乙',sheet,date,status:'approved' as const,version:3,publishedVersion:3,writerLogin:'owner',reviewerLogin:'manager',submittedBy:'owner',submittedName:'管理员',submittedAt:stamp,reviewerName:'主管',comment:'',createdAt:stamp,updatedAt:stamp,rows:[{storeId:sheet==='meituan'?'all':'s001',storeName:sheet==='meituan'?'全平台':'门店甲',values:values as Record<string,number|null>}]};
 return{...base,published:structuredClone(base)};
}
function page(records:OperatingRecord[],extra:Record<string,unknown>={}){return{project:{id:projectId,name:'项目甲'},config,records,pendingChanges:0,total:records.length,page:0,nextPage:null,companyRevision:8,...extra};}
type Body=Record<string,unknown>;
type Page=ReturnType<typeof page>;
function api(records:OperatingRecord[],mutate?:(body:Body,result:Page)=>unknown,projects=[project]){return async(body:Body)=>{if(body.action==='ops.options')return{projects,companyRevision:8};const result=page(records);return mutate?mutate(body,result):result;};}

test('day view keeps authorized projects and exact-date approved daily facts, preserving zero and unknown',async()=>{
 const load=await reader(),rows=[record(),record('2026-11-12'),record('2026-11-13','meituan'),record('2026-11-01','targets'),record('2026-11-13','meituan-stores')];
 const result=await load(api(rows,undefined,[project,{id:otherId,name:'未配置项目',enabled:false}]),filter);
 assert.deepEqual(result.projects.map(p=>[p.name,p.enabled,p.records.length]),[['项目甲',true,2],['未配置项目',false,0]]);
 assert.equal(result.projects[0].records[0].rows[0].values.revenue,0);
 assert.equal(result.projects[0].records[1].rows[0].values.stars,null);
 assert.equal(result.projects[0].excludedRecords,2);
 assert.equal(result.companyRevision,8);
});

test('legacy reader reads complete month pages and pins options revision across every project',async()=>{
 const load=await reader(),records=Array.from({length:21},(_,i)=>record('2026-11-'+String(i+1).padStart(2,'0'))),calls:Body[]=[];
 const request=async(body:Body)=>{calls.push(body);if(body.action==='ops.options')return{projects:[project,{id:otherId,name:'项目乙',enabled:true}],companyRevision:8};assert.equal(body.revision,8);assert.equal(body.scope,'summary');assert.equal(body.month,'2026-11');return body.projectId===otherId?page([record('2026-11-13','revenue',otherId)],{project:{id:otherId,name:'项目乙'},config:{...config,projectId:otherId}}):page(records.slice(Number(body.page)*20,Number(body.page)*20+20),{page:body.page,total:21,nextPage:body.page===0?1:null,pendingChanges:body.page===0?1:0});};
 const result=await load(request,filter);
 assert.equal(calls.filter(b=>b.action==='ops.month').length,3);
 assert.deepEqual(result.projects.map(p=>p.records.length),[1,1]);
 assert.equal(result.projects[0].pendingChanges,1);
});

test('invalid dates and Shanghai future dates stop before any request',async()=>{
 const load=await reader();let calls=0;const request=async()=>{calls++;throw Error('must not request');};
 for(const date of['2026-02-29','2026-11-31','2026-1-1','2026-11-16'])await assert.rejects(load(request,{...filter,date}));
 await assert.rejects(load(request,{...filter,companyId:'other-company'}));
 assert.equal(calls,0);
 const result=await load(api([]),{...filter,date:'2026-11-16',now:new Date('2026-11-15T16:00:00Z')});assert.equal(result.date,'2026-11-16');
});

test('concurrent identical loads share reads while project work is bounded to three',async()=>{
 const load=await reader(),projects=Array.from({length:7},(_,i)=>({id:'p_'+String(i).repeat(24),name:'项目'+i,enabled:true}));let options=0,active=0,maximum=0;
 const request=async(body:Body)=>{if(body.action==='ops.options'){options++;return{projects,companyRevision:8};}active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return page([],{project:{id:body.projectId,name:projects.find(p=>p.id===body.projectId)!.name},config:{...config,projectId:body.projectId}});};
 const [a,b]=await Promise.all([load(request,filter),load(request,filter)]);assert.equal(a,b);assert.equal(options,1);assert.equal(maximum,3);assert.equal(a.projects.length,7);
 await load(request,filter);assert.equal(options,2,'completed reads are not cached');
});

test('malformed or duplicate project options cannot silently hide projects',async()=>{
 const load=await reader();for(const options of[{projects:[project,project],companyRevision:8},{projects:[{...project,enabled:undefined}],companyRevision:8},{projects:[{...project,id:'unknown'}],companyRevision:8},{projects:[project],companyRevision:null}])await assert.rejects(load(async()=>options,filter));
});

test('identity, approval, date, schema, pagination and revision failures reject the whole overview',async()=>{
 const load=await reader();
 const mutations=[
  (p:Page)=>({...p,companyRevision:9}),
  (p:Page)=>({...p,project:{id:otherId,name:'其他项目'}}),
  (p:Page)=>({...p,page:1}),
  (p:Page)=>({...p,total:2}),
  (p:Page)=>({...p,nextPage:0}),
  (p:Page)=>({...p,pendingChanges:2}),
  (p:Page)=>({...p,config:{...config,projectId:otherId}}),
  (p:Page)=>({...p,records:[{...p.records[0],companyId:'co_000000000000'}]}),
  (p:Page)=>({...p,records:[{...p.records[0],projectId:otherId}]}),
  (p:Page)=>({...p,records:[{...p.records[0],sheet:'unknown'}]}),
  (p:Page)=>({...p,records:[{...p.records[0],date:'2026-10-13'}]}),
  (p:Page)=>({...p,records:[{...p.records[0],status:'draft'}]}),
  (p:Page)=>({...p,records:[{...p.records[0],published:null}]}),
  (p:Page)=>({...p,records:[{...p.records[0],rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:-1}}]}]}),
 ];
 for(const mutate of mutations)await assert.rejects(load(api([record()],(body,p)=>body.action==='ops.month'?mutate(p):p),filter));
 const same=record();await assert.rejects(load(api([same,same]),filter));
 const duplicate=structuredClone(same);duplicate.id='op_'+'c'.repeat(32);duplicate.published!.id=duplicate.id;await assert.rejects(load(api([same,duplicate]),filter));
});

test('later-page version and total changes reject a month instead of showing a partial day',async()=>{
 const load=await reader(),rows=Array.from({length:21},(_,i)=>record('2026-11-'+String(i+1).padStart(2,'0')));
 for(const changed of[{companyRevision:9},{total:22},{records:[rows[0]]}])await assert.rejects(load(async(body:Body)=>body.action==='ops.options'?{projects:[project],companyRevision:8}:page(rows.slice(Number(body.page)*20,Number(body.page)*20+20),{page:body.page,total:21,nextPage:body.page===0?1:null,...(body.page===1?changed:{})}),filter));
});

test('a failed project rejects the whole day; a new attempt can retry successfully',async()=>{
 const load=await reader();let fail=true;const request=async(body:Body)=>{if(body.action==='ops.options')return{projects:[project,{id:otherId,name:'项目乙',enabled:true}],companyRevision:8};if(body.projectId===otherId&&fail)throw Error('网络断开');return page([],{project:{id:body.projectId,name:body.projectId===projectId?'项目甲':'项目乙'},config:{...config,projectId:body.projectId}});};
 await assert.rejects(load(request,filter),/网络断开/);fail=false;assert.equal((await load(request,filter)).projects.length,2);
});

test('config missing is shown as unconfigured rather than an empty business day',async()=>{
 const load=await reader(),result=await load(api([],(body,p)=>body.action==='ops.month'?{...p,config:null}:p),filter);assert.equal(result.projects[0].enabled,false);
 await assert.rejects(load(api([record()],(body,p)=>body.action==='ops.month'?{...p,config:null}:p),filter));
});

test('real leader endpoint keeps the prior approved figure during an amendment',async()=>{
 const load=await reader(),f=await companyFixture(),call=(actor:Parameters<typeof executeOperating>[1],body:Body)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 await call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 let r=(await call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date:'2026-11-13',version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:12345}}]})).record;
 r=(await call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;r=(await call(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:''})).record;
 r=(await call(f.manager,{action:'ops.amend',id:r.id,version:r.version,reason:'核对当日成交金额'})).record;
 await call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date:'2026-11-13',version:r.version,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:99999}}]});
 const result=await load(body=>call(f.leader,body),{...filter,companyId:f.company.id});assert.equal(result.projects[0].records[0].rows[0].values.revenue,12345);assert.equal(result.projects[0].pendingChanges,1);assert.ok(!JSON.stringify(result).includes('99999'));
});

test('a newer company revision cannot reuse or accept an older in-flight overview',async()=>{
 const load=await reader();let release!:()=>void,options=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 const request=async(body:Body)=>{if(body.action==='ops.options'){options++;if(options===1)await gate;return{projects:[project],companyRevision:8};}return page([]);};
 const old=load(request,{...filter,minimumRevision:8});
 const fresh=load(request,{...filter,minimumRevision:9});release();
 await assert.rejects(fresh,/更新|变化/);assert.equal((await old).companyRevision,8);assert.equal(options,2);
});

test('real historical store renames do not invalidate the summary config projection or hide the selected day',async()=>{
 const load=await reader(),f=await companyFixture(),call=(actor:Parameters<typeof executeOperating>[1],body:Body)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 const configure=(stores:{id:string;name:string}[])=>call(f.manager,{action:'ops.configure',projectId:f.project.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores});
 const confirm=async(date:string,stores:{id:string;name:string}[])=>{let r=(await call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date,version:0,rows:stores.map(store=>({storeId:store.id,storeName:store.name,values:{revenue:10000}}))})).record;r=(await call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;return call(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:''});};
 const original=[{id:'s001',name:'甲'}],renamed=[{id:'s001',name:'乙'},{id:'s002',name:'甲'}];
 await configure(original);await confirm('2026-11-13',original);
 await configure(renamed);await confirm('2026-11-12',renamed);
 const month=await call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11',scope:'summary'});
 assert.deepEqual(month.config.stores,[{id:'s001',name:'甲'},{id:'s002',name:'甲'}],'the real read-only config merges historical names by store ID');
 const result=await load(body=>call(f.leader,body),{...filter,companyId:f.company.id});
 assert.equal(result.projects.length,1);assert.equal(result.projects[0].records.length,1);assert.deepEqual(result.projects[0].records[0].rows,[{storeId:'s001',storeName:'甲',values:{revenue:10000}}]);
 const prior=await load(body=>call(f.leader,body),{...filter,companyId:f.company.id,date:'2026-11-12'});assert.deepEqual(prior.projects[0].records[0].rows.map(row=>row.storeName),['乙','甲']);
});

test('ordinary leaders see every authorized published project including unconfigured ones, without exposing draft names or unpublished projects',async()=>{
 const load=await reader(),f=await companyFixture(),call=(actor:Parameters<typeof executeOperating>[1],body:Body)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 const create=async(name:string,publish=false)=>{let p=(await f.run(f.owner,{action:'project.create',companyId:f.company.id,name,ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;if(publish){p=(await f.run(f.staff,{action:'project.save',companyId:f.company.id,id:p.id,version:p.version,progress:0,achievement:'项目已确认',risk:'',next:'继续推进'})).project;p=(await f.run(f.staff,{action:'project.submit',companyId:f.company.id,id:p.id,version:p.version})).project;p=(await f.run(f.manager,{action:'project.approve',companyId:f.company.id,id:p.id,version:p.version,comment:''})).project;}return p;};
 const renamed=await create('项目乙',true);await create('项目丙',true);const configured=await create('项目丁',true);await create('没有确认的隐藏项目');
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:renamed.id,version:renamed.version,name:'未确认的新名称',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']});
 await call(f.manager,{action:'ops.configure',projectId:configured.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 const numericOnly=await create('仅经营确认');
 await call(f.manager,{action:'ops.configure',projectId:numericOnly.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 let record=(await call(f.manager,{action:'ops.save',projectId:numericOnly.id,sheet:'revenue',date:'2026-11-13',version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:100}}]})).record;
 record=(await call(f.manager,{action:'ops.submit',id:record.id,version:record.version})).record;await call(f.owner,{action:'ops.approve',id:record.id,version:record.version,comment:''});
 const board=await f.run(f.leader,{action:'view',companyId:f.company.id,scope:'summary'});assert.equal(board.projects.length,4);
 const options=await call(f.leader,{action:'ops.options',scope:'summary'});
 assert.deepEqual(new Map(options.projects.map((p:{name:string;enabled:boolean})=>[p.name,p.enabled])),new Map([['项目甲',false],['项目乙',false],['项目丙',false],['项目丁',true],['仅经营确认',true]]));
 const result=await load(body=>call(f.leader,body),{...filter,companyId:f.company.id});assert.equal(result.projects.length,5);assert.equal(result.projects.filter(p=>!p.enabled).length,3);assert.equal(result.projects.find(p=>p.id===numericOnly.id)!.records[0].rows[0].values.revenue,100);
 assert.equal((await call(f.other,{action:'ops.options',scope:'summary'})).projects.length,0);
 const unrelated=(await f.run(f.owner,{action:'company.create',name:'无关公司'})).company;await assert.rejects(call(f.leader,{action:'ops.options',companyId:unrelated.id,scope:'summary'}),/权限|成员/);
 await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'leader',name:'leader',roles:['leader'],active:false});await assert.rejects(call(f.leader,{action:'ops.options',scope:'summary'}),/停用|权限/);
});

test('project daily revenue totals preserve cents and distinguish missing, partial, zero and unsafe totals',async()=>{
 const mod=await import('../lib/workbench/company-day-overview.ts');assert.equal(typeof mod.companyDayRevenueSummary,'function','daily revenue summary is implemented');
 const summarize=mod.companyDayRevenueSummary;
 const fact=record();fact.rows=[{storeId:'s001',storeName:'甲',values:{revenue:12345}},{storeId:'s002',storeName:'乙',values:{revenue:0}}];
 assert.deepEqual(summarize([fact]),{amount:12345,complete:true,knownRows:2,totalRows:2,reason:''});
 fact.rows[0].values.revenue=null;assert.deepEqual(summarize([fact]),{amount:0,complete:false,knownRows:1,totalRows:2,reason:'1 行未提供金额'});
 fact.rows[1].values.revenue=null;assert.deepEqual(summarize([fact]),{amount:null,complete:false,knownRows:0,totalRows:2,reason:'2 行未提供金额'});
 fact.rows[0].values.revenue=Number.MAX_SAFE_INTEGER;fact.rows[1].values.revenue=1;assert.deepEqual(summarize([fact]),{amount:null,complete:false,knownRows:2,totalRows:2,reason:'金额合计超出安全范围，请查看门店明细'});
 assert.deepEqual(summarize([]),{amount:null,complete:false,knownRows:0,totalRows:0,reason:'当天无已确认总业绩'});
});

test('day reads fetch only the selected approved daily facts, including the old confirmation during a correction',async()=>{
 const f=await companyFixture(),{id:pid}=f.project,month='2026-10',day='2026-10-30',docReads:string[]=[];
 async function call(actor:Parameters<typeof executeOperating>[1],body:Body){
  return f.store.run(tx=>executeOperating({...tx,get:async(id,backup)=>{
   if(/^op_[0-9a-f]{32}$/.test(id)&&!backup)docReads.push(id);
   return tx.get(id,backup);
  }},actor,{companyId:f.company.id,projectId:pid,...body},COMPANY_NOW));
 }
 await call(f.manager,{action:'ops.configure',revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 let chosen!:OperatingRecord;
 for(let d=1;d<=31;d++){
  const date=month+'-'+String(d).padStart(2,'0');
  let r=(await call(f.manager,{action:'ops.save',sheet:'revenue',date,version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:d*100}}]})).record;
  r=(await call(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;
  r=(await call(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:''})).record;
  if(d===1||date===day){
   if(date===day)chosen=r;
   await call(f.manager,{action:'ops.amend',id:r.id,version:r.version,reason:'复核明细'});
  }
 }
 let cumulative=(await call(f.manager,{action:'ops.save',sheet:'targets',date:month+'-01',version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{target:100000}}]})).record;
 cumulative=(await call(f.manager,{action:'ops.submit',id:cumulative.id,version:cumulative.version})).record;
 await call(f.owner,{action:'ops.approve',id:cumulative.id,version:cumulative.version,comment:''});
 docReads.length=0;
 const input={action:'ops.month',scope:'summary',month,day};
 const page=await call(f.leader,input);
 assert.deepEqual(docReads,[chosen.id],'reads at month end should be proportional to facts on the chosen date');
 assert.equal(page.day,day);assert.equal(page.total,1);assert.equal(page.nextPage,null);assert.equal(page.pendingChanges,1);
 assert.equal(page.records[0].version,chosen.version);
 assert.equal(page.records[0].rows[0].values.revenue,3000);
 const monthOnly=await call(f.leader,{action:'ops.month',scope:'summary',month});
 assert.equal(monthOnly.total,32);assert.equal(monthOnly.records.length,20);assert.equal(monthOnly.nextPage,1);assert.equal(monthOnly.day,undefined);
 const start=await call(f.leader,{...input,day:month+'-01'});
 assert.equal(start.total,1,'monthly targets and cumulative snapshots are not daily facts');
 assert.equal(start.records[0].sheet,'revenue');
 await assert.rejects(call(f.leader,{...input,revision:page.companyRevision-1}),/变化/);
 await assert.rejects(call(f.other,input),/权限/);
 for(const patch of [{day:'2026-11-01'},{day:'2026-10-32'},{day:null},{scope:'working'},{scope:undefined},{month:'2026-12',day:'2026-12-01'}])
  await assert.rejects(call(f.manager,{...input,...patch}));
 const load=await reader();docReads.length=0;
 const result=await load(body=>call(f.leader,body),{companyId:f.company.id,date:day,now:COMPANY_NOW});
 assert.deepEqual(docReads,[chosen.id]);assert.equal(result.projects[0].pendingPeriod,'day');assert.equal(result.projects[0].pendingChanges,1);
});

test('daily reader validates echoed date, every fact date, and consistency of old/new page scope',async()=>{
 const load=await reader();
 const dateEcho=async(body:Body)=>{
  if(body.action==='ops.options')return{projects:[project],companyRevision:8};
  assert.equal(body.day,filter.date);return page([record()],{day:filter.date,pendingChanges:1});
 };
 const good=await load(dateEcho,filter);assert.equal(good.projects[0].pendingChanges,1);assert.equal(good.projects[0].pendingPeriod,'day');
 for(const corrupt of [page([record()],{day:'2026-11-12'}),page([record('2026-11-12')],{day:filter.date}),page([record(filter.date,'meituan-stores')],{day:filter.date})])
  await assert.rejects(load(async(body:Body)=>body.action==='ops.options'?{projects:[project],companyRevision:8}:corrupt,filter));
 const legacy=await load(api([record('2026-11-12'),record()],(b,p)=>({...p,pendingChanges:1})),filter);
 assert.equal(legacy.projects[0].pendingPeriod,'month');assert.equal(legacy.projects[0].pendingChanges,1);assert.equal(legacy.projects[0].records.length,1);
});

test('all 21 daily sheets across two pages stay pinned and mixed daily/monthly pagination is rejected',async()=>{
 const load=await reader();
 const rows=Array.from({length:21},(_,i)=>{
  const sheet='tpl_day_'+i as OperatingSheet,base=record(filter.date,sheet);
  const {published,...snapshot}=base;
  snapshot.template={id:sheet,name:'合成表'+i,description:'',dimension:'total',writer:'project-owner',active:true,fields:[{key:'count',label:'数量',kind:'count',required:true}],metrics:[]};
  snapshot.rows=[{storeId:'all',storeName:'全项目',values:{count:i}}];
  return {...snapshot,published:structuredClone(snapshot)};
 });
 const fetch=(mix:boolean)=>async(body:Body)=>{
  if(body.action==='ops.options')return{projects:[project],companyRevision:8};
  assert.equal(body.day,filter.date);assert.equal(body.revision,8);
  const second=body.page===1;
  return page(second?rows.slice(20):rows.slice(0,20),{...(!mix||!second?{day:filter.date}:{}),page:body.page,nextPage:second?null:1,total:rows.length,pendingChanges:second?1:2});
 };
 const data=await load(fetch(false),filter);assert.equal(data.projects[0].records.length,21);assert.equal(data.projects[0].pendingChanges,3);
 await assert.rejects(load(fetch(true),filter),/范围不一致/);
});

test('historical records keep their original name while the daily header follows the authorized latest confirmed project name',async()=>{
 const f=await companyFixture();
 const run=(actor:Parameters<typeof executeOperating>[1],body:Body)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,...body},COMPANY_NOW));
 let p=(await f.run(f.owner,{action:'project.create',companyId:f.company.id,name:'历史项目名称',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;
 await run(f.manager,{action:'ops.configure',projectId:p.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 async function approveRevenue(date:string){
  let r=(await run(f.manager,{action:'ops.save',projectId:p.id,sheet:'revenue',date,version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:100}}]})).record;
  r=(await run(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;
  await run(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:''});
 }
 await approveRevenue('2026-11-11');
 p=(await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:p.id,version:p.version,name:'新项目名称',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;
 await approveRevenue('2026-11-12');
 const load=await reader();
 const selection=await load(body=>run(f.leader,body),{companyId:f.company.id,date:'2026-11-11',now:COMPANY_NOW});
 const item=selection.projects.find(x=>x.id===p.id)!;
 assert.equal(item.name,'新项目名称');
 assert.equal(item.records[0].projectName,'历史项目名称');
});

test('meeting shortcuts use Shanghai calendar weeks and months, including unelapsed current periods',async()=>{
 const mod=await import('../lib/workbench/company-day-overview.ts');
 assert.equal(typeof mod.meetingPeriod,'function','meeting date shortcuts exist');
 const {meetingPeriod}=mod;
 assert.deepEqual(meetingPeriod('lastWeek','2026-11-03'),{start:'2026-10-26',end:'2026-11-01'});
 assert.deepEqual(meetingPeriod('lastMonth','2024-03-01'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(meetingPeriod('thisWeek','2026-11-17'),{start:'2026-11-16',end:'2026-11-16'});
 assert.equal(meetingPeriod('thisWeek','2026-11-16'),null);
 assert.equal(meetingPeriod('thisMonth','2026-11-01'),null);
 assert.deepEqual(meetingPeriod('lastWeekDay','2026-11-17'),{start:'2026-11-10',end:'2026-11-10'});
});

test('meeting range reads two bounded monthly slices at one revision, dropping out-of-period or cumulative legacy records',async()=>{
 const load=await reader(),requests:Body[]=[];
 const request=async(body:Body)=>{
  requests.push(body);
  if(body.action==='ops.options')return {projects:[project],companyRevision:8};
  if(body.month==='2026-10')return page([record('2026-10-01'),record('2026-10-31'),record('2026-10-31','meituan-stores')]);
  return page([record('2026-11-01'),record('2026-11-01','meituan')],{start:'2026-11-01',end:'2026-11-01'});
 };
 const data=await load(request,{...filter,start:'2026-10-26',date:'2026-11-01'});
 assert.deepEqual(data.projects[0].records.map(r=>[r.date,r.sheet]),[['2026-10-31','revenue'],['2026-11-01','revenue'],['2026-11-01','meituan']]);
 assert.deepEqual(requests.slice(1).map(b=>[b.month,b.start,b.end,b.revision]),[['2026-10','2026-10-26','2026-10-31',8],['2026-11','2026-11-01','2026-11-01',8]]);
 await assert.rejects(load(api([record()],(b,p)=>({...p,start:'2026-11-02',end:'2026-11-03'})),{...filter,start:'2026-11-01'}));
});

test('confirmed range endpoint projects requested daily facts only, with a bounded and validated interval',async()=>{
 const f=await companyFixture(),op=(actor:any,body:Body)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,projectId:f.project.id,...body},COMPANY_NOW));
 await op(f.manager,{action:'ops.configure',revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores:config.stores});
 for(const date of ['2026-11-10','2026-11-11']){
  let r=(await op(f.manager,{action:'ops.save',sheet:'revenue',date,version:0,rows:[{storeId:'s001',storeName:'门店甲',values:{revenue:100}}]})).record;
  r=(await op(f.manager,{action:'ops.submit',id:r.id,version:r.version})).record;await op(f.owner,{action:'ops.approve',id:r.id,version:r.version,comment:''});
 }
 const query={action:'ops.month',scope:'summary',month:'2026-11',start:'2026-11-11',end:'2026-11-13'};
 const page=await op(f.leader,query);assert.deepEqual(page.records.map((r:OperatingRecord)=>r.date),['2026-11-11']);assert.equal(page.start,query.start);assert.equal(page.end,query.end);
 for(const overrides of [{end:undefined},{end:'2026-11-10'},{end:'2026-11-14'},{start:'2026-10-30'},{day:'2026-11-11'},{scope:'working'}])await assert.rejects(op(f.leader,{...query,...overrides}));
});

test('meeting period revenue counts known rows and distinct revenue days without adding other sheets or filling gaps',async()=>{
 const mod=await import('../lib/workbench/company-day-overview.ts');assert.equal(typeof mod.companyPeriodRevenueSummary,'function');
 const first=record('2026-11-01'),partial=record('2026-11-03');
 partial.rows=[{storeId:'s001',storeName:'甲',values:{revenue:25400}},{storeId:'s002',storeName:'乙',values:{revenue:null}}];
 const rows=[first,partial,record('2026-11-02','meituan')], period={start:'2026-11-01',end:'2026-11-03'};
 assert.deepEqual(mod.companyPeriodRevenueSummary(rows,period),{amount:25400,complete:false,reportedDays:2,expectedDays:3,unknownRows:1,overflow:false,scopeChanged:true,sourceIssue:''});
 assert.equal(mod.companyPeriodRevenueSummary([first],{start:first.date,end:first.date}).complete,true);
 assert.equal(mod.companyPeriodRevenueSummary([],period).amount,null);
 first.rows[0].values.revenue=Number.MAX_SAFE_INTEGER;assert.equal(mod.companyPeriodRevenueSummary(rows,period).overflow,true);
});

test('leader day and period totals follow the same store revenue source as monthly targets',async()=>{
 const {companyDayRevenueSummary,companyPeriodRevenueSummary}=await import('../lib/workbench/company-day-overview.ts');
 const {operatingTargetProgress}=await import('../lib/workbench/operating-data.ts');
 const date='2026-11-01',range={start:date,end:date},builtin=record(date),targets=record(date,'targets');
 const custom=record(date,'tpl_total');
 custom.template={id:custom.sheet,name:'门店日报',description:'当日发生额',dimension:'store',writer:'project-owner',active:true,fields:[{key:'revenue',label:'门店总业绩',kind:'money',required:true}],metrics:[]};
 custom.rows[0].values={revenue:12345};
 for(const [facts,expected] of [[[custom],12345],[[custom,builtin],0]] as const){
  assert.equal(companyDayRevenueSummary([...facts]).amount,expected);
  assert.equal(companyPeriodRevenueSummary([...facts],range).amount,expected);
  assert.equal(operatingTargetProgress(targets,[...facts],date,true).total.revenue,expected);
 }
 const other:OperatingRecord={...custom,sheet:'tpl_second',template:{...custom.template,id:'tpl_second'}};
 const ambiguous=[custom,other];
 const day=companyDayRevenueSummary(ambiguous),period=companyPeriodRevenueSummary(ambiguous,range);
 assert.equal(day.amount,null);assert.match(day.reason,/核对.*来源/);
 assert.equal(period.amount,null);assert.match(period.sourceIssue,/核对.*来源/);
});

test('a change of store IDs marks a fully reported period subtotal without guessing missed rows',async()=>{
 const {companyPeriodRevenueSummary}=await import('../lib/workbench/company-day-overview.ts');
 const first=record('2026-11-01'),second=record('2026-11-02'),range={start:first.date,end:second.date};
 first.rows=[{storeId:'s001',storeName:'甲',values:{revenue:10000}},{storeId:'s002',storeName:'乙',values:{revenue:10000}}];
 second.rows=[{...first.rows[0]}];
 const changed=companyPeriodRevenueSummary([first,second],range);
 assert.equal(changed.complete,false);
 assert.equal(changed.scopeChanged,true);
 assert.deepEqual([changed.amount,changed.reportedDays,changed.expectedDays,changed.unknownRows],[30000,2,2,0]);
 second.rows.unshift({...first.rows[1],storeName:'乙新名',values:{revenue:0}});
 assert.equal(companyPeriodRevenueSummary([first,second],range).complete,true);
});
