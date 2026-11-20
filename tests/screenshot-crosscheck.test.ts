import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrintedWeekTotal,uniquePrintedPair,describeScreenshot,reviewPriorities,screenshotChecks, screenshotLayoutProblem} from '../lib/workbench/operating-ocr-checks.ts';
import {detectOcrGrid} from '../lib/workbench/operating-ocr.ts';

test('explains unreadable layouts before displaying OCR text, while keeping unusual real headers',()=>{
 const diagnose=(labels:string[],low:number[],structured=true)=>screenshotLayoutProblem([labels],0,structured,low.map(c=>'0:'+c));
 assert.match(diagnose(['8 ¢ » @'],[0],false),/未找到清晰网格/);
 assert.match(diagnose(['am','周','','we','ESR'],[0,3,4]),/第 1 行.*表头/);
 assert.match(diagnose(['','核销金额','','','','','',''],[]),/第 1 行.*表头/);
 assert.equal(diagnose(['业务日期','推广消耗','ROI','GMV'],[2,3]),'');
 assert.equal(diagnose(['Date','Revenue','ROI'],[]),'');
 assert.equal(diagnose(['指标','2026-11-05','2026-11-06'],[]),'');
});

test('localizes missing daily values against printed subtotals without filling them; does not sum rates',()=>{
 const rows=[['业务日期','核销券数','退款金额','完成率'],['月度','374','20.30','99'],['11月9日','','10','54'],['11月10日','327','10','55'],['第3周','374','20','98']];
 const a=screenshotChecks(rows,0,'2026-11-15');
 assert.ok(a.warnings.some(s=>s.includes('第3周')&&s.includes('11月9日')&&s.includes('相差 47')));
 assert.ok(a.warnings.some(s=>s.includes('退款金额')&&s.includes('相差 0.3')));
 assert.equal(rows[2][1],'');assert.ok(!a.warnings.some(s=>s.includes('完成率')));
 rows[2][1]='0';assert.ok(!screenshotChecks(rows,0).warnings.some(s=>s.includes('缺 ')));
 rows[2][0]='118108';assert.equal(screenshotChecks(rows,0).errors.length,1);
});

test('recognizes an open final row only when the column rules visibly continue',()=>{
 const w=200,h=101;
 for(const extend of [false,true]){
  const pixels=new Uint8ClampedArray(w*h*4).fill(255);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if([0,20,40,60,80].includes(y)||((extend||y<=80)&&[0,40,80,120,160,199].includes(x))){
   const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;
  }
  assert.equal(detectOcrGrid({width:w,height:h,data:pixels}).y.at(-1),extend?100:80);
 }
});

test('ordinary grand total locates a column, independent cell evidence locates a candidate only',()=>{
 const rows=[['业务日期','成交金额'],['11月3日','288.60'],['11月5日','135'],['11月9日','144.63'],['合计','620.03']];
 const verify=(risk:string[]=[])=>screenshotChecks(rows,0,'2026-11-17',risk);
 assert.match(verify().warnings[0],/相差 51.8/);
 assert.deepEqual(verify().totals,[{row:4,column:1}]);
 assert.deepEqual(verify().suspects,[]);
 assert.deepEqual(verify(['2:1']).suspects,[{row:2,column:1}]);
 rows.pop();assert.equal(verify().warnings.length,0);
 assert.deepEqual(verify(['2:1']).suspects,[{row:2,column:1}]);
 rows[2][1]='I=';assert.deepEqual(verify().suspects,[{row:2,column:1}]);
});

test('a weak plausible amount in the discrepant week precedes unrelated weak amounts and headings',async()=>{
 const {reviewPriorities}=await import('../lib/workbench/operating-ocr-checks.ts');
 const rows=[['日期','星期','成交金额'],['11月1日','日','100'],['第1周','合计','100'],['11月2日','一','135'],['第2周','合计','186.80']];
 const weak=['0:1','1:1','1:2','2:0','3:2','4:0'];
 const result=reviewPriorities(rows,0,weak,screenshotChecks(rows,0,'2026-11-17',weak));
 assert.deepEqual(result.map(p=>[p.row,p.column]),[[3,2],[4,2],[1,2]]);
 assert.match(result[0].reason,/差额/);
});

test('prioritizes printed currency precision by business date, without treating ROI as currency',async()=>{
 const {reviewPriorities}=await import('../lib/workbench/operating-ocr-checks.ts');
 const rows=[['日期','甲店','乙店','合计'],['11月1日','5.647','2.30','7.947']];
 const checks=screenshotChecks(rows,0,'2026-11-01',[],true);
 assert.deepEqual(reviewPriorities(rows,0,[],checks).slice(0,1).map(c=>[c.row,c.column]),[[1,1]]);
 const ratios=[['日期','ROI'],['11月1日','5.647']];
 assert.equal(reviewPriorities(ratios,0,[],screenshotChecks(ratios,0)).length,0);
});
test('uses cents mismatch plus a unique precision outlier as a clue, never as a correction',async()=>{
 const {reviewPriorities}=await import('../lib/workbench/operating-ocr-checks.ts');
 const rows=[['日期','退款金额'],['11月1日','10.00'],['11月2日','20.30'],['11月3日','16'],['11月4日','10.20'],['第1周','56.80']];
 const priorities=()=>reviewPriorities(rows,0,[],screenshotChecks(rows,0,'2026-11-01'));
 assert.equal(priorities()[0]?.row,3);assert.match(priorities()[0].reason,/0.30/);assert.equal(rows[3][1],'16');
 rows[5][1]='56.50';assert.equal(priorities().length,0);
});
test('identifies Meituan export money columns and review unit within the platform scope',async()=>{
 const {operatingFields}=await import('../lib/workbench/operating-data.ts');
 const {platformImportField}=await import('../lib/workbench/operating-paste.ts');
 for(const sheet of ['meituan','meituan-stores'] as const){
  const keys=['下单售价金额(元)','商家优惠后核销额(元)','新增好评数(条)'].map(h=>platformImportField(h,sheet,operatingFields(sheet))?.key);
  assert.deepEqual(keys,['orderAmount','verifiedAmount','positiveReviews']);
 }
 assert.equal(platformImportField('下单售价金额(元)','revenue',operatingFields('revenue')),undefined);
});

