import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture,COMPANY_NOW} from './fixtures/company.ts';
import {companyKey} from '../cloud/company/core.ts';
const stores=[{id:'s001',name:'样例1号店'},{id:'s002',name:'样例2号店'}];
const finance={orderedCoupons:10,orderAmount:10000,verifiedCoupons:12,verifiedAmount:11000,refundOrders:2,refundAmount:1200,adSpend:1000};
const platformRows=(sheet='meituan'):any[]=>[{storeId:'all',storeName:'全平台',values:{...finance,...(sheet==='meituan'?{naturalExposure:null,paidExposure:null,consultations:null,leads:null}:{shopVisits:null,shopVisitors:null,privateContacts:null,privateOpens:null,privateLeads:null})}}];
const revenueRows=():any[]=>stores.map((s,i)=>({storeId:s.id,storeName:s.name,values:{revenue:i?0:12345}}));
test('assigned reporter can establish a reusable own template and submit its amount to supervisor without changing hidden administrator configuration',async()=>{
 const f=await setup(),revision=()=>f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;
 const own={id:'tpl_staff',name:'本人客资汇报',description:'按成交发生日',dimension:'total',writer:'project-owner',active:true,fields:[{key:'deals',label:'成交数',kind:'count',required:true},{key:'revenue',label:'客资成交金额',kind:'money',required:true}],metrics:[]};
 const configured=await f.call(f.staff,{action:'ops.configureOwn',projectId:f.project.id,revision:revision(),stores,templates:[own],dimensionLabel:'门店'});
 assert.equal(configured.proposal.config.templates[0].writer,'project-owner');
 assert.equal(configured.config.templates.length,0);
 await assert.rejects(save(f,f.staff,'tpl_staff',[]),/不存在/);
 await f.call(f.manager,{action:'ops.reviewIndicators',projectId:f.project.id,revision:revision(),proposalId:configured.proposal.id,approve:true});
 const all=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).operatingConfigs[0];assert.equal(all.builtinSheets,undefined);
 let r=await save(f,f.staff,'tpl_staff',[{storeId:'all',storeName:'全项目',values:{deals:2,revenue:123456}}]);r=await submit(f,f.staff,r);
 assert.equal((await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11'})).records.length,0);
 r=await approve(f,f.manager,r);assert.equal(r.published.rows[0].values.revenue,123456);
 for(const actor of[f.other,f.leader])await assert.rejects(f.call(actor,{action:'ops.configureOwn',projectId:f.project.id,revision:revision(),stores,templates:[own]}),/权限|负责/);
 await assert.rejects(f.call(f.staff,{action:'ops.configureOwn',projectId:f.project.id,revision:revision(),stores,templates:[{...own,writer:'owner'}]}),/填写人|权限|负责/);
 await assert.rejects(f.call(f.staff,{action:'ops.configureOwn',projectId:f.project.id,revision:revision(),stores,builtinSheets:[],templates:[own]}),/套表|权限/);
});
async function setup(){const mod=await import('../cloud/company/operating.ts').catch(()=>null);assert.equal(typeof mod?.executeOperating,'function','operating API is implemented');const f=await companyFixture(),call=(a:any,b:any)=>f.store.run(t=>mod!.executeOperating(t,a,{companyId:f.company.id,...b},COMPANY_NOW));const config=await call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,stores});return{...f,call,config,mod:mod!};}
async function save(f:any,actor:any,sheet='meituan',rows=platformRows(sheet),date='2026-11-12'){return(await f.call(actor,{action:'ops.save',projectId:f.project.id,sheet,date,version:0,rows})).record;}
async function submit(f:any,actor:any,r:any){return(await f.call(actor,{action:'ops.submit',id:r.id,version:r.version})).record;}
async function approve(f:any,actor:any,r:any){return(await f.call(actor,{action:'ops.approve',id:r.id,version:r.version,comment:''})).record;}
test('employee home follows assigned sheets for yesterday and drops finished or reassigned records',async()=>{
 const f=await setup();
 const next=(actor=f.staff)=>f.call(actor,{action:'ops.nextFill'});
 const empty=await next(f.other);
 assert.equal(empty.day,'2026-11-12');
 assert.equal(empty.item,null);
 const first=await next();
 assert.equal(first.item.projectId,f.project.id);
 assert.equal(first.item.status,'missing');
 assert.ok(['meituan','douyin'].includes(first.item.sheet));
 let draft=await save(f,f.staff,'meituan');
 assert.equal((await next()).item.sheet,'meituan');
 assert.equal((await next()).item.status,'draft');
 draft=await submit(f,f.staff,draft);
 assert.equal((await next()).item.sheet,'douyin');
 draft=(await f.call(f.manager,{action:'ops.return',id:draft.id,version:draft.version,comment:'请核对'})).record;
 assert.equal((await next()).item.status,'returned');
 const project=(await f.run(f.owner,{action:'view',companyId:f.company.id,scope:'manage'})).projects[0];
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:project.id,version:project.version,name:project.name,ownerLogin:'other',reviewerLogin:'manager',participants:['other']});
 assert.equal((await next()).item,null);
 assert.equal((await next(f.other)).item.sheet,'meituan');
});
test('home surfaces earlier returned sheets and drafts across the month boundary without inventing past missing days',async()=>{
 const f=await setup();
 const home=(clock=COMPANY_NOW)=>f.store.run(t=>f.mod.executeOperating(t,f.staff,{action:'ops.nextFill',companyId:f.company.id},clock));
 await save(f,f.staff,'douyin',platformRows('douyin'),'2026-11-09');
 const old=await submit(f,f.staff,await save(f,f.staff,'meituan',platformRows(),'2026-10-31'));
 await f.call(f.manager,{action:'ops.return',id:old.id,version:old.version,comment:'补上门店数'});
 const first=await home();
 assert.deepEqual([first.since,first.day,first.item.date,first.item.status],['2026-10-01','2026-11-12','2026-10-31','returned']);
 const oldMonth=await home(new Date('2026-12-01T18:00:00Z'));
 assert.deepEqual([oldMonth.since,oldMonth.day,oldMonth.item.date,oldMonth.item.status],['2026-11-01','2026-12-01','2026-11-09','draft']);
 const afterWindow=await home(new Date('2027-01-12T03:00:00Z'));
 assert.deepEqual([afterWindow.item.date,afterWindow.item.status],['2027-01-11','missing']);
});
test('home honors the template writer, project ownership and retirement when choosing an employee form',async()=>{
 const f=await setup();
 const template={id:'tpl_home',name:'员工客资表',description:'',dimension:'total',writer:'project-owner',active:true,fields:[{key:'deals',label:'成交数',kind:'count',required:true}],metrics:[]};
 const configure=(revision:number,active:boolean)=>f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision,stores,builtinSheets:['revenue'],templates:[{...template,active},{...template,id:'tpl_mgr',writer:'supervisor'}]});
 const next=(actor=f.staff)=>f.call(actor,{action:'ops.nextFill'});
 let config=await configure(f.config.companyRevision,true);
 assert.equal((await next()).item.name,'员工客资表');
 config=await configure(config.companyRevision,false);
 assert.equal((await next()).item,null);
 config=await configure(config.companyRevision,true);
 const draft=await save(f,f.staff,'tpl_home',[{storeId:'all',storeName:'全项目',values:{deals:0}}]);
 const month=await f.call(f.staff,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 await configure(month.companyRevision,false);
 assert.equal((await next()).item.status,'draft');
 assert.equal((await next()).item.date,draft.date);
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version:f.project.version,name:f.project.name,ownerLogin:'other',reviewerLogin:'manager',participants:['other','staff']});
 assert.equal((await next()).item,null);
 assert.equal((await next(f.other)).item.sheet,'tpl_home');
});
test('revenue drafts require a store amount on save, including equivalent imported templates',async()=>{
 const f=await setup();
 const template={id:'tpl_store_revenue',name:'每日门店业绩',description:'门店日表',dimension:'store',writer:'supervisor',active:true,fields:[{key:'revenue',label:'门店总业绩',kind:'money',required:true}],metrics:[]};
 await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.config.companyRevision,stores,templates:[template]});
 const month=()=>f.call(f.manager,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 const blank=revenueRows().map(row=>({...row,values:{revenue:null}}));
 for(const sheet of ['revenue',template.id]){
  const before=await month();
  await assert.rejects(save(f,f.manager,sheet,blank),/至少.*门店.*金额/);
  assert.equal((await month()).companyRevision,before.companyRevision);
  const partial=await save(f,f.manager,sheet,[blank[0],{...blank[1],values:{revenue:0}}]);
  assert.deepEqual(partial.rows.map((r:any)=>r.values.revenue),[null,0]);
  const edit={action:'ops.save',projectId:f.project.id,sheet,date:partial.date,version:partial.version,rows:blank,importCorrection:true};
  await assert.rejects(f.call(f.manager,edit),/至少.*门店.*金额/);
  const current=(await month()).records.find((r:any)=>r.id===partial.id);
  assert.equal(current.version,1);
  assert.deepEqual(current.rows.map((r:any)=>r.values.revenue),[null,0]);
  // Older clients could save a completely empty V1. It stays readable and can be repaired.
  f.fixture.corrupt('shixu_company_v1',partial.id,{...partial,rows:blank});
  assert.deepEqual((await month()).records.find((r:any)=>r.id===partial.id).rows,blank);
  const fixed=(await f.call(f.manager,{...edit,rows:revenueRows()})).record;
  assert.equal(fixed.version,2);
  assert.deepEqual(fixed.rows.map((r:any)=>r.values.revenue),[12345,0]);
 }
});
test('one source can save first-day revenue and monthly targets independently and reimport only confirmed differences',async()=>{
 const f=await setup(),date='2026-11-01';
 const {saveOperatingImportBatch}=await import('../lib/workbench/operating-reimport.ts');
 const daily={sheet:'revenue' as const,date,columns:['revenue'],rows:revenueRows()};
 const targets={sheet:'targets' as const,date,columns:['target'],rows:stores.map((s,i)=>({storeId:s.id,storeName:s.name,values:{target:i?20000:10000}}))};
 const month=()=>f.call(f.manager,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 const batch=(items:any[],previous:any[]=[],reason='')=>saveOperatingImportBatch(items,{
  readMonth:month,login:'manager',previous,reason,save:async(body:any)=>(await f.call(f.manager,{action:'ops.save',projectId:f.project.id,...body})).record
 });
 assert.deepEqual((await batch([daily,targets])).map(r=>r.status),['已保存草稿','已保存草稿']);
 let records=(await month()).records;
 assert.deepEqual(records.map((r:any)=>[r.sheet,r.version]),[['revenue',1],['targets',1]]);
 assert.deepEqual((await batch([daily,targets])).map(r=>r.status),['与原表一致','与原表一致']);
 const prior=await approve(f,f.owner,await submit(f,f.manager,records[1]));
 const changed={...targets,rows:[{...targets.rows[0],values:{target:0}},{...targets.rows[1],values:{target:null}}]};
 const unrelated=[{sheet:'revenue',date,version:prior.version,status:'待核对差异'}];
 const preview=await batch([daily,changed],unrelated,'核对原表');
 assert.equal(preview[1].sheet,'targets');
 assert.equal(preview[1].approved,true);
 assert.equal(preview[1].changes?.length,1);
 assert.equal((await month()).records[1].status,'approved');
 assert.equal((await batch([daily,changed],preview,'核对原表'))[1].status,'已按新表更新草稿');
 records=(await month()).records;
 assert.equal(records[0].version,1);
 assert.equal(records[1].status,'draft');
 assert.deepEqual(records[1].rows.map((r:any)=>r.values.target),[0,20000]);
 assert.deepEqual(records[1].published.rows.map((r:any)=>r.values.target),[10000,20000]);
});
test('three-day backfill retains the number created when a second pass confirms a changed day',async()=>{
 const f=await setup();
 const {saveOperatingImportBatch}=await import('../lib/workbench/operating-reimport.ts');
 const days=['2026-11-01','2026-11-02','2026-11-03'];
 const entries=days.map(date=>({sheet:'meituan' as const,date,columns:['verifiedAmount'],rows:platformRows()}));
 const readMonth=()=>f.call(f.staff,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 const save=async(body:object)=>(await f.call(f.staff,{action:'ops.save',projectId:f.project.id,...body})).record;
 await save({...entries[1],version:0,rows:entries[1].rows.map(row=>({...row,values:{...row.values,verifiedAmount:1}}))});
 await save({...entries[2],version:0});
 const first=await saveOperatingImportBatch(entries,{readMonth,save,login:'staff',previous:[],reason:''});
 assert.equal(first[0].status,'已保存草稿');
 assert.ok(first[1].changes?.length);
 assert.equal(first[2].status,'与原表一致');
 const final=await saveOperatingImportBatch(entries,{readMonth,save,login:'staff',previous:first,reason:''});
 assert.deepEqual(final.map(r=>r.status),['已保存草稿','已按新表更新草稿','与原表一致']);
 assert.deepEqual((await readMonth()).records.map((r:any)=>[r.date,r.version,r.rows[0].values.verifiedAmount]),[[days[0],1,11000],[days[1],2,11000],[days[2],1,11000]]);
});
test('import receipt distinguishes the current approval from an older visible snapshot across months and retries',async()=>{
 const f=await setup();
 const {saveOperatingImportBatch,importReceiptStage}=await import('../lib/workbench/operating-reimport.ts');
 const entries=['2026-10-31','2026-11-01','2026-11-02','2026-11-03'].map(date=>({sheet:'meituan' as const,date,columns:['verifiedAmount'],rows:platformRows()}));
 for(const entry of entries.slice(0,3)){
  const draft=await save(f,f.staff,entry.sheet,entry.rows,entry.date);
  const submitted=await submit(f,f.staff,draft);
  if(entry.date!=='2026-11-02')await approve(f,f.manager,submitted);
 }
 entries[1].rows[0].values.verifiedAmount=999;
 const actions={readMonth:(month:string)=>f.call(f.staff,{action:'ops.month',projectId:f.project.id,month}),save:async(body:object)=>(await f.call(f.staff,{action:'ops.save',projectId:f.project.id,...body})).record,login:'staff',reason:'对照原表修正'};
 const first=await saveOperatingImportBatch(entries,{...actions,previous:[]});
 assert.deepEqual(first.map(importReceiptStage),['approved','unresolved','submitted','draft']);
 const final=await saveOperatingImportBatch(entries,{...actions,previous:first});
 assert.deepEqual(final.map(importReceiptStage),['approved','draft','submitted','draft']);
 assert.deepEqual(final.map(r=>[r.record?.version,r.record?.publishedVersion]),[[3,3],[4,3],[2,0],[1,0]]);
 const broken=await saveOperatingImportBatch(entries,{...actions,previous:[],readMonth:async()=>{throw Error('中断');}});
 assert.deepEqual(broken.map(r=>r.outcome),['errors','pending','pending','pending']);
 assert.ok(broken.every(r=>importReceiptStage(r)==='unresolved'&&!r.record));
});
test('a committed write with a lost reply is reconciled on retry, without attributing a new or unchanged write',async()=>{
 const f=await setup();
 const {saveOperatingImportBatch,operatingImportCounts}=await import('../lib/workbench/operating-reimport.ts');
 let writes=0;
 const entry={sheet:'meituan' as const,date:'2026-11-07',columns:['verifiedAmount'],rows:platformRows()};
 const actions={readMonth:(month:string)=>f.call(f.staff,{action:'ops.month',projectId:f.project.id,month}),save:async(body:object)=>{
  writes++;await f.call(f.staff,{action:'ops.save',projectId:f.project.id,...body});throw Error('连接已断开');
 },login:'staff',reason:''};
 const first=await saveOperatingImportBatch([entry],{...actions,previous:[]});
 assert.equal(first[0].outcome,'errors');
 const retry=await saveOperatingImportBatch([entry],{...actions,previous:first});
 assert.equal(writes,1);assert.equal(retry[0].record?.version,1);
 assert.equal(retry[0].outcome,'reconciled');assert.match(retry[0].status,/前次保存结果未收到/);
 const counts=operatingImportCounts(retry);
 assert.equal(counts.created,0);assert.equal(counts.unchanged,0);assert.equal(counts.reconciled,1);
});
test('a supervisor can view platform drafts but receipt submission requires current writer rights and complete values',async()=>{
 const f=await setup();
 const {refreshReceipt}=await import('../lib/workbench/operating-receipt-locator.ts');
 const revenue=await save(f,f.manager,'revenue',revenueRows());
 const platform=await save(f,f.staff,'meituan',platformRows());
 const partial=await save(f,f.manager,'revenue',[revenueRows()[0],{...revenueRows()[1],values:{revenue:null}}],'2026-11-11');
 const entries=[revenue,platform,partial].map(record=>({sheet:record.sheet,date:record.date,recordVersion:record.version,outcome:'unchanged' as const}));
 const receipts=await refreshReceipt(entries,month=>f.call(f.manager,{action:'ops.month',projectId:f.project.id,month}),false);
 assert.deepEqual(receipts.map(r=>r.record?.id),[revenue.id,platform.id,partial.id]);
 assert.deepEqual(receipts.map(r=>r.submitIssue),[undefined,'当前账号仅可查看','请先补齐必填项']);
 const changed=await f.call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:revenue.sheet,date:revenue.date,version:revenue.version,rows:revenueRows().map(row=>({...row,values:{revenue:500}}))});
 const refreshed=await refreshReceipt(entries,month=>f.call(f.manager,{action:'ops.month',projectId:f.project.id,month}),false);
 assert.equal(refreshed[0].record?.version,changed.record.version);
 assert.match(refreshed[0].submitIssue||'',/导入时 V1.*重新核对/);

});
test('mixed imports keep daily revenue when targets are retired and never write a target for an unauthorized reporter',async()=>{
 const f=await setup(),date='2026-11-01';
 const {saveOperatingImportBatch}=await import('../lib/workbench/operating-reimport.ts');
 const target={sheet:'targets' as const,date,columns:['target'],rows:stores.map(s=>({storeId:s.id,storeName:s.name,values:{target:10000}}))};
 const daily={sheet:'revenue' as const,date,columns:['revenue'],rows:revenueRows()};
 const batch=(actor:typeof f.manager,entries:(typeof target|typeof daily)[])=>saveOperatingImportBatch(entries,{
  login:actor.login,previous:[],reason:'',
  readMonth:month=>f.call(actor,{action:'ops.month',projectId:f.project.id,month}),
  save:async(body)=>(await f.call(actor,{action:'ops.save',projectId:f.project.id,...body})).record
 });
 assert.match((await batch(f.staff,[target]))[0].status,/无权/);
 await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.config.companyRevision,stores,builtinSheets:['revenue']});
 const result=await batch(f.manager,[daily,target]);
 assert.deepEqual(result.map(r=>r.status),['已保存草稿','项目尚未启用门店月目标']);
 const month=await f.call(f.manager,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 assert.deepEqual(month.records.map((r:any)=>r.sheet),['revenue']);
});
test('reimport protects an in-flight submission and keeps the previous approval visible until reconfirmed',async()=>{
 const f=await setup(),pending=await submit(f,f.staff,await save(f,f.staff));
 const rows=platformRows();rows[0].values.verifiedAmount=10999;
 const replace=(actor:any,version:number,reason?:string)=>f.call(actor,{action:'ops.save',importCorrection:true,projectId:f.project.id,sheet:pending.sheet,date:pending.date,rows,version,reason});
 await assert.rejects(replace(f.owner,pending.version),/原提交人/);
 const approved=await approve(f,f.manager,pending);
 await assert.rejects(replace(f.staff,pending.version,'原表核对'),/版本/);
 await assert.rejects(replace(f.staff,approved.version),/必填|输入|内容|不能为空/);
 const draft=(await replace(f.staff,approved.version,'原表核对')).record;
 assert.equal(draft.status,'draft');assert.equal(draft.published.rows[0].values.verifiedAmount,11000);assert.equal(draft.amendmentReason,'原表核对');
 const resubmitted=await submit(f,f.staff,draft),confirmed=await approve(f,f.manager,resubmitted);
 assert.equal(confirmed.published.rows[0].values.verifiedAmount,10999);
});
test('assigned participating employees can backfill platform days, with supervisor confirmation and immediate loss of access on reassignment',async()=>{
 const f=await setup();
 const assign=async(version:number,participants:string[])=>(await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version,name:f.project.name,ownerLogin:'staff',reviewerLogin:'manager',participants})).project;
 const project=await assign(f.project.version,['staff','other']);
 const scope={projectId:project.id,month:'2026-11'};
 const view=await f.call(f.other,{...scope,action:'ops.month'});
 assert.equal(view.permissions.platform,true);assert.equal(view.permissions.revenue,false);assert.equal(view.permissions.configure,false);
 assert.deepEqual(view.config.builtinSheets.slice().sort(),['douyin','douyin-stores','meituan','meituan-stores']);
 assert.ok((await f.call(f.other,{action:'ops.options'})).projects.some((p:any)=>p.id===project.id));
 for(const date of ['2026-11-09','2026-11-10']){
  const row=await save(f,f.other,'meituan',platformRows(),date);
  await assert.rejects(save(f,f.other,'meituan',platformRows(),date),/已存在|版本/);
  const pending=await submit(f,f.other,row);
  await assert.rejects(approve(f,f.other,pending),/本人|权限|确认/);
  const confirmed=await approve(f,f.manager,pending);
  assert.equal(confirmed.published.date,date);
 }
 await assert.rejects(save(f,f.other,'revenue',revenueRows()),/权限/);
 await assign(project.version,['staff']);
 await assert.rejects(f.call(f.other,{...scope,action:'ops.month'}),/权限/);
 await assert.rejects(save(f,f.other,'douyin',platformRows('douyin')),/权限/);
});
test('both configuration roles reject new unit errors and existing legacy templates can still be retired or retained',async()=>{
 const f=await setup(),key=companyKey(f.company.id),read=()=>f.fixture.read('shixu_company_v1',key);
 const bad={...genericTemplate,writer:'project-owner',metrics:[{key:'bad',label:'费用转化率',numerator:'spend',denominator:'leads',format:'percent'}]};
 const configure=(actor:any,action:string,templates:any[])=>f.call(actor,{action,projectId:f.project.id,revision:read().revision,stores,templates});
 await assert.rejects(configure(f.manager,'ops.configure',[bad]),/公式单位不匹配/);
 await assert.rejects(configure(f.staff,'ops.configureOwn',[bad]),/公式单位不匹配/);
 const before=read();before.operatingConfigs[0].templates=[bad];f.fixture.corrupt('shixu_company_v1',key,before);
 await configure(f.manager,'ops.configure',[{...bad,active:false}, {...genericTemplate,id:'tpl_valid'}]);
 assert.equal(read().operatingConfigs[0].templates[0].active,false);
 assert.deepEqual(read().operatingConfigs[0].templates[0].metrics,bad.metrics);
});
test('leader is told confirmed figures are being corrected without seeing unconfirmed values',async()=>{
 const f=await setup();let r=await approve(f,f.manager,await submit(f,f.owner,await save(f,f.owner)));
 const confirmed=r.version;r=(await f.call(f.owner,{action:'ops.amend',id:r.id,version:r.version,reason:'核对合成数据后更正录入'})).record;
 const view=await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11'});
 assert.equal(view.pendingChanges,1);assert.equal(view.records[0].version,confirmed);assert.equal(view.records[0].status,'approved');
});
test('submitter may withdraw an unconfirmed record while other writers and confirmed records cannot withdraw',async()=>{
 const f=await setup();let r=await submit(f,f.owner,await save(f,f.owner));
 await assert.rejects(f.call(f.manager,{action:'ops.withdraw',id:r.id,version:r.version}),/权限|提交人/);
 r=(await f.call(f.owner,{action:'ops.withdraw',id:r.id,version:r.version})).record;assert.equal(r.status,'draft');assert.equal(r.submittedBy,'');assert.equal(r.version,3);
 r=await approve(f,f.manager,await submit(f,f.owner,r));await assert.rejects(f.call(f.owner,{action:'ops.withdraw',id:r.id,version:r.version}),/状态|待确认/);
});
test('leader can view confirmed numeric data before a separate project progress report is published and never sees a draft rename',async()=>{
 const f=await setup();const p=(await f.run(f.owner,{action:'project.create',companyId:f.company.id,name:'数据先行项目',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;
 const revision=()=>f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;
 await f.call(f.owner,{action:'ops.configure',projectId:p.id,revision:revision(),stores});
 const current={...f,project:p};await approve(current,f.manager,await submit(current,f.owner,await save(current,f.owner)));
 const options=await f.call(f.leader,{action:'ops.options'});assert.ok(options.projects.some((x:any)=>x.id===p.id&&x.name==='数据先行项目'));
 assert.equal((await f.call(f.leader,{action:'ops.month',projectId:p.id,month:'2026-11'})).records.length,1);
 await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:p.id,version:p.version,name:'尚未确认的改名',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']});
 await f.call(f.owner,{action:'ops.configure',projectId:p.id,revision:revision(),stores});
 const view=await f.call(f.leader,{action:'ops.options'});assert.ok(!JSON.stringify(view).includes('尚未确认的改名'));assert.ok(view.projects.some((x:any)=>x.id===p.id&&x.name==='数据先行项目'));
});
test('operating role split allows supervisor revenue and owner platforms, rejects staff, other projects and invalid config',async()=>{const f=await setup();const total=await save(f,f.manager,'revenue',revenueRows());assert.equal(total.rows[1].values.revenue,0);const p=await save(f,f.owner);assert.equal(p.rows[0].values.verifiedCoupons,12);await assert.rejects(save(f,f.manager,'douyin'),/权限/);await assert.rejects(save(f,f.staff,'revenue',revenueRows()),/权限/);await assert.rejects(f.call(f.other,{action:'ops.month',projectId:f.project.id,month:'2026-11'}),/权限/);await assert.rejects(f.call({companyId:'co_000000000000',login:'manager'},{action:'ops.month',projectId:f.project.id,month:'2026-11'}),/权限/);await assert.rejects(f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:f.config.companyRevision,stores:[stores[0]]}),/删除|门店|变化/);});
test('operating confirmation publishes only snapshots, blocks self review and amendment preserves prior confirmed figures',async()=>{const f=await setup();let r=await save(f,f.owner);assert.equal((await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11'})).records.length,0);r=await submit(f,f.owner,r);await assert.rejects(approve(f,f.owner,r),/本人|自|权限/);await assert.rejects(f.call(f.owner,{action:'ops.save',projectId:f.project.id,sheet:r.sheet,date:r.date,version:r.version,rows:r.rows}),/待确认|状态/);r=await approve(f,f.manager,r);const confirmed=r.version;r=(await f.call(f.owner,{action:'ops.amend',id:r.id,version:r.version,reason:'核对合成数据后更正录入'})).record;const rows=structuredClone(r.rows);rows[0].values.orderAmount=99999;r=(await f.call(f.owner,{action:'ops.save',projectId:f.project.id,sheet:r.sheet,date:r.date,version:r.version,rows})).record;const leader=await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11',scope:'live'});assert.equal(leader.records[0].version,confirmed);assert.equal(leader.records[0].rows[0].values.orderAmount,10000);assert.ok(!JSON.stringify(leader).includes('99999'));assert.equal(leader.permissions.platform,false);});
test('supervisor can confirm own store revenue and owner can return it with a reason',async()=>{const f=await setup();let r=await submit(f,f.manager,await save(f,f.manager,'revenue',revenueRows()));assert.equal(r.reviewerLogin,'manager');await assert.rejects(f.call(f.owner,{action:'ops.return',id:r.id,version:r.version,comment:''}),/原因/);r=(await f.call(f.owner,{action:'ops.return',id:r.id,version:r.version,comment:'请核对门店收入'})).record;assert.equal(r.status,'returned');r=(await f.call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:r.sheet,date:r.date,version:r.version,rows:revenueRows()})).record;r=await submit(f,f.manager,r);r=await approve(f,f.manager,r);assert.equal(r.status,'approved');assert.equal(r.reviewerLogin,r.submittedBy);});
test('same date sheet is unique with optimistic versions; mirror failure rolls back record, history, index and directory',async()=>{const f=await setup();const before=f.fixture.keys().length,revision=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;f.fixture.failBackups(true);await assert.rejects(save(f,f.owner),/backup/);f.fixture.failBackups(false);assert.equal(f.fixture.keys().length,before);assert.equal(f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision,revision);const outcomes=await Promise.allSettled([save(f,f.owner),save(f,f.owner)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const month=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.equal(month.records.length,1);const c=f.fixture.read('shixu_company_v1',companyKey(f.company.id));assert.deepEqual(c.operatingMonths['2026-11'],{revision:1,versions:1,count:1});const r=month.records[0];assert.ok(f.fixture.read('shixu_company_backups_v1',f.mod.operatingVersionKey(r.id,1)));const index=f.fixture.read('shixu_company_v1',f.mod.operatingIndexKey(c.id,'2026-11'));assert.equal(index.items[0].id,r.id);});
test('blank required values stay null in drafts and block submit; dates, money, duplicate stores and unknown fields are rejected',async()=>{const f=await setup();const rows=revenueRows();rows[0].values.revenue=null as any;let r=await save(f,f.manager,'revenue',rows);assert.equal(r.rows[0].values.revenue,null);await assert.rejects(submit(f,f.manager,r),/填写|完整|未填/);assert.equal((await save(f,f.owner,'meituan',platformRows(),'2026-11-14')).date,'2026-11-14');await assert.rejects(save(f,f.owner,'meituan',platformRows(),'2026-02-31'),/日期/);const bad=platformRows();bad[0].values.orderAmount=1.01;await assert.rejects(save(f,f.owner,'meituan',bad),/金额|分|整数|字段|数值/);await assert.rejects(save(f,f.manager,'revenue',[revenueRows()[0],revenueRows()[0]],'2026-11-13'),/门店|重复/);const extra:any=platformRows();extra[0].values.unknown=1;await assert.rejects(save(f,f.owner,'meituan',extra),/字段/);});
test('reassigned or disabled supervisors immediately lose operating access and the current supervisor can review pending owner data',async()=>{const f=await setup();let r=await submit(f,f.owner,await save(f,f.owner));await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'newmanager',name:'新主管',roles:['supervisor'],active:true});await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version:f.project.version,name:'未确认新名称',ownerLogin:'staff',reviewerLogin:'newmanager',participants:['staff']});await assert.rejects(f.call(f.manager,{action:'ops.month',projectId:f.project.id,month:'2026-11'}),/权限/);await assert.rejects(approve(f,f.manager,r),/权限/);const fresh={companyId:f.company.id,login:'newmanager'};const month=await f.call(fresh,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.equal(month.records[0].reviewerLogin,'newmanager');r=await approve(f,fresh,r);assert.equal(r.reviewerLogin,'newmanager');const opts=await f.call(f.leader,{action:'ops.options'});assert.equal(opts.projects[0].name,'项目甲');await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'newmanager',name:'新主管',roles:['supervisor'],active:false});await assert.rejects(f.call(fresh,{action:'ops.month',projectId:f.project.id,month:'2026-11'}),/停用|权限/);});
test('monthly targets and cumulative store snapshots are separately keyed by actual cutoff and never overwrite daily platform records',async()=>{const f=await setup();const targets=stores.map(s=>({storeId:s.id,storeName:s.name,values:{target:10000000}}));const t=await save(f,f.manager,'targets',targets,'2026-12-01');assert.equal(t.date,'2026-12-01');await assert.rejects(save(f,f.manager,'targets',targets,'2026-12-02'),/月初|日期/);const rows=stores.map(s=>({storeId:s.id,storeName:s.name,values:{...finance,positiveReviews:null,stars:null}}));const a=await save(f,f.owner,'meituan-stores',rows,'2026-11-07');const b=await save(f,f.owner,'meituan-stores',rows,'2026-11-12');assert.notEqual(a.id,b.id);await save(f,f.owner);const m=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.equal(m.records.length,3);await assert.rejects(f.call(f.leader,{action:'ops.history',id:a.id}),/权限/);});
test('store renames and additions preserve old record labels and rowset, while new records use the updated config',async()=>{const f=await setup();let r=await save(f,f.manager,'revenue',revenueRows());const c=f.fixture.read('shixu_company_v1',companyKey(f.company.id));await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:c.revision,stores:[{id:'s001',name:'样例1号新名'},stores[1],{id:'s003',name:'新门店'}]});r=(await f.call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date:r.date,version:r.version,rows:revenueRows()})).record;assert.equal(r.rows[0].storeName,'样例1号店');assert.equal(r.rows.length,2);const rows=[{storeId:'s001',storeName:'样例1号新名',values:{revenue:1}},revenueRows()[1],{storeId:'s003',storeName:'新门店',values:{revenue:2}}];const next=await save(f,f.manager,'revenue',rows,'2026-11-13');assert.equal(next.rows.length,3);});

