import test from 'node:test';
import assert from 'node:assert/strict';
import {screenshotChecks, screenshotLayoutProblem} from '../lib/workbench/operating-ocr-checks.ts';
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
