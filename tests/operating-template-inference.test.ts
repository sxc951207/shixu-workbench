import test from 'node:test';
import assert from 'node:assert/strict';
import {inferOperatingTemplate,inferScreenshotTemplate} from '../lib/workbench/operating-template-inference.ts';
import {readOperatingFile,prepareOperatingFileRows} from '../lib/workbench/operating-file.ts';
import {previewOperatingPaste} from '../lib/workbench/operating-paste.ts';
import {readFile} from 'node:fs/promises';

test('a wide monthly store ledger yields one daily measure and store names, without targets or fact values',()=>{
 const result=inferOperatingTemplate([
  ['11月总业绩汇总'],['日期','湖边店','西街店','月总业绩目标'],
  ['月业绩指标',300000,400000,700000],[null,'每日业绩','每日业绩','合计'],
  ['11/1/2026',5000,6000,11000],['合计',5000,6000,11000],['累计完成率',0.1,0.2,0.15],
 ]);
 assert.equal(result.headerRow,1);
 assert.deepEqual(result.analysis.fields.map(f=>f.label),['门店总业绩']);
 assert.deepEqual(result.analysis.dimension?.names,['湖边店','西街店']);
 assert.doesNotMatch(JSON.stringify(result),/300000|700000/);
});
test('platform workbook resolves lower header, keeps ratios computed and excludes summary rows',()=>{
 const result=inferOperatingTemplate([
  ['11月平台数据'],['门店详情',null,'交易数据',null,null,'平台投产'],
  ['日期','门店名称','下单券数','核销券数','核销率','未知比例'],
  ['11/1/2026','西街店',10,5,0.5,0.2],['合计','全部',10,5,0.5,0.2],
 ]);
 assert.equal(result.headerRow,2);
 assert.deepEqual(result.analysis.dimension?.names,['西街店']);
 assert.deepEqual(result.analysis.fields.map(f=>f.key),['orderedCoupons','verifiedCoupons']);
 assert.deepEqual(result.metrics.map(m=>[m.numerator,m.denominator]),[['verifiedCoupons','orderedCoupons']]);
 assert.ok(result.notes.some(s=>s.includes('未知比例')));
});
test('split header preserves a vertically merged store label and horizontally separate metrics',()=>{
 const result=inferOperatingTemplate([
  ['门店','外卖渠道',null,'堂食渠道',null],
  [null,'成交金额','成交数','成交金额','成交数'],
  ['湖边店',10.20,1,12.30,3],['小计',10.20,1,12.30,3],
 ]);
 assert.deepEqual(result.analysis.dimension?.names,['湖边店']);
 assert.deepEqual(result.analysis.fields.map(f=>f.label),['外卖渠道·成交金额','外卖渠道·成交数','堂食渠道·成交金额','堂食渠道·成交数']);
});
test('unknown units or an ambiguous store matrix require clarification; a corrected header row is supported',()=>{
 assert.throws(()=>inferOperatingTemplate([['营收（万元）'],['日期','湖边店','西街店'],['11/1/2026',2,3]]),/单位/);
 assert.throws(()=>inferOperatingTemplate([['日期','湖边店','西街店'],['11/1/2026',2,3]]),/指标/);
 assert.throws(()=>inferOperatingTemplate([['总业绩'],['日期','东街店','南路店','西街占'],['11/1/2026',2,3,4]]),/西街占/);
 assert.throws(()=>inferOperatingTemplate([['月总业绩目标'],['日期','东街店','南路店'],['11/1/2026',2,3]]),/目标或累计/);
 assert.equal(inferOperatingTemplate([['附注'],['花费'],[100.8]],1).headerRow,1);
});
test('a real merged workbook can generate two forms and be reused for the selected day',async()=>{
 const bytes=await readFile(new URL('./fixtures/operating-template-merged.xlsx',import.meta.url));
 const sheets=await readOperatingFile(new File([bytes],'source.xlsx'));
 const [ledger,channels]=sheets.map(sheet=>inferOperatingTemplate(sheet.data));
 assert.deepEqual(ledger.analysis.dimension?.names,['东街店','西街店']);
 assert.deepEqual(channels.analysis.fields.map(f=>f.label),['外卖渠道·成交金额','外卖渠道·成交数','堂食渠道·成交金额','堂食渠道·成交数']);
 assert.deepEqual(channels.analysis.dimension?.names,['东街店']);
 const template={id:'tpl_channels',name:'渠道日报',description:'',dimension:'store' as const,writer:'project-owner' as const,active:true,fields:channels.analysis.fields,metrics:channels.metrics};
 const options={sheet:'tpl_channels' as const,date:'2026-11-01',template,stores:[{id:'s001',name:'东街店'}]};
 const prepared=prepareOperatingFileRows(sheets[1].data,channels.headerRow,options);
 const [row]=previewOperatingPaste(prepared.text,options).rows;
 assert.deepEqual(channels.analysis.fields.map(field=>row.values[field.key]),[11400,1,22200,3]);
 assert.equal(prepared.skippedSummaryRows,1);
});
test('a blank form keeps numeric measures, and identifier columns and incompatible units never become metrics',()=>{
 const result=inferOperatingTemplate([['渠道名称','订单编号','手机号','门店访问人数','售后费用（元）']]);
 assert.deepEqual(result.analysis.fields.map(f=>[f.label,f.kind]),[['门店访问人数','count'],['售后费用','money']]);
 assert.deepEqual(result.analysis.dimension,{label:'渠道',names:[]});
 assert.throws(()=>inferOperatingTemplate([['日期','核销金额（次）']]),/单位/);
 const numericIds=inferOperatingTemplate([['项目编号','客户手机号','订单号','成交数'],[100,12345678,15,2]]);
 assert.deepEqual(numericIds.analysis.fields.map(f=>f.label),['成交数']);
});

test('截图模板具体指出有数值的漏读列，保留零、编号与自定义指标',()=>{
 const rows=[['门店','订单编号','新增计划数',''],['甲店','00123',1,0],['乙店','00124',2,15]];
 assert.throws(()=>inferScreenshotTemplate(rows,0),/第 4 列/);
 const fixed=inferScreenshotTemplate([['门店','订单编号','新增计划数','售后件数'],...rows.slice(1)],0);
 assert.deepEqual(fixed.analysis.fields.map(f=>f.label),['新增计划数','售后件数']);
 assert.deepEqual(fixed.analysis.dimension?.names,['甲店','乙店']);
});
test('截图模板对被当成文本的数值列提示核对，真正的备注可以保留',()=>{
 const rows=[['日期','订单','数量候选','备注'],...['12','15','18','?'].map((value,i)=>['11月'+(i+1)+'日',i,value,'文字'])];
 assert.throws(()=>inferScreenshotTemplate(rows,0),/第 3 列「数量候选」/);
});