const genericTemplate:any={id:'tpl_leads',name:'客资运营',description:'项目日数据',dimension:'total',writer:'supervisor',active:true,fields:[{key:'leads',label:'线索数',kind:'count',required:true},{key:'spend',label:'消耗',kind:'money',required:true}],metrics:[{key:'cpl',label:'每条成本',numerator:'spend',denominator:'leads',format:'money'}]};
async function genericSetup(){const f=await setup(),c=f.fixture.read('shixu_company_v1',companyKey(f.company.id));await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:c.revision,stores,templates:[genericTemplate],builtinSheets:[],dimensionLabel:'渠道'});return f;}
test('project templates reuse generic daily records, select writer role and snapshot trusted schema instead of client supplied formulas',async()=>{const f=await genericSetup();const rows=[{storeId:'all',storeName:'全项目',values:{leads:10,spend:12345}}];let r=(await f.call(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'tpl_leads',date:'2026-11-12',version:0,rows,template:{...genericTemplate,metrics:[]}})).record;assert.deepEqual(r.template.metrics,genericTemplate.metrics);assert.equal(r.rows[0].values.spend,12345);r=await submit(f,f.manager,r);r=await approve(f,f.owner,r);assert.equal(r.published.template.name,'客资运营');await assert.rejects(save(f,f.owner,'meituan'),/模板|启用/);const bad=structuredClone(rows);bad[0].values.leads=1.5;await assert.rejects(save(f,f.manager,'tpl_leads',bad,'2026-11-13'),/整数|字段|数值/);});
test('templates preserve historical schema and cannot be removed or structurally overwritten; copying to a new id is allowed',async()=>{const f=await genericSetup();let r=await submit(f,f.manager,await save(f,f.manager,'tpl_leads',[{storeId:'all',storeName:'全项目',values:{leads:0,spend:0}}]));r=await approve(f,f.owner,r);let rev=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;await assert.rejects(f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:rev,stores,templates:[]}),/删除|历史/);const changed={...genericTemplate,fields:[...genericTemplate.fields,{key:'deals',label:'成交',kind:'count',required:false}]};await assert.rejects(f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:rev,stores,templates:[changed]}),/复制|改写/);await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision:rev,stores,templates:[{...genericTemplate,name:'尚未确认的新模板名',writer:'owner'}, {...changed,id:'tpl_leads_copy'}]});const lead=await f.call(f.leader,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.equal(lead.records[0].template.name,'客资运营');assert.ok(!JSON.stringify(lead).includes('尚未确认的新模板名'));await assert.rejects(f.call(f.manager,{action:'ops.amend',id:r.id,version:r.version}),/权限/);});
test('daily per-store platform detail is one canonical record and all-to-store amendment replaces rows without duplicating totals',async()=>{const f=await setup();let r=await approve(f,f.manager,await submit(f,f.owner,await save(f,f.owner)));const id=r.id;r=(await f.call(f.owner,{action:'ops.amend',id:r.id,version:r.version,reason:'核对合成数据后更正录入'})).record;const rows=stores.map(s=>({storeId:s.id,storeName:s.name,values:{...platformRows()[0].values}}));r=(await f.call(f.owner,{action:'ops.save',projectId:f.project.id,sheet:r.sheet,date:r.date,version:r.version,rows})).record;assert.equal(r.id,id);assert.equal(r.rows.length,2);assert.equal((await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'})).records.length,1);await assert.rejects(save(f,f.owner,'meituan',[platformRows()[0],rows[0]],'2026-11-13'),/门店|行|混|字段/);});
test('monthly reads page all data with a pinned revision and future month reads allow target preparation only',async()=>{const f=await setup();for(let day=1;day<=21;day++)await save(f,f.owner,'meituan',platformRows(),'2026-10-'+String(day).padStart(2,'0'));const first=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-10'});assert.equal(first.records.length,20);assert.equal(first.total,21);assert.equal(first.nextPage,1);const second=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-10',page:1,revision:first.companyRevision});assert.equal(second.records.length,1);assert.equal(second.nextPage,null);assert.equal(new Set([...first.records,...second.records].map(r=>r.id)).size,21);await save(f,f.owner,'meituan',platformRows(),'2026-11-13');await assert.rejects(f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-10',page:1,revision:first.companyRevision}),/变化/);const future=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-12'});assert.equal(future.total,0);});

test('restored index property order does not change record identity or make monthly reads fail',async()=>{const f=await setup();await save(f,f.owner);const key=f.mod.operatingIndexKey(f.company.id,'2026-11'),index=f.fixture.read('shixu_company_v1',key);index.items=index.items.map((h:any)=>Object.fromEntries(Object.entries(h).reverse()));f.fixture.corrupt('shixu_company_v1',key,index);const m=await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.equal(m.records.length,1);});

test('a project employee can access assigned custom and platform data while supervisor data remains restricted',async()=>{const f=await setup();await save(f,f.owner);await save(f,f.manager,'revenue',revenueRows());let revision=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;const template={...genericTemplate,writer:'project-owner'};await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision,stores,templates:[template]});const options=await f.call(f.staff,{action:'ops.options'});assert.equal(options.projects[0].id,f.project.id);const month=await f.call(f.staff,{action:'ops.month',projectId:f.project.id,month:'2026-11'});assert.deepEqual(month.records.map((r:any)=>r.sheet),['meituan']);assert.equal(month.permissions.revenue,false);assert.equal(month.permissions.platform,true);assert.equal(month.permissions.projectOwner,true);let r=await save(f,f.staff,'tpl_leads',[{storeId:'all',storeName:'全项目',values:{leads:5,spend:10000}}]);r=await submit(f,f.staff,r);assert.equal(r.reviewerLogin,'manager');r=await approve(f,f.manager,r);assert.equal(r.status,'approved');await assert.rejects(save(f,f.staff,'revenue',revenueRows(),'2026-11-13'),/权限/);await assert.rejects(save(f,f.other,'tpl_leads',[{storeId:'all',storeName:'全项目',values:{leads:5,spend:10000}}]),/权限/);const ownerRecord=(await f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'})).records.find((r:any)=>r.sheet==='meituan');await f.call(f.staff,{action:'ops.history',id:ownerRecord.id});await assert.rejects(f.call(f.other,{action:'ops.history',id:ownerRecord.id}),/权限/);});

test('requesting summary cannot bypass delegated employee sheet permissions',async()=>{const f=await setup();await approve(f,f.manager,await submit(f,f.owner,await save(f,f.owner)));await approve(f,f.owner,await submit(f,f.manager,await save(f,f.manager,'revenue',revenueRows())));const revision=f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;await f.call(f.owner,{action:'ops.configure',projectId:f.project.id,revision,stores,templates:[{...genericTemplate,writer:'project-owner'}]});const view=await f.call(f.staff,{action:'ops.month',projectId:f.project.id,month:'2026-11',scope:'summary'});assert.deepEqual(view.records.map((r:any)=>r.sheet),['meituan']);assert.equal(view.total,1);assert.ok(!JSON.stringify(view).includes('12345'));});
test('leader day and month views refuse a confirmed snapshot with another project, broken rows or version',async()=>{
 const f=await setup(),record=await approve(f,f.owner,await submit(f,f.manager,await save(f,f.manager,'revenue',revenueRows())));
 for(const change of [{projectId:'p_'+'1'.repeat(24)},{publishedVersion:0},{rows:[]}]) {
  f.fixture.corrupt('shixu_company_v1',record.id,{...record,published:{...record.published,...change}});
  for(const extra of [{},{day:record.date}])await assert.rejects(f.call(f.leader,{action:'ops.month',scope:'summary',month:'2026-11',projectId:f.project.id,...extra}),/快照|不一致/);
 }
});
test('an existing operating index without its company metadata is reported as damaged, including on new writes',async()=>{
 const f=await setup();await save(f,f.manager,'revenue',revenueRows());
 const key=companyKey(f.company.id),directory=f.fixture.read('shixu_company_v1',key);
 delete directory.operatingMonths['2026-11'];f.fixture.corrupt('shixu_company_v1',key,directory);
 await assert.rejects(f.call(f.owner,{action:'ops.month',projectId:f.project.id,month:'2026-11'}),/目录/);
 await assert.rejects(save(f,f.manager,'revenue',revenueRows(),'2026-11-11'),/目录/);
});
