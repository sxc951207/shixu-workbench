import test from'node:test';import assert from'node:assert/strict';
import{companyFixture,COMPANY_NOW}from'./fixtures/company.ts';import{companyKey}from'../cloud/company/core.ts';import{executeOperating}from'../cloud/company/operating.ts';import{executeReport}from'../cloud/company/reports.ts';
const template={id:'tpl_review',name:'员工客资',description:'',dimension:'total' as const,writer:'project-owner' as const,active:true,fields:[{key:'leads',label:'客资数',kind:'count' as const,required:true}],metrics:[]};
async function setup(){const mod=await import('../cloud/company/review.ts').catch(()=>null);assert.equal(typeof mod?.executeCompanyReview,'function','read-only review service is implemented');const f=await companyFixture(),revision=()=>f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision;
 const ops=(actor:any,b:any)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,...b},COMPANY_NOW)),reports=(actor:any,b:any)=>f.store.run(tx=>executeReport(tx,actor,{companyId:f.company.id,...b},COMPANY_NOW)),call=(actor:any,b:any)=>f.store.run(tx=>mod!.executeCompanyReview(tx,actor,{companyId:f.company.id,...b}));
 await ops(f.manager,{action:'ops.configure',projectId:f.project.id,revision:revision(),stores:[{id:'s001',name:'甲店'}],builtinSheets:['revenue'],templates:[template]});
 const records:any[]=[];for(const date of['2026-10-12','2026-11-12']){let r=(await ops(f.staff,{action:'ops.save',projectId:f.project.id,sheet:template.id,date,version:0,rows:[{storeId:'all',storeName:'全项目',values:{leads:7}}]})).record;r=(await ops(f.staff,{action:'ops.submit',id:r.id,version:r.version})).record;if(date.startsWith('2026-10')){r=(await ops(f.manager,{action:'ops.approve',id:r.id,version:r.version})).record;r=(await ops(f.staff,{action:'ops.amend',id:r.id,version:r.version,reason:'旧月核对凭证更正'})).record;r=(await ops(f.staff,{action:'ops.submit',id:r.id,version:r.version})).record;}records.push(r);}
 let ownerRecord=(await ops(f.manager,{action:'ops.save',projectId:f.project.id,sheet:'revenue',date:'2026-11-12',version:0,rows:[{storeId:'s001',storeName:'甲店',values:{revenue:10000}}]})).record;ownerRecord=(await ops(f.manager,{action:'ops.submit',id:ownerRecord.id,version:ownerRecord.version})).record;
 const text:any[]=[];for(const[kind,periodDate]of[['weekly','2026-10-12'],['monthly','2026-10'],['weekly','2026-11-12'],['monthly','2026-11']]){let r=(await reports(f.staff,{action:'report.create',projectId:f.project.id,kind,periodDate})).report;r=(await reports(f.staff,{action:'report.save',id:r.id,version:r.version,progress:20,achievement:'待核实成果',risk:'',next:'',help:'',sourceVersions:[]})).report;r=(await reports(f.staff,{action:'report.submit',id:r.id,version:r.version})).report;text.push(r);}
 return{...f,revision,ops,reports,call,records,ownerRecord,text};}
test('reminder follows the actionable queue, ignores drafts, and refreshes after a decision',async()=>{
 const f=await setup();
 const count=async(actor:any)=>{
  const page=await f.call(actor,{action:'review.reminder'});
  assert.deepEqual(Object.keys(page).sort(),['companyRevision','count','nextCursor']);
  assert.equal(page.nextCursor,null);
  assert.equal(page.count,(await all(f,actor)).length);
  return page;
 };
 const initial=await count(f.manager);assert.ok(initial.count>0);
 const same=await f.call(f.manager,{action:'review.reminder',knownRevision:initial.companyRevision});assert.equal(same.unchanged,true);
 let r=f.text[0];await f.reports(f.manager,{action:'report.approve',id:r.id,version:r.version,comment:''});
 const current=await count(f.manager);assert.equal(current.count,initial.count-1);assert.ok(current.companyRevision>initial.companyRevision);
 await count(f.owner);await assert.rejects(f.call(f.staff,{action:'review.reminder',knownRevision:current.companyRevision}),/权限/);
});
async function all(f:any,actor:any,filter:any={}){const items:any[]=[];let cursor:any,revision:number|undefined;for(let i=0;i<100;i++){const page:any=await f.call(actor,{action:'review.list',...filter,...(cursor?{cursor,revision}:{})});items.push(...page.items);if(!page.nextCursor)return items;cursor=page.nextCursor;revision=page.companyRevision;}throw Error('Review cursor failed to finish');}

