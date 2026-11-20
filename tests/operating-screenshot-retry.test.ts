import test from 'node:test';
import assert from 'node:assert/strict';
import {readReviewedImage,readScreenshotReview,screenshotReviewKey,writeScreenshotReview,type ScreenshotReview} from '../lib/workbench/operating-screenshot-draft.ts';
import {isBrandedPlatformTotal} from '../lib/workbench/operating-file.ts';
import {checkRevenueOcrTotals,recalculateRevenueTotals} from '../lib/workbench/operating-revenue-ocr.ts';

test('same image and scope recover edits across a retry, other images and scopes do not',async()=>{
 const entries=new Map<string,string>();
 const storage:Storage={get length(){return entries.size;},getItem:k=>entries.get(k)??null,setItem:(k,v)=>{entries.set(k,v);},removeItem:k=>{entries.delete(k);},key:i=>[...entries.keys()][i]??null,clear:()=>entries.clear()};
 const key=(scope:string,v:number)=>screenshotReviewKey(scope,Uint8Array.of(v).buffer);
 const review:ScreenshotReview={header:0,rows:[['日期','金额'],['11月10日','4595.30']],metadata:{uncertain:[],lowConfidence:0,structured:true,inferredBorders:false,bounds:undefined},revenueMatrix:false};
 writeScreenshotReview(storage,await key('A',1),review,1000);
 assert.deepEqual(readScreenshotReview(storage,await key('A',1),2000),JSON.parse(JSON.stringify(review)));
 assert.equal(readScreenshotReview(storage,await key('A',2),2000),undefined);
 assert.equal(readScreenshotReview(storage,await key('B',1),2000),undefined);
 assert.equal(readScreenshotReview(storage,await key('A',1),1000+7*86400000),undefined);
});
test('existing reviews transfer to the identical decoded image without extending their retention',async()=>{
 const entries=new Map<string,string>();
 const storage:Storage={get length(){return entries.size;},getItem:k=>entries.get(k)??null,setItem:(k,v)=>{entries.set(k,v);},removeItem:k=>{entries.delete(k);},key:i=>[...entries.keys()][i]??null,clear:()=>entries.clear()};
 const review:ScreenshotReview={header:0,rows:[['日期','金额'],['11月10日','4595.30']],metadata:{uncertain:[],lowConfidence:0,structured:true,inferredBorders:false,bounds:undefined},revenueMatrix:false};
 const bytesKey=await screenshotReviewKey('project A',Uint8Array.of(1).buffer),pixelsKey='same pixels';
 writeScreenshotReview(storage,bytesKey,review,1000);
 const stored=JSON.parse(JSON.stringify(review));
 assert.deepEqual(readReviewedImage(storage,pixelsKey,bytesKey,2000),stored);
 assert.deepEqual(readReviewedImage(storage,pixelsKey,'different encoding',3000),stored);
 assert.equal(readReviewedImage(storage,'different pixels','different encoding',3500),undefined);
 assert.equal(readReviewedImage(storage,pixelsKey,'different encoding',1000+7*86400000),undefined);
});

test('corrected daily amounts can recompute displayed totals without changing targets or guessing blanks',()=>{
 const rows=[['日期','甲店','乙店','合计'],['月业绩指标','100','200','300'],['2026-11-17','5647','1.20','6.847'],['合计','5.647','1.20','6.847']];
 const next=recalculateRevenueTotals(rows,0);checkRevenueOcrTotals(next,0);
 assert.deepEqual(next[1],rows[1]);assert.deepEqual(next[2],['2026-11-17','5647','1.20','5648.20']);
 assert.deepEqual(next[3],['合计','5647.00','1.20','5648.20']);assert.equal(rows[2][3],'6.847');
 rows[2][1]='';assert.throws(()=>recalculateRevenueTotals(rows,0),/甲店/);
});
test('only explicit whole-platform scope routes a dated platform table to the single total row',()=>{
 const m=[['日期','范围','核销金额'],['2026-11-01','全平台','15']];
 assert.ok(isBrandedPlatformTotal(m,0,'meituan'));assert.equal(isBrandedPlatformTotal(m,0,'revenue'),false);
 assert.equal(isBrandedPlatformTotal([...m,['2026-11-02','甲店','7']],0,'meituan'),false);
 assert.equal(isBrandedPlatformTotal([['日期','范围','门店','核销金额'],['2026-11-01','全平台','甲店','15']],0,'meituan'),false);
});
