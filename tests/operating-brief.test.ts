import {test} from 'node:test';
import assert from 'node:assert/strict';
import {briefDates,buildOperatingBrief} from '../lib/workbench/operating-brief.ts';
import {comparisonRecord,comparisonScope} from './fixtures/operating-comparison.ts';

test('report includes the business week across a month boundary and compares like weekdays',()=>{
 const dates=briefDates('2026-12-02','week');
 assert.deepEqual(dates.current,{start:'2026-11-30',end:'2026-12-02'});
 assert.deepEqual(dates.previous,{start:'2026-11-23',end:'2026-11-25'});
 const records=['2026-11-23','2026-11-24','2026-11-25','2026-11-30','2026-12-01','2026-12-02'].map((date,i)=>comparisonRecord(date,i<3?500:700));
 const run=()=>buildOperatingBrief(records,comparisonScope.companyId,comparisonScope.projectId,'revenue','2026-12-02','week');
 assert.equal(run().totals.revenue,2100);assert.equal(run().priorTotals.revenue,1500);assert.equal(run().details[0].days,3);
 records.pop();const partial=run();assert.deepEqual(partial.missing,['2026-12-02']);assert.deepEqual(partial.priorTotals,{});
});

test('platform report keeps zero, derives ROI from sums and does not invent branches for platform totals',()=>{
 const date='2026-11-18';
 const record=comparisonRecord(date,0,{sheet:'meituan',rows:[{id:'all',name:'全平台',values:{verifiedAmount:530355,adSpend:95333,orderAmount:811820,refundAmount:0,orderedCoupons:68,verifiedCoupons:44}}]});
 const report=buildOperatingBrief([record],comparisonScope.companyId,comparisonScope.projectId,'meituan',date,'day');
 assert.equal(report.totals.verifiedAmount,530355);assert.equal(report.totals.refundAmount,0);
 assert.equal(report.details.length,0);assert.equal(report.metrics.find(m=>m.key==='verifiedRoi')?.value,530355/95333);
});