test('import submission groups contain only still-pending business dates from that submission',async()=>{
 const f=await setup(),batch='aab85f01-3d41-4cdd-ae5f-77f353d40611';
 async function save(date:string){
  return (await f.ops(f.staff,{action:'ops.save',projectId:f.project.id,sheet:template.id,date,version:0,rows:[{storeId:'all',storeName:'全项目',values:{leads:1}}]})).record;
 }
 const oldDay=await save('2026-10-31'),newDay=await save('2026-11-01');
 await assert.rejects(f.ops(f.staff,{action:'ops.submit',id:oldDay.id,version:oldDay.version,submissionBatchId:'invalid'}),/批次/);
 for(const record of [oldDay,newDay])await f.ops(f.staff,{action:'ops.submit',id:record.id,version:record.version,submissionBatchId:batch});
 await assert.rejects(f.ops(f.staff,{action:'ops.submit',id:newDay.id,version:newDay.version,submissionBatchId:batch}),/变化|刷新/);
 const {groupReviewSubmissions}=await import('../lib/workbench/company-review.ts');
 const queue=await all(f,f.manager,{type:'operating'});
 const groups=groupReviewSubmissions(queue);
 const submitted=groups.filter(group=>group.batch);
 assert.equal(submitted.length,1);
 assert.deepEqual(submitted[0].items.map(i=>i.date),['2026-10-31','2026-11-01']);
 assert.equal(groups.filter(group=>!group.batch).length,3);
 assert.ok(!(await all(f,f.owner,{type:'operating'})).some(row=>row.submissionBatchId===batch));
 await assert.rejects(f.call(f.staff,{action:'review.list',type:'operating'}),/权限/);
 const approval=await f.ops(f.manager,{action:'ops.approve',id:oldDay.id,version:oldDay.version+1});
 assert.equal(approval.record.published.submissionBatchId,undefined);
 const remaining=await all(f,f.manager,{type:'operating'});
 assert.deepEqual(remaining.filter(row=>row.submissionBatchId===batch).map(row=>row.id),[newDay.id]);
 const withdrawn=await f.ops(f.staff,{action:'ops.withdraw',id:newDay.id,version:newDay.version+1});
 await f.ops(f.staff,{action:'ops.submit',id:newDay.id,version:withdrawn.record.version});
 await assert.rejects(f.ops(f.manager,{action:'ops.approve',id:newDay.id,version:newDay.version+1}),/变化|刷新/);
 assert.ok(!(await all(f,f.manager,{type:'operating'})).some(row=>row.submissionBatchId));
 const first=submitted[0].items[0];
 assert.equal(groupReviewSubmissions([first,{...first,id:'otherProject',projectId:'other'},{...first,id:'otherSheet',sheet:'douyin'},{...first,id:'otherWriter',submittedBy:'other'},{...first,id:'otherBatch',submissionBatchId:crypto.randomUUID()}]).length,5);
});

test('review queue finds current and old corrections plus both text periods under current approval authority',async()=>{const f=await setup(),items=await all(f,f.manager);assert.equal(items.filter(i=>i.type==='operating').length,3);assert.equal(items.find(i=>i.id===f.records[0].id)?.amendment,true);assert.equal(items.find(i=>i.id===f.records[1].id)?.amendment,false);assert.equal(items.filter(i=>i.type==='weekly').length,2);assert.equal(items.filter(i=>i.type==='monthly').length,2);assert.ok(items.some(i=>i.id===f.records[0].id&&i.date==='2026-10-12'));assert.ok(items.some(i=>i.id===f.ownerRecord.id));for(const i of items){assert.equal(i.projectId,f.project.id);assert.equal(i.projectName,f.project.name);assert.ok(!('rows'in i));assert.ok(!('achievement'in i));}
 const owner=await all(f,f.owner);assert.ok(owner.some(i=>i.id===f.ownerRecord.id));assert.ok(!owner.some(i=>f.records.some(r=>r.id===i.id)),'owner must not inherit supervisor-only numeric confirmation');});

