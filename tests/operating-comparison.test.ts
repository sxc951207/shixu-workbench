import test from'node:test';import assert from'node:assert/strict';
import type{OperatingRecord,OperatingTemplate}from'../cloud/company/operating-model.ts';
import {buildOperatingComparison,operatingComparisonPeriods} from '../lib/workbench/operating-comparison.ts';
const loaded=await import('../lib/workbench/operating-comparison.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
import{comparisonScope,comparisonRecord,comparisonDays}from'./fixtures/operating-comparison.ts';
function periods(cutoff:string):any{assert.equal(typeof(loaded as any).operatingComparisonPeriods,'function','numeric periods not implemented');return(loaded as any).operatingComparisonPeriods(cutoff);}
function compare(records:OperatingRecord[],cutoff='2026-11-02'):any{assert.equal(typeof(loaded as any).buildOperatingComparison,'function','numeric comparison not implemented');return(loaded as any).buildOperatingComparison(records,periods(cutoff),comparisonScope);}
const cell=(result:any,key='revenue',sheet='revenue',id='total')=>{const s=result.sheets.find((s:any)=>s.sheet===sheet);return(id==='total'?s.total:s.rows.find((r:any)=>r.id===id)).cells.find((c:any)=>c.key===key);};
const template:OperatingTemplate={id:'tpl_amount',name:'客资金额',description:'当日实际成交',dimension:'store',writer:'project-owner',active:true,fields:[{key:'revenue',label:'成交额',kind:'money',required:true,definition:'当日实际成交，元'},{key:'leads',label:'客资',kind:'count',required:true,definition:'当日去重'},{key:'spend',label:'花费',kind:'money',required:false}],metrics:[{key:'roi',label:'ROI',numerator:'revenue',denominator:'spend',format:'ratio'}]};
test('Douyin snapshot comparison uses shared spending for total ROI and preserves unallocated store spending',()=>{
 const sheet='douyin-stores';
 const snapshot=(date:string,verifiedAmount:number,sharedAdSpend:number)=>({
  ...comparisonRecord(date,0,{sheet,values:{verifiedAmount,adSpend:null}}),sharedAdSpend
 });
 const past=snapshot('2026-10-02',20000,5000),present=snapshot('2026-11-02',50000,10000);
 const result=compare([past,present]);
 const spend=cell(result,'adSpend',sheet),roi=cell(result,'metric:verifiedRoi',sheet);
 assert.deepEqual([spend.previous,spend.current,spend.difference],[5000,10000,5000]);
 assert.deepEqual([roi.previous,roi.current,roi.difference],[4,5,1]);
 for(const key of ['adSpend','metric:verifiedRoi'])assert.equal(cell(result,key,sheet,'s001').current,null);
 const zero=cell(compare([past,{...present,sharedAdSpend:0}]),'metric:verifiedRoi',sheet);
 assert.equal(zero.current,null);assert.match(zero.reasons.join(' '),/分母为0/);
 const allocated=comparisonRecord(present.date,0,{sheet,values:{verifiedAmount:50000,adSpend:10000}});
 const mixed=compare([past,allocated]);
 assert.equal(cell(mixed,'metric:verifiedRoi',sheet).difference,1);
 assert.equal(cell(mixed,'metric:verifiedRoi',sheet,'s001').previous,null);
 assert.equal(cell(mixed,'metric:verifiedRoi',sheet,'s001').current,5);
});
test('partial dates align same calendar day; full months compare full months',()=>{const a=periods('2026-11-14');assert.equal(a.previous.end,'2026-10-14');assert.equal(a.current.start,'2026-11-01');assert.equal(a.mode,'same-day');assert.equal(a.comparable,true);const b=periods('2026-11-30');assert.equal(b.previous.end,'2026-10-31');assert.equal(b.mode,'full-month');assert.equal(b.comparable,true);});
test('short prior month, leap date, year rollover and missing first baseline are explicit',()=>{const a=periods('2026-03-30');assert.equal(a.current.end,'2026-03-30');assert.equal(a.previous.end,'2026-02-28');assert.equal(a.comparable,false);assert.match(a.reason,/天数|同日/);assert.equal(periods('2024-03-31').previous.end,'2024-02-29');assert.equal(periods('2026-01-14').previous.end,'2025-12-14');assert.throws(()=>periods('1970-01-14'),/上期|前期/);});
test('confirmed integer amounts retain cents and return difference and relative change',()=>{const r=compare([...comparisonDays('2026-11',2,10001),...comparisonDays('2026-10',2,9999)]),c=cell(r);assert.equal(c.current,20002);assert.equal(c.previous,19998);assert.equal(c.difference,4);assert.equal(c.changeRatio,4/19998);assert.equal(c.currentComplete,true);assert.deepEqual(c.reasons,[]);});
test('missing days and nullable optional fields remain subtotals without fabricated change',()=>{const missing=cell(compare([...comparisonDays('2026-11',1),...comparisonDays('2026-10',2)]));assert.equal(missing.current,10000);assert.equal(missing.currentComplete,false);assert.equal(missing.difference,null);assert.match(missing.reasons.join(' '),/缺|不完整/);const opts={sheet:template.id,template,values:{revenue:10000,leads:2,spend:null}},r=compare([...comparisonDays('2026-11',2,0,opts),...comparisonDays('2026-10',2,0,{...opts,values:{revenue:5000,leads:1,spend:0}})]);assert.equal(cell(r,'spend',template.id).current,null);assert.equal(cell(r,'spend',template.id).difference,null);assert.equal(cell(r,'revenue',template.id).difference,10000);});
test('zero baseline allows a real difference but never invents an infinite growth percentage',()=>{const c=cell(compare([...comparisonDays('2026-11',2,100),...comparisonDays('2026-10',2,0)]));assert.equal(c.difference,200);assert.equal(c.changeRatio,null);assert.match(c.changeNote,/上期为0/);});
test('dimension IDs pair renamed stores; added stores block total growth but keep matching-store comparisons',()=>{const prior={rows:[{id:'s001',name:'旧名',values:{revenue:5000}}]},current={rows:[{id:'s001',name:'新名',values:{revenue:10000}},{id:'s002',name:'新门店',values:{revenue:2000}}]},r=compare([...comparisonDays('2026-11',2,0,current),...comparisonDays('2026-10',2,0,prior)]);assert.equal(cell(r).difference,null);assert.match(cell(r).reasons.join(' '),/范围/);assert.equal(cell(r,'revenue','revenue','s001').difference,10000);assert.equal(cell(r,'revenue','revenue','s002').previous,null);assert.equal(cell(r,'revenue','revenue','s002').difference,null);assert.equal(r.sheets[0].rows.find((r:any)=>r.id==='s001').previousName,'旧名');});
test('template definitions or hints changing across periods block numerical conclusions',()=>{for(const changed of[{...template,description:'按下单发生日'},{...template,fields:template.fields.map((f,i)=>i?f:{...f,definition:'金额包含税后调整'})}]){const r=compare([...comparisonDays('2026-11',2,10000,{sheet:template.id,template:changed}),...comparisonDays('2026-10',2,10000,{sheet:template.id,template})]);assert.equal(cell(r,'revenue',template.id).difference,null);assert.match(cell(r,'revenue',template.id).reasons.join(' '),/口径/);}});
test('ratios use summed numerators and denominators instead of averaging daily ratios',()=>{const make=(month:string,values:any[])=>values.map((v,i)=>comparisonRecord(month+'-0'+(i+1),0,{sheet:'meituan',values:v}));const r=compare([...make('2026-11',[{orderedCoupons:10,verifiedCoupons:2},{orderedCoupons:90,verifiedCoupons:90}]),...make('2026-10',[{orderedCoupons:50,verifiedCoupons:25},{orderedCoupons:50,verifiedCoupons:25}])]),c=cell(r,'metric:verificationRate','meituan');assert.equal(c.current,.92);assert.equal(c.previous,.5);assert.ok(Math.abs(c.difference-.42)<1e-12);});
test('mixed current daily and prior manual cumulative sources are explained and not compared',()=>{const current=comparisonDays('2026-11',2,0,{sheet:'meituan',values:{orderAmount:10000,verifiedAmount:8000}}),previous=comparisonRecord('2026-10-02',0,{sheet:'meituan-stores',values:{orderAmount:20000,verifiedAmount:15000}}),r=compare([...current,previous]);const c=cell(r,'verifiedAmount','meituan-stores');assert.equal(c.difference,null);assert.match(c.reasons.join(' '),/来源/);});
test('nonconfirmed rows, mixed projects, duplicate facts and overflow cannot silently enter comparison',()=>{const records=[...comparisonDays('2026-11',2),...comparisonDays('2026-10',2)];assert.throws(()=>compare([{...records[0],status:'draft'},...records.slice(1)]),/确认/);assert.throws(()=>compare([{...records[0],projectId:'p_'+'b'.repeat(24)},...records.slice(1)]),/项目|范围/);assert.throws(()=>compare([...records,records[0]]),/重复|冲突/);assert.throws(()=>compare([...comparisonDays('2026-11',2,Number.MAX_SAFE_INTEGER),...comparisonDays('2026-10',2)]),/安全|范围/);});
test('within-period hint changes and platform detailed-store changes cannot look like same-scope growth',()=>{
 const a=comparisonDays('2026-11',2,0,{sheet:template.id,template});a[1].template={...template,description:'按下单日'};const r=compare([...a,...comparisonDays('2026-10',2,0,{sheet:template.id,template})]);assert.equal(cell(r,'revenue',template.id).difference,null);assert.match(cell(r,'revenue',template.id).reasons.join(' '),/口径/);
 const old={sheet:'meituan',rows:[{id:'s001',name:'甲',values:{verifiedAmount:5000}}]},now={sheet:'meituan',rows:[{id:'s001',name:'甲',values:{verifiedAmount:10000}},{id:'s002',name:'乙',values:{verifiedAmount:2000}}]};assert.equal(cell(compare([...comparisonDays('2026-11',2,0,now),...comparisonDays('2026-10',2,0,old)]),'verifiedAmount','meituan').difference,null);
});
test('when a historical field changed type each side keeps its own display unit while comparison is blocked',()=>{const old={...template,fields:template.fields.map((f,i)=>i?f:{...f,kind:'count' as const})},r=compare([...comparisonDays('2026-11',2,100,{sheet:template.id,template}),...comparisonDays('2026-10',2,100,{sheet:template.id,template:old})]),c=cell(r,'revenue',template.id);assert.equal(c.previousFormat,'count');assert.equal(c.currentFormat,'moneyCents');assert.equal(c.difference,null);});
test('a template introduced after the selected cutoff cannot break valid earlier historical comparison',()=>{const r=compare([...comparisonDays('2026-11',2,10000),...comparisonDays('2026-10',2,5000),comparisonRecord('2026-11-10',100,{sheet:template.id,template})]);assert.equal(cell(r).difference,10000);assert.equal(r.sheets.some((s:any)=>s.sheet===template.id),false);});
test('undefined derived indicators identify a zero denominator without calling it missing data',()=>{const r=compare([...comparisonDays('2026-11',2,0,{sheet:'meituan'}),...comparisonDays('2026-10',2,0,{sheet:'meituan'})]),c=cell(r,'metric:verifiedRoi','meituan');assert.equal(c.difference,null);assert.match(c.reasons.join(' '),/分母为0/);});
test('period comparison retains retired fields and describes each confirmed definition by its proper name',()=>{
 const old:OperatingTemplate={...template,fields:[{key:'revenue',label:'下单金额',kind:'money',required:true,definition:'按下单时间统计'},{key:'retired',label:'退款订单数',kind:'count',required:false}],metrics:[]};
 const recent:OperatingTemplate={...template,fields:[{key:'revenue',label:'实收金额',kind:'money',required:true,definition:'按到账时间统计'},{key:'added',label:'新增咨询',kind:'count',required:false}],metrics:[]};
 const data=compare([
  comparisonRecord('2026-11-01',1234,{sheet:recent.id,template:recent,values:{added:3}}),
  comparisonRecord('2026-10-01',9999,{sheet:old.id,template:old,values:{retired:2}})
 ],'2026-11-01');
 const table=data.sheets[0],amount=table.columns.find((c:any)=>c.key==='revenue');
 assert.equal(amount.currentLabel,'实收金额');assert.equal(amount.previousLabel,'下单金额');
 assert.equal(amount.currentDefinition,'按到账时间统计');assert.equal(amount.previousDefinition,'按下单时间统计');
 const money=cell(data,'revenue',recent.id);assert.equal(money.previous,9999);assert.equal(money.current,1234);assert.equal(money.difference,null);
 const retired=cell(data,'retired',recent.id);assert.equal(retired.previous,2);assert.equal(retired.current,null);assert.match(retired.reasons.join(' '),/本期模板没有/);
 const added=cell(data,'added',recent.id);assert.equal(added.current,3);assert.equal(added.previous,null);assert.match(added.reasons.join(' '),/上期模板没有/);
});
test('template property order from storage cannot make an identical pair of measures incomparable',()=>{
 const copy={...template,fields:template.fields.map(f=>Object.fromEntries(Object.entries(f).reverse()))} as OperatingTemplate;
 const rows=[comparisonRecord('2026-11-01',100,{sheet:template.id,template}),comparisonRecord('2026-10-01',300,{sheet:copy.id,template:copy})];
 assert.equal(cell(compare(rows,'2026-11-01'),'revenue',template.id).difference,-200);
});
test('store rating is the confirmed cutoff observation even when another day omitted its optional rating',()=>{
 const rows=['2026-11-01','2026-11-02','2026-10-01','2026-10-02'].map((date,i)=>
  comparisonRecord(date,0,{sheet:'meituan',values:{stars:[null,4.8,null,4.3][i]}}));
 const c=cell(compare(rows),'stars','meituan-stores','s001');
 assert.equal(c.current,4.8);assert.equal(c.previous,4.3);assert.equal(c.currentComplete,true);assert.equal(c.previousComplete,true);assert.ok(Math.abs(c.difference-.5)<1e-10);
 const total=cell(compare(rows),'stars','meituan-stores');assert.equal(total.current,null);assert.equal(total.difference,null);
});
test('a zero partial denominator with missing fields is unknown, not a confirmed zero denominator',()=>{
 const rows=['2026-11-01','2026-11-02','2026-10-01','2026-10-02'].map((date,i)=>comparisonRecord(date,100,{sheet:template.id,template,values:{spend:[0,null,5,0][i]}}));
 const c=cell(compare(rows),'metric:roi',template.id);
 assert.equal(c.current,null);assert.equal(c.previous,40);assert.equal(c.difference,null);
 assert.match(c.reasons.join(' '),/本期.*(缺报|未齐)/);assert.doesNotMatch(c.reasons.join(' '),/本期分母为0/);
});
test('an inconsistent published version and a duplicate record identity cannot enter period comparison',()=>{
 const current=comparisonRecord('2026-11-01',100),prior=comparisonRecord('2026-10-01',100);
 assert.throws(()=>compare([{...current,publishedVersion:1},prior]),/确认|版本/);
 const {published,...snapshot}=current;void published;
 assert.throws(()=>compare([{...current,published:{...snapshot,rows:[{...snapshot.rows[0],values:{revenue:111}}]}},prior]),/确认|快照/);
 assert.throws(()=>compare([current,{...prior,id:current.id}]),/重复|冲突/);
});
test('weekly cross-year subtotals use Monday through the same weekday and integer cents before currency conversion',()=>{
 const dates=['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2025-12-22','2025-12-23','2025-12-24','2025-12-25'];
 const cents=[10001,20002,30003,40004,22500,22500,22500,22500];
 const windows=operatingComparisonPeriods('2026-01-01','week');
 const result=buildOperatingComparison(dates.map((date,i)=>comparisonRecord(date,cents[i])),windows,comparisonScope);
 const amount=cell(result);
 assert.deepEqual(windows.current,{start:'2025-12-29',end:'2026-01-01'});
 assert.deepEqual(windows.previous,{start:'2025-12-22',end:'2025-12-25'});
 assert.deepEqual([amount.previous,amount.current,amount.difference],[90000,100010,10010]);
 assert.equal(amount.changeRatio,10010/90000);
});
test('historical formulas with mixed units keep original fields but give a unit warning on the affected derived measure',()=>{
 const wrong:OperatingTemplate={...template,metrics:[{key:'badRate',label:'有问题的指标',numerator:'revenue',denominator:'leads',format:'percent'}]};
 const rows=['2026-11-01','2026-10-01'].map(date=>comparisonRecord(date,100,{sheet:wrong.id,template:wrong,values:{leads:1}}));
 const result=compare(rows,'2026-11-01'),bad=cell(result,'metric:badRate',wrong.id);
 assert.equal(cell(result,'revenue',wrong.id).current,100);assert.equal(bad.current,null);
 assert.match(bad.reasons.join(' '),/公式单位不匹配/);assert.doesNotMatch(bad.reasons.join(' '),/缺报|分母为0/);
});
test('additive snapshots keep unchanged columns comparable while new fields and formulas remain incomplete in older periods',()=>{
 const expanded:OperatingTemplate={...template,fields:[...template.fields,{key:'paid',label:'支付数',kind:'count',required:true}],
  metrics:[...template.metrics,{key:'unitPrice',label:'单位金额',numerator:'revenue',denominator:'leads',format:'money'}]};
 const rows=[comparisonRecord('2026-11-01',100,{sheet:template.id,template,values:{leads:1}}),comparisonRecord('2026-11-02',200,{sheet:template.id,template:expanded,values:{paid:5,leads:2}}),...comparisonDays('2026-10',2,100,{sheet:template.id,template,values:{leads:1}})];
 const result=compare(rows);
 assert.equal(cell(result,'revenue',template.id).difference,100);
 assert.equal(cell(result,'paid',template.id).current,5);
 assert.equal(cell(result,'paid',template.id).difference,null);
 assert.equal(cell(result,'metric:unitPrice',template.id).current,null);
});
