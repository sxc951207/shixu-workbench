import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {companyFixture} from './fixtures/company.ts';
import {approvalDescription,approvalNext,approvalPreview} from '../lib/workbench/approval-display.ts';

test('drafts show the configured order and pending submissions retain their original order',()=>{
 const members=[{login:'a',name:'林宁'},{login:'b',name:'陈实'},{login:'z',name:'其他员工'}];
 const preview=approvalPreview(members,['b','a']);
 assert.deepEqual(preview,['陈实','林宁']);
 const record={approvalFlow:{steps:['a','b'],names:['林宁','陈实'],index:1},approvalPreview:preview};
 assert.equal(approvalDescription(record,'returned'),'提交后由 2 人依次确认：陈实 → 林宁');
 assert.equal(approvalDescription(record,'submitted'),'确认顺序（2 人）：林宁 → 陈实 · 当前第 2/2 步，等待陈实确认');
 assert.equal(approvalNext(record),'');
 assert.equal(approvalNext({...record,approvalFlow:{...record.approvalFlow,index:0}}),'陈实');
});

test('legacy single recipients and administrators have readable names',()=>{
 assert.deepEqual(approvalPreview([],['owner']),['管理员']);
 assert.equal(approvalDescription({approvalPreview:['管理员']},'draft'),'提交后由管理员确认（1 人）');
 assert.equal(approvalDescription({approvalPreview:['管理员']},'submitted'),'当前第 1/1 步，等待管理员确认');
});
test('namesakes can identify the assigned recipient by login without exposing the directory',()=>{
 const members=[{login:'a',name:'林宁'},{login:'b',name:'林宁'}];
 assert.deepEqual(approvalPreview(members,['b']),['林宁（b）']);
});

test('legacy self-submitted progress stays with its eligible administrator',async()=>{
 const {run,company,owner,manager}=await companyFixture();
 const project=(await run(owner,{action:'project.create',companyId:company.id,name:'主管个人项目',ownerLogin:'manager',reviewerLogin:'manager',participants:['manager']})).project;
 const submit=async(action:string,version:number,fields={})=>(await run(manager,{action,id:project.id,companyId:company.id,version,...fields})).project;
 const visible=async()=> (await run(manager,{action:'view',companyId:company.id,scope:'mine'})).projects.find((row:{id:string})=>row.id===project.id);
 assert.deepEqual((await visible()).approvalPreview,['管理员']);
 const draft=await submit('project.save',project.version,{progress:30,achievement:'完成核对',risk:'',next:''});
 await submit('project.submit',draft.version);
 assert.deepEqual((await visible()).approvalPreview,['管理员']);
});

import {approvalFlowSchema} from '../lib/workbench/approval-flow-schema.ts';
test('a longest-length namesake display label can be archived with its approval snapshot',()=>{
 const login='a'.repeat(40),name='张'.repeat(40);
 const names=approvalPreview([{login,name},{login:'other',name}],[login]);
 assert.equal(names[0].length,82);
 assert.ok(approvalFlowSchema.safeParse({steps:[login],index:0,names}).success);
});
