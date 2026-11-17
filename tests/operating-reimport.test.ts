import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareOperatingImport} from '../lib/workbench/operating-reimport.ts';
import {sourceBusinessDates,groupSourceRows} from '../lib/workbench/operating-source-date.ts';
import {isBrandedPlatformTotal,prepareOperatingFileRows} from '../lib/workbench/operating-file.ts';
import {previewOperatingPaste} from '../lib/workbench/operating-paste.ts';

const matrix=[
 ['美团4月平台数据'],['日期','周','核销金额（元）','自然曝光次数'],
 ['2026-04-01','周三',123.45,56],['第一周','合计',123.45,56],
 ['2026-04-02','周四',0,0],['2026-04-03','周五',null,0],['2026-04-04','周六',null,null]
];
test('platform import distinguishes dated transactions, genuine zeros, optional-only days, and Chinese weekly sums',()=>{
 assert.ok(isBrandedPlatformTotal(matrix,1,'meituan'));
 assert.ok(!isBrandedPlatformTotal(matrix,1,'douyin'));
 const dates=sourceBusinessDates(matrix,1,'meituan','2026-11-15',false);
 assert.deepEqual(dates,['2026-04-01','2026-04-02']);
 assert.deepEqual(sourceBusinessDates(matrix,1,'meituan'),[...dates,'2026-04-03']);
 const opts={sheet:'meituan' as const,date:dates[0],stores:[{id:'all',name:'全平台'}]};
 const groups=groupSourceRows(matrix,1,new Set(dates)),preview=prepareOperatingFileRows(groups.get(dates[0])!,1,opts);
 assert.equal(preview.skippedSummaryRows,1);
 assert.equal(previewOperatingPaste(preview.text,opts).rows[0].values.verifiedAmount,12345);
 assert.throws(()=>prepareOperatingFileRows([...matrix,['误写日期','',90]],1,opts),/误写日期/);
});
test('grouped previews locate an invalid amount in the original preview row after skipping another date and a subtotal',()=>{
 const source=[['日期','门店','核销金额'],['2026-04-01','测试店',100],['第一周','合计',100],['2026-04-02','测试店','二十元']];
 const groups=groupSourceRows(source,0);
 const rowNumbers=new Map(source.map((row,i)=>[row,i+1]));
 assert.throws(()=>prepareOperatingFileRows(groups.get('2026-04-02')!,0,{sheet:'meituan',date:'2026-04-02',stores:[{id:'test',name:'测试店'}]},rowNumbers),error=>/第\s*4\s*行/.test(String(error))&&/测试店.*核销金额/.test(String(error))&&/2026-04-02/.test(String(error)));
});
test('repeat imports change only present values on matching stores, including explicit zero',()=>{
 const old={sheet:'meituan' as const,rows:[{storeId:'all',storeName:'全平台',values:{verifiedAmount:456,orderAmount:5000,leads:10}}]};
 const imported={columns:['verifiedAmount','orderAmount'],rows:[{storeId:'all',storeName:'全平台',values:{verifiedAmount:0,orderAmount:null}}]};
 const result=compareOperatingImport(old,imported);
 assert.deepEqual(result.rows[0].values,{verifiedAmount:0,orderAmount:5000,leads:10});
 assert.deepEqual(result.changes,['全平台 · 核销金额 4.56 → 0.00']);
 assert.equal(compareOperatingImport({...old,rows:result.rows},imported).changes.length,0);
 assert.throws(()=>compareOperatingImport(old,{...imported,rows:[{...imported.rows[0],storeId:'store1'}]}),/门店范围/);
});
test('receipt totals keep failed records distinct from untouched dates and pending corrections',async()=>{
 const results=await import('../lib/workbench/operating-reimport.ts');
 assert.equal(typeof results.operatingImportCounts,'function');
 const outcomes=['created','updated','reconciled','unchanged','review','skipped','errors','pending'] as const;
 const receipts=outcomes.map((outcome,i)=>({outcome,sheet:'meituan' as const,date:'2026-11-0'+(i+1),status:''}));
 assert.deepEqual(results.operatingImportCounts(receipts),{created:1,updated:1,reconciled:1,unchanged:1,review:1,skipped:1,errors:1,pending:1});
});
