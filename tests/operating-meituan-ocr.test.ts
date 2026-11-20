import test from 'node:test';
import assert from 'node:assert/strict';
import {meituanDailyColumns,meituanDailyReview,meituanDailyPreview,checkPrintedWeekday,meituanDayCandidate} from '../lib/workbench/operating-meituan-ocr.ts';
const day=['11/1/2026','HE','321045','219036','18','24','75.0%','123.50','3','12.5%','420','870','1290','7','4','119.30','18.36','26.91'];
test('only one exact date in an 18-column daily platform grid can be reviewed; lost decimal points remain blank',()=>{
 const result=meituanDayCandidate([['月度',...day.slice(1)],day,['第1周',...day.slice(1)]],'2026-11-01');
 assert.ok(result);assert.deepEqual(result.values,['','','18','24','123.50','3','420','870','7','4','119.30']);
 assert.equal(meituanDayCandidate([day,day],'2026-11-01'),null);
 assert.equal(meituanDayCandidate([day],'2026-11-02'),null);
 assert.equal(meituanDayCandidate([day.slice(1)],'2026-11-01'),null);
});
test('different digits across the whole table and individual crop cannot silently enter the daily financial form',async()=>{
 const {verifiedMeituanCell}=await import('../lib/workbench/operating-meituan-ocr.ts');
 assert.equal(verifiedMeituanCell('123.50','923.50',true),'');
 assert.equal(verifiedMeituanCell('321045','3210.45',true),'3210.45');
 assert.equal(verifiedMeituanCell('321045','321045',true),'');
});

test('a partially covered month needs a printed weekday and both adjacent dates',()=>{
 assert.equal(checkPrintedWeekday('2026-01-06','星期五','2026-11-05','2026-11-07'),'2026-11-06');
 assert.equal(checkPrintedWeekday('2026-01-06','星期二','2026-11-05','2026-11-07'),'2026-01-06');
 assert.match(checkPrintedWeekday('2026-01-06','星期五','','2026-11-07'),/请核对/);
 assert.match(checkPrintedWeekday('2026-01-08','星期五','2026-11-05','2026-11-07'),/请核对/);
 assert.equal(checkPrintedWeekday('第3周','星期五','2026-11-05','2026-11-07'),'第3周');
});

test('daily screenshot maps by heading, drops labeled subtotals, and refuses ambiguous rows or duplicate headings',()=>{
 const head=Array<string>(18).fill('');head[0]='日期';
 for(const field of meituanDailyColumns)head[field.index]=field.label;
 [head[2],head[3]]=[head[3],head[2]];
 const data=[...day];data[0]='2026-11-01';data[2]='2190.36';data[3]='3210.45';
 const preview=meituanDailyPreview([head,['月度'],data,['第1周']],0);
 assert.deepEqual(preview?.[1].slice(0,4),['2026-11-01','全平台','3210.45','2190.36']);
 assert.equal(preview?.length,2);
 const review=meituanDailyReview([head,['月度'],data,['第1周']],0,['2:3','1:3','2:12']);
 assert.deepEqual(review?.sourceRows,[0,2]);assert.deepEqual(review?.sourceColumns.slice(0,4),[0,-1,3,2]);
 assert.ok(review?.uncertain.includes('1:2'));assert.ok(!review?.uncertain.includes('1:3'));
 assert.equal(meituanDailyPreview([head,data,data],0),null);
 assert.equal(meituanDailyPreview([head,data,['日期不清']],0),null);
 const duplicate=[...head];duplicate[1]=head[2];assert.equal(meituanDailyPreview([duplicate,data],0),null);
});