test('review configuration exposes assigned draft project metadata without exposing unsubmitted contents',async()=>{const f=await setup();const p=(await f.run(f.owner,{action:'project.create',companyId:f.company.id,name:'新分配项目',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).project;await f.run(f.staff,{action:'project.save',companyId:f.company.id,id:p.id,version:p.version,progress:17,achievement:'未提交秘密成果',risk:'未提交秘密风险',next:'秘密计划'});
 const options=await f.call(f.manager,{action:'review.projects'});assert.ok(options.projects.some((i:any)=>i.id===p.id&&i.name==='新分配项目'&&i.configured===false));assert.ok(options.projects.some((i:any)=>i.id===f.project.id&&i.configured));assert.ok(!JSON.stringify(options).includes('秘密'));assert.ok(options.projects.every((i:any)=>Object.keys(i).sort().join(',')==='configured,id,name'));
 for(const actor of[f.staff,f.leader,f.other])await assert.rejects(f.call(actor,{action:'review.projects'}),/主管|权限/);});

test('review filters use business date or report start month and do not read unrelated months or draft records',async()=>{const f=await setup();let seen:string[]=[];const mod=await import('../cloud/company/review.ts');const result=await f.store.run(tx=>mod.executeCompanyReview({...tx,get:async(id:string,backup?:boolean)=>{seen.push(id);return tx.get(id,backup);}},f.manager,{companyId:f.company.id,action:'review.list',type:'operating',projectId:f.project.id,month:'2026-10'}));assert.equal(result.items.length,1);assert.equal(result.items[0].id,f.records[0].id);assert.ok(!seen.some(id=>id.includes('2026-11')));assert.ok(!seen.includes(f.ownerRecord.id));
 const weekly=await all(f,f.manager,{type:'weekly',month:'2026-10',projectId:f.project.id});assert.equal(weekly.length,1);assert.equal(weekly[0].type,'weekly');assert.equal(weekly[0].start,'2026-10-12');await assert.rejects(f.call(f.manager,{action:'review.list',month:'not-a-month'}),/月份/);await assert.rejects(f.call(f.manager,{action:'review.list',type:'draft'}),/类型/);});

test('review cursor is bounded and pinned to company revision and matching filters',async()=>{const f=await setup();for(let day=1;day<=25;day++){let r=(await f.ops(f.staff,{action:'ops.save',projectId:f.project.id,sheet:template.id,date:'2026-09-'+String(day).padStart(2,'0'),version:0,rows:[{storeId:'all',storeName:'全项目',values:{leads:day}}]})).record;await f.ops(f.staff,{action:'ops.submit',id:r.id,version:r.version});}
 const first=await f.call(f.manager,{action:'review.list',type:'operating',month:'2026-09'});assert.equal(first.items.length,20);assert.ok(first.nextCursor);assert.ok(first.scanned.candidates<=20);assert.ok(first.scanned.indexes<=4);const rest=await f.call(f.manager,{action:'review.list',type:'operating',month:'2026-09',cursor:first.nextCursor,revision:first.companyRevision});assert.equal(rest.items.length,5);assert.equal(rest.nextCursor,null);assert.equal(new Set([...first.items,...rest.items].map(i=>i.id)).size,25);
 await assert.rejects(f.call(f.manager,{action:'review.list',type:'weekly',month:'2026-09',cursor:first.nextCursor,revision:first.companyRevision}),/游标|筛选/);await assert.rejects(f.call(f.manager,{action:'review.list',type:'operating',month:'2026-09',cursor:first.nextCursor}),/版本|游标/);await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'other',name:'更新成员',roles:['employee'],active:true});await assert.rejects(f.call(f.manager,{action:'review.list',type:'operating',month:'2026-09',cursor:first.nextCursor,revision:first.companyRevision}),/变化|刷新/);});

test('supervisor transfer and project access are enforced on listing and exact project opening',async()=>{const f=await setup();let p=(await f.run(f.staff,{action:'project.amend',companyId:f.company.id,id:f.project.id,version:f.project.version})).project;p=(await f.run(f.staff,{action:'project.submit',companyId:f.company.id,id:p.id,version:p.version})).project;const items=await all(f,f.manager,{type:'project'});assert.equal(items.length,1);assert.equal(items[0].amendment,true);const opened=await f.call(f.manager,{action:'review.project',id:p.id});assert.equal(opened.project.id,p.id);assert.equal(opened.project.status,'submitted');
 await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'newmanager',name:'接任主管',roles:['supervisor'],active:true});await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:p.id,version:p.version,name:p.name,ownerLogin:'staff',reviewerLogin:'newmanager',participants:['staff']});assert.equal((await all(f,f.manager)).length,0);await assert.rejects(f.call(f.manager,{action:'review.list',projectId:p.id}),/权限|项目/);await assert.rejects(f.call(f.manager,{action:'review.project',id:p.id}),/权限|待确认/);
 for(const actor of[f.staff,f.leader,{companyId:'co_000000000000',login:'manager'}])await assert.rejects(f.call(actor,{action:'review.list'}),/权限|主管/);});

test('queue requires current submitted records and valid monthly indexes rather than inventing empty success',async()=>{const f=await setup();const key='operating_index_'+f.company.id+'_2026-10',index=f.fixture.read('shixu_company_v1',key);index.items[0].version++;f.fixture.corrupt('shixu_company_v1',key,index);await assert.rejects(f.call(f.manager,{action:'review.list',type:'operating',month:'2026-10'}),/目录|版本|一致/);});

test('a supervisor with no assigned projects does not scan other projects monthly directories',async()=>{const f=await setup();await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'newmanager',name:'接任主管',roles:['supervisor'],active:true});await f.run(f.owner,{action:'project.configure',companyId:f.company.id,id:f.project.id,version:f.project.version,name:f.project.name,ownerLogin:'staff',reviewerLogin:'newmanager',participants:['staff']});const result=await f.call(f.manager,{action:'review.list'});assert.deepEqual(result.items,[]);assert.equal(result.nextCursor,null);assert.equal(result.scanned.indexes,0);assert.equal(result.scanned.candidates,0);});
