import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDailyReportRows as normalize,dailyReportSections} from '../lib/workbench/operating-row-layout.ts';

const reference='2026-11-15';
test('daily metric rows retain dates, titles, zero and empty cells and drop labeled total columns',()=>{
 const matrix=[['平台明细'],['指标名称',new Date('2026-11-05Z'),'11月6日','合计'],['下单金额',218.75,315.5,534.25],['退款金额',null,0,0]];
 assert.deepEqual(normalize(matrix,2,reference),{header:1,rows:[matrix[0],['日期','下单金额','退款金额'],['2026-11-05',218.75,null],['2026-11-06',315.5,0]]});
});
test('date-axis checks all labels, duplicate days, missing headings and the output width',()=>{
 const convert=(m:unknown[][])=>normalize(m,0,reference);
 assert.throws(()=>convert([['指标','11月5日','销售二部'],['下单金额',1,2]]),/销售二部/);
 assert.throws(()=>convert([['指标','11月5日','2026-11-05'],['下单金额',1,2]]),/重复/);
 assert.throws(()=>convert([['指标','11月5日'],['下单金额',1,2]]),/列/);
 assert.throws(()=>convert([['指标','11月5日'],['',1]]),/名称/);
 assert.throws(()=>convert([['指标','11月5日'],['下单金额',1],['下单金额',2]]),/重复/);
});
test('only identical repeated dated headers disappear; different labels, order and notes survive validation',()=>{
 const h=['业务日期','下单金额','核销金额'], row=['2026-11-07',20,0], partial=['业务日期','核销金额','下单金额'];
 const m=[h,row,[...h],['合计',20,0],partial];
 assert.deepEqual(normalize(m,0,reference),{header:0,rows:[h,row,m[3],partial]});
 const noDate=[['指标','目标'],['核销金额',2]];
 assert.deepEqual(normalize(noDate,0,reference),{header:0,rows:noDate});
});

test('a labelled date axis cannot swallow an earlier dated table on the same sheet',()=>{
 const mixed=[['业务日期','退款金额'],['2026-11-01',3],['指标','2026-11-05'],['退款金额',8]];
 assert.throws(()=>normalize(mixed,0,reference),/多组|拆分/);
});

test('one source can contain independently dated tables; a repeated page heading alone is not a new table',()=>{
 const a=['业务日期','到店数'],b=['日期','消耗'],day=['11 月 5 日',0];
 assert.deepEqual(dailyReportSections([a,day,[...a],day]),[]);
 const rows=[['展厅日报'],a,day,[],['推广日报'],b,day];
 const parts=dailyReportSections(rows);
 assert.deepEqual(parts.map(p=>[p.start,p.header,p.end]),[[0,1,3],[3,5,7]]);
 assert.deepEqual(parts.map(p=>rows.slice(p.start,p.end)[p.header-p.start]),[a,b]);
 assert.equal(dailyReportSections([a,day,['另一平台'],a,day]).length,2);
 assert.throws(()=>dailyReportSections([['日期','到店数','业务日期','推广消耗'],[day[0],2,day[0],12]]),/左右/);
 assert.throws(()=>dailyReportSections([['单位：万元'],a,day,b,day]),/换算/);
});