test('rejects compressed headings with repeated grid strokes mixed into words',()=>{
 const broken=['','','TORE |','BARR |','WEAR','| FOAM','ARRAS','RuSR','| Rem','|','门店访问','/门店访问','','i','','推广清二','。 核俩ROI','FARO'];
 assert.match(screenshotLayoutProblem([broken],0,true,[]),/表头.*原图/);
 assert.equal(screenshotLayoutProblem([['Store','Order amount','Clicks','CPC','ROI','Exposure']],0,true,[]),'');
});

test('an unreadable date with daily figures must stay visible and block import',()=>{
 const rows=[['日期','星期','下单金额','退款金额'],['11月8日','日','200','0'],['','星期一','100','0'],['11月39日','星期二','130','10'],['月目标','','12000','0']];
 const checks=screenshotChecks(rows,0,'2026-11-18');
 assert.equal(checks.errors.length,2);
 assert.deepEqual(reviewPriorities(rows,0,[],checks).filter(c=>c.column===0).map(c=>c.row),[2,3]);
});

test('explains the evidence for known and unfamiliar screenshots without guessing a channel',()=>{
 const info=(rows:string[][],structured=true,uncertain:string[]=[])=>describeScreenshot(rows,0,structured,uncertain);
 assert.match(info([['日期','客户名称','跟进阶段']]).type,/按日期/);
 assert.match(info([['门店','销售额','数量']]).type,/按门店/);
 assert.match(info([['抖音平台数据 日期 核销金额']],false).type,/抖音/);
 assert.match(info([['登录']],false).type,/无法判断/);
 assert.ok(!info([['日期','核销金额','曝光数']]).type.includes('美团'));
 assert.deepEqual(info([['日期','金额','未知',''] ],true,['0:2']).headers,['日期','金额']);
});

test('suggests a unique damaged field for human confirmation and checks weekly lead counts',()=>{
 const rows=[['日期','下单金额','私信留资人数','核销金客(元)'],['11月1日','10','13','3'],['第1周','10','19','3']];
 const checks=screenshotChecks(rows,0,'2026-11-18',['1:2']);
 const options=['下单金额','私信留资人数','核销金额'];
 const cells=reviewPriorities(rows,0,['1:2'],checks,false,options);
 assert.equal(cells[0].suggested,'核销金额');
 assert.equal(rows[0][3],'核销金客(元)');
 assert.ok(cells.some(c=>c.row===1&&c.column===2&&c.reason.includes('差额')));
 assert.ok(checks.warnings[0].includes('相差 6'));
});

test('a loose screenshot can explain legible labels without assigning numbers to them',()=>{
 const info=describeScreenshot([['经营数据'],['日期 核销金额'],['退款金额 3,718.00']],0,false,[]);
 assert.deepEqual(new Set(info.anchors),new Set(['日期','核销金额','退款金额']));
 const board=[['美团 当日概览'],['下单金额 ¥81.18 核销金额'],['退款金额 推广消耗']];
 assert.match(describeScreenshot(board,0,false,['0:0','1:0','2:0']).type,/美团经营看板/);
 assert.match(info.type,/行列待确认/);
 assert.match(screenshotLayoutProblem([['123','87.05']],0,true,[]),/全是数字/);
});

test('requires two observed readings and a unique pair when checking a printed subtotal',()=>{
 assert.deepEqual(uniquePrintedPair(['2','1','5'],[['17'],['12'],[]],'34',0)?.map(({v})=>v),['17','12']);
 assert.equal(uniquePrintedPair(['2','1','5'],[['17','18'],['12','11'],[]],'34',0),undefined);
 assert.equal(uniquePrintedPair(['','',''],[['17'],['12'],[]],'29',0),undefined);
 assert.equal(uniquePrintedPair(['2','1'],[['3.5'],['4.5']],'8',0),undefined);
 for(const name of ['第2周','第 三 周 合计'])assert.ok(isPrintedWeekTotal(name));
 assert.equal(isPrintedWeekTotal('第2周备注'),false);
});
test('a damaged numeric column in a recognizable table is surfaced even without a close name',()=>{
 const rows=[['日期','预约数','线索数','复诉!'],['11月1日','2','7','0']];
 const priorities=reviewPriorities(rows,0,[],screenshotChecks(rows,0,'2026-11-18'),false,['预约数','线索数','到店数']);
 assert.ok(priorities.some(x=>x.row===0&&x.column===3&&x.reason.includes('尚未匹配')&&!x.suggested));
});
