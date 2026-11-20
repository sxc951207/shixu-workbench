import test from 'node:test';
import assert from 'node:assert/strict';
import {applyColumnRules,identifyColumns} from '../lib/workbench/operating-column-map.ts';
import {companyFixture} from './fixtures/company.ts';
import {executeOperating} from '../cloud/company/operating.ts';
import {companyKey} from '../cloud/company/core.ts';
import {prepareOperatingFileRows} from '../lib/workbench/operating-file.ts';

test('a different source layout can bind its own amount label, preserving order, dates and units',()=>{
 const matrix=[['日期','核销张数','到账（元）'],['11月1日',12,123.45]];
 const rules={'到账（元）':'verifiedAmount','核销张数':'verifiedCoupons'};
 const result=identifyColumns(matrix,0,'douyin')!;
 const mapped=applyColumnRules(matrix,0,result,rules);
 const reordered=[['到账（元）','日期','核销张数'],[123.45,'11月1日',12]];
 const second=identifyColumns(reordered,0,'douyin')!;
 assert.equal(second.signature,result.signature);
 assert.deepEqual(applyColumnRules(reordered,0,second,rules)[0],['核销金额','日期','核销券数']);
 const preview=prepareOperatingFileRows(mapped,0,{date:'2026-11-01',sheet:'douyin',stores:[{id:'all',name:'全平台'}]});
 assert.match(preview.text,/123\.45/);
 assert.throws(()=>applyColumnRules(matrix,0,result,{'到账（元）':'verifiedCoupons','核销张数':''}),/单位/);
 assert.throws(()=>applyColumnRules(matrix,0,result,{}),/请确认/);
 assert.throws(()=>applyColumnRules(matrix,0,result,{'到账（元）':'verifiedAmount','核销张数':'verifiedAmount'}),/两列/);
 assert.throws(()=>identifyColumns([['到账（万元）'],[12]],0,'douyin'),/单位/);
});
test('project column preferences persist across sessions with scoped rights and revision checks',async()=>{
 const f=await companyFixture(),call=(actor:any,b:any)=>f.store.run(tx=>executeOperating(tx,actor,{companyId:f.company.id,projectId:f.project.id,sheet:'douyin',...b}));
 await call(f.owner,{action:'ops.configure',stores:[{id:'s001',name:'门店'}],revision:f.fixture.read('shixu_company_v1',companyKey(f.company.id)).revision});
 const b={signature:'unit-test-format',action:'ops.columnRules.save',version:0,rules:[['到账（元）','verifiedAmount']]};
 await call(f.staff,b);
 assert.deepEqual((await call(f.owner,{...b,action:'ops.columnRules.read'})).rules,b.rules);
 await assert.rejects(call(f.staff,b),/已更新/);
 assert.deepEqual((await call(f.staff,{...b,sheet:'meituan',action:'ops.columnRules.read'})).rules,[]);
 await assert.rejects(call(f.leader,b),/权限/);
 await assert.rejects(call(f.staff,{...b,version:1,rules:[['到账','unknown']]}),/指标无效/);
});

test('a Douyin source cannot preview as Meituan, and its visit count and visitors stay separate',()=>{
 const matrix=[['某项目（抖音）11月平台数据'],['日期','下单金额','门店访问/次','门店访问人数','进入私信人数','私信开口人数','私信线索人数'],['2026-11-18',500,123,88,50,39,27]];
 assert.throws(()=>identifyColumns(matrix,1,'meituan'),/抖音.*美团/);
 const opts={date:'2026-11-18',stores:[{id:'all',name:'全平台'}]};
 assert.throws(()=>prepareOperatingFileRows(matrix,1,{...opts,sheet:'meituan'}),/抖音.*美团/);
 const preview=prepareOperatingFileRows(matrix,1,{...opts,sheet:'douyin'});
 assert.match(preview.text,/进店次数\t进店人数\t私信咨询人数\t私信开口人数\t私信留资人数/);
 assert.match(preview.text,/123\t88\t50\t39\t27/);
});

test('a saved mapping cannot turn a conversation opener into a lead',()=>{
 const rows=[['日期','私信开口人数'],['2026-11-18',39]];
 const review=identifyColumns(rows,0,'meituan')!;
 assert.throws(()=>applyColumnRules(rows,0,review,{'私信开口人数':'leads'}),/留资线索/);
});

test('a dated custom platform template accepts its month caption only for matching dates',()=>{
 const tpl={id:'tpl_channel',name:'美团日录',description:'',dimension:'total' as const,writer:'owner' as const,active:true,fields:[{key:'orderAmount',label:'下单金额',kind:'money' as const,required:true}],metrics:[]};
 const options={date:'2026-11-18',sheet:'tpl_channel' as const,template:tpl,stores:[{id:'all',name:'全项目'}]};
 const matrix=[['示例（美团）11月平台数据'],['日期','下单金额'],['2026-11-18',100]];
 assert.match(prepareOperatingFileRows(matrix,1,options).text,/100/);
 assert.throws(()=>prepareOperatingFileRows([['示例（美团）10月平台数据'],...matrix.slice(1)],1,options),/月份/);
});

test('first import treats total exposure as derived only when both source columns add up on every row',()=>{
 const labels=['日期','自然曝光次数','cpc曝光次数','曝光次数'];
 const sample=[labels,['11月1日','1,003',2,1005],['11月2日',0,0,0],['11月5日',0,null,null]];
 assert.equal(identifyColumns(sample,0,'meituan'),undefined);
 for(const values of [[1,2,4],[null,2,2],['???',2,2]]){
  assert.ok(identifyColumns([...sample,['11月3日',...values]],0,'meituan')?.candidates.includes('曝光次数'));
 }
});
