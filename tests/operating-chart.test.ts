import test from 'node:test';
import assert from 'node:assert/strict';
import type {OperatingRecord,OperatingRow,OperatingSheet,OperatingSnapshot,OperatingTemplate} from '../cloud/company/operating-model.ts';
import {operatingFields,operatingTemplatePresets} from '../lib/workbench/operating-data.ts';
import {buildOperatingChart,operatingChartDetail,operatingChartOptions,operatingChartPointText} from '../lib/workbench/operating-chart.ts';

let serial=0;
function record(date:string,values:Record<string,number|null>={revenue:10000},sheet:OperatingSheet='revenue',rows?:OperatingRow[],template?:OperatingTemplate):OperatingRecord{
 const fields=operatingFields(sheet,template),stamp=date+'T08:00:00Z';
 return {id:'op_'+String(++serial).padStart(32,'0'),companyId:'co_123456abcdef',projectId:'p_'+'a'.repeat(24),projectName:'合成图形测试',sheet,date,status:'approved',version:2,publishedVersion:2,writerLogin:'manager',reviewerLogin:'owner',submittedBy:'manager',submittedName:'合成主管',submittedAt:stamp,reviewerName:'合成管理员',comment:'',createdAt:stamp,updatedAt:stamp,published:null,...(template?{template}:{}),rows:rows||[{storeId:template?.dimension==='total'?'all':'s001',storeName:template?.dimension==='total'?'合成全项目':'合成甲店',values:Object.fromEntries(fields.map(f=>[f.key,values[f.key]??(f.required?0:null)]))}]};
}
const row=(id:string,values:Record<string,number|null>):OperatingRow=>({storeId:id,storeName:'合成'+id,values});
function correction(approved:OperatingRecord):OperatingRecord{
 const {published,...snapshot}=approved;
 return {...approved,status:'draft',version:3,publishedVersion:2,published:structuredClone(snapshot),rows:[row('s001',{revenue:9999900})]};
}
const build=(records:OperatingRecord[],cutoff='2026-11-03',options:Record<string,unknown>={})=>buildOperatingChart(records,{cutoff,sheet:'revenue',metric:'revenue',...options} as Parameters<typeof buildOperatingChart>[1]);

test('appended indicators keep existing trends and start their own series with the first applicable snapshot',()=>{
 const t=operatingTemplatePresets()[1],extended:OperatingTemplate={...t,fields:[...t.fields,{key:'newCount',label:'新增数量',required:true,kind:'count'}],metrics:[...t.metrics,{key:'newRate',label:'新增率',numerator:'clicks',denominator:'impressions',format:'percent'}]};
 const rows=[record('2026-11-01',{clicks:3,impressions:6},'tpl_ads',undefined,t),record('2026-11-02',{clicks:4,impressions:8,newCount:2},'tpl_ads',undefined,extended)];
 assert.ok(operatingChartOptions(rows,'2026-11-02')[0].metrics.some(m=>m.key==='newCount'));
 for(const [key,expected] of [['clicks',[3,4]],['newCount',[null,2]],['metric:newRate',[null,50]]] as const){
  assert.deepEqual(build(rows,'2026-11-02',{sheet:'tpl_ads',metric:key}).points.map(p=>p.value),expected);
 }
});

test('drafts without confirmation never become chart observations',()=>{
 const draft={...record('2026-11-01'),status:'draft' as const,publishedVersion:0};
 assert.deepEqual(build([draft]).points.map(p=>p.value),[null,null,null]);
 assert.equal(operatingChartOptions([draft],'2026-11-03').length,0);
});
test('pending corrections retain old confirmed values and never use draft rows',()=>{
 const approved=record('2026-11-01',{revenue:12345});
 assert.deepEqual(build([correction(approved)]).points.map(p=>p.value),[123.45,null,null]);
 assert.ok(build([correction(approved)]).notes.some(n=>n.includes('更正')));
});
test('published snapshot identity must agree with its parent in every scope key',()=>{
 const pending=correction(record('2026-11-01'));
 for(const patch of [{id:'op_'+'a'.repeat(32)},{companyId:'co_abcdef123456'},{projectId:'p_'+'b'.repeat(24)},{date:'2026-11-02'},{sheet:'targets'}]){
  assert.throws(()=>build([{...pending,published:{...pending.published!,...patch} as OperatingSnapshot}]),/身份|范围|快照/);
 }
});
test('unapproved and inconsistent published versions cannot enter a chart',()=>{
 const pending=correction(record('2026-11-01'));
 for(const patch of [{status:'draft'},{version:1},{publishedVersion:1}])assert.throws(()=>build([{...pending,published:{...pending.published!,...patch} as OperatingSnapshot}]),/确认|版本|快照/);
 assert.throws(()=>build([{...pending,published:null}]),/快照/);
});
test('genuine zero stays zero while missing dates and missing fields stay null',()=>{
 const blank=record('2026-11-03');blank.rows[0].values.revenue=null;
 assert.deepEqual(build([record('2026-11-01',{revenue:0}),blank]).points.map(p=>p.value),[0,null,null]);
});
test('a meeting trend counts confirmed usable metric days and drills only into the approved version',()=>{
 const approved=record('2026-11-01',{revenue:0}),blank=record('2026-11-02');
 blank.rows[0].values.revenue=null;
 const records=[correction(approved),blank],trend=build(records);
 assert.equal(trend.reported,2);
 assert.equal(trend.validDays,1);
 const day=operatingChartDetail(records,trend,approved.date);
 assert.equal(day.points[0].rawCents,'0');
 const stores=build(records,'2026-11-03',{purpose:'stores'});
 const store=operatingChartDetail(records,stores,'s001');
 assert.deepEqual(store.points.map(p=>p.value),[0,null,null]);
 assert.match(store.points[1].reason,/未提供/);
 assert.match(store.points[2].reason,/无已确认记录/);
});
test('snapshot store detail shows just the cutoff snapshot, without inventing daily metric coverage',()=>{
 const earlier=record('2026-11-01',{adSpend:100},'meituan-stores'),current=record('2026-11-03',{adSpend:400},'meituan-stores');
 const chart=build([earlier,current],current.date,{sheet:'meituan-stores',metric:'adSpend',purpose:'stores'});
 assert.equal(chart.validDays,null);
 assert.deepEqual(operatingChartDetail([earlier,current],chart,'s001').points.map(p=>[p.id,p.rawCents]),[[current.date,'400']]);
});
test('money is summed in cents before conversion to yuan',()=>{
 const value=record('2026-11-01',{},'revenue',[row('s001',{revenue:101}),row('s002',{revenue:202})]);
 const chart=build([value],'2026-11-01');assert.equal(chart.points[0]?.value,3.03);assert.equal(chart.metric?.unit,'元');
});
test('time trends recommend line and allow manual bar without inventing points',()=>{
 const records=[record('2026-11-01')];assert.equal(build(records).recommended,'line');assert.equal(build(records).kind,'line');
 assert.equal(build(records,'2026-11-03',{kind:'bar'}).kind,'bar');
});
test('store comparison recommends bars and prevents false ordered line connections',()=>{
 const records=[record('2026-11-01',{},'revenue',[row('s001',{revenue:100}),row('s002',{revenue:200})])];
 const chart=build(records,'2026-11-01',{purpose:'stores',kind:'line'});
 assert.equal(chart.recommended,'bar');assert.equal(chart.kind,'bar');assert.deepEqual(chart.points.map(p=>p.value),[1,2]);assert.ok(chart.notes.some(n=>n.includes('顺序')));
});
test('ratios use summed numerators and denominators rather than averaging row rates',()=>{
 const values=[row('s001',{orderedCoupons:10,verifiedCoupons:5,orderAmount:10000,verifiedAmount:5000,refundOrders:0,refundAmount:0,adSpend:1000}),row('s002',{orderedCoupons:90,verifiedCoupons:9,orderAmount:90000,verifiedAmount:9000,refundOrders:0,refundAmount:0,adSpend:9000})];
 const chart=build([record('2026-11-01',{},'meituan',values)],'2026-11-01',{sheet:'meituan',metric:'metric:verificationRate'});
 assert.ok(Math.abs((chart.points[0]?.value??Infinity)-14)<0.000001);assert.equal(chart.metric?.unit,'%');
 const roi=build([record('2026-11-01',{},'meituan',values)],'2026-11-01',{sheet:'meituan',metric:'metric:verifiedRoi'});assert.equal(roi.points[0]?.value,1.4);
});
test('zero denominators and incomplete dependencies produce gaps rather than numeric rates',()=>{
 const first=record('2026-11-01',{orderedCoupons:0,verifiedCoupons:0},'meituan');
 const second=record('2026-11-02',{orderedCoupons:10,verifiedCoupons:5},'meituan');second.rows[0].values.verifiedCoupons=null;
 const chart=build([first,second],'2026-11-02',{sheet:'meituan',metric:'metric:verificationRate'});assert.deepEqual(chart.points.map(p=>p.value),[null,null]);
});
test('template cost metrics use yuan while counts and ratios retain their own units',()=>{
 const template=operatingTemplatePresets()[1],r=record('2026-11-01',{spend:10000,leads:4},'tpl_ads',undefined,template);
 assert.equal(build([r],'2026-11-01',{sheet:'tpl_ads',metric:'metric:cpl'}).points[0]?.value,25);
 assert.equal(build([r],'2026-11-01',{sheet:'tpl_ads',metric:'leads'}).metric?.unit,'个');
});
test('stars are never offered as an additive overall metric',()=>{
 const options=operatingChartOptions([record('2026-11-01',{},'meituan')],'2026-11-01');
 assert.ok(!options[0].metrics.some(m=>m.key==='stars'));
 assert.throws(()=>build([record('2026-11-01',{},'meituan')],'2026-11-01',{sheet:'meituan',metric:'stars'}),/指标/);
});
test('targets and manual month to date store snapshots are not daily observations',()=>{
 const target=record('2026-11-01',{target:10000},'targets');assert.equal(operatingChartOptions([target],'2026-11-03').length,0);
 const manual=record('2026-11-03',{adSpend:30000},'meituan-stores');
 const trend=build([manual],'2026-11-03',{sheet:'meituan-stores',metric:'adSpend',purpose:'time'});assert.equal(trend.points.length,0);assert.ok(trend.notes.some(n=>n.includes('累计快照')));
 const stores=build([manual],'2026-11-03',{sheet:'meituan-stores',metric:'adSpend',purpose:'stores'});assert.equal(stores.points[0]?.value,300);assert.equal(stores.source,'snapshot');
});
test('historical template type or definition changes block mixed charts',()=>{
 const t=operatingTemplatePresets()[1],a=record('2026-11-01',{},'tpl_ads',undefined,t);
 for(const patch of [{fields:t.fields.map(f=>f.key==='leads'?{...f,kind:'money' as const}:f)},{description:'已改变归属口径'},{metrics:t.metrics.map(m=>m.key==='cpl'?{...m,denominator:'orders'}:m)}]){
  const changed={...t,...patch},b=record('2026-11-02',{},'tpl_ads',undefined,changed);
  assert.throws(()=>build([a,b],'2026-11-02',{sheet:'tpl_ads',metric:'leads'}),/口径|单位|定义/);
 }
});
test('pending custom edits keep the original confirmed template despite current config',()=>{
 const t=operatingTemplatePresets()[1],approved=record('2026-11-01',{spend:12345},'tpl_ads',undefined,t),pending=correction(approved),changed={...t,fields:t.fields.map(f=>f.key==='spend'?{...f,kind:'count' as const}:f)};
 pending.template=changed;
 const chart=buildOperatingChart([pending],{cutoff:'2026-11-01',sheet:'tpl_ads',metric:'spend'},[changed]);assert.equal(chart.points[0]?.value,123.45);assert.equal(chart.metric?.unit,'元');assert.ok(chart.notes.some(n=>n.includes('原确认')));
});
test('known revenue ads and leads fields receive useful defaults but arbitrary templates require a choice',()=>{
 const ads=operatingTemplatePresets()[1],leads=operatingTemplatePresets()[0],custom={...ads,id:'tpl_custom',name:'自定义多口径'};
 const options=operatingChartOptions([record('2026-11-01'),record('2026-11-01',{},'tpl_ads',undefined,ads),record('2026-11-01',{},'tpl_leads',undefined,leads),record('2026-11-01',{},'tpl_custom',undefined,custom)],'2026-11-01');
 assert.equal(options.find(o=>o.sheet==='revenue')?.defaultMetric,'revenue');assert.equal(options.find(o=>o.sheet==='tpl_ads')?.defaultMetric,'spend');assert.equal(options.find(o=>o.sheet==='tpl_leads')?.defaultMetric,'leads');assert.equal(options.find(o=>o.sheet==='tpl_custom')?.defaultMetric,null);
 assert.equal(buildOperatingChart([record('2026-11-01',{},'tpl_custom',undefined,custom)],{cutoff:'2026-11-01',sheet:'tpl_custom'}).metric,null);
});
test('mixed company scopes and duplicate facts stop chart creation',()=>{
 const a=record('2026-11-01');assert.throws(()=>build([a,{...record('2026-11-02'),projectId:'p_'+'b'.repeat(24)}]),/范围|项目/);
 assert.throws(()=>build([a,a]),/重复|冲突/);
});
test('missing stores create gaps and incomplete month ranges never become complete store totals',()=>{
 const a=record('2026-11-01',{},'revenue',[row('s001',{revenue:100}),row('s002',{revenue:200})]),b=record('2026-11-02',{},'revenue',[row('s001',{revenue:300})]);
 assert.deepEqual(build([a,b],'2026-11-02').points.map(p=>p.value),[3,null]);
 assert.deepEqual(build([a],'2026-11-02',{purpose:'stores'}).points.map(p=>p.value),[null,null]);
});
test('date drill preserves the trend gap and names the absent store alongside a confirmed zero',()=>{
 const a=record('2026-11-01',{},'revenue',[row('s001',{revenue:0})]);
 const b=record('2026-11-02',{},'revenue',[row('s001',{revenue:100}),row('s002',{revenue:200})]);
 const chart=build([a,b],b.date),detail=operatingChartDetail([a,b],chart,a.date);
 assert.equal(chart.points[0].value,null);
 assert.match(chart.points[0].reason,/范围不完整/);
 assert.match(chart.points[0].reason,/合成s002/);
 assert.equal(detail.reason,chart.points[0].reason);
 assert.deepEqual(detail.points.map(p=>[p.id,p.label,p.value]),[['s001','合成s001',0],['s002','合成s002',null]]);
 assert.match(detail.points[1].reason,/无.*已确认明细/);
 assert.equal(operatingChartDetail([a,b],chart,b.date).reason,'');
});
test('store ratios are weighted across dates and only complete dates can form a total',()=>{
 const template={...operatingTemplatePresets()[1],dimension:'store' as const},a=record('2026-11-01',{spend:10000,leads:1},'tpl_ads',undefined,template),b=record('2026-11-02',{spend:30000,leads:9},'tpl_ads',undefined,template);
 const chart=build([a,b],'2026-11-02',{sheet:'tpl_ads',metric:'metric:cpl',purpose:'stores'});assert.equal(chart.points[0]?.value,40);
});
test('total-only trend reports the full-period weighted rate and keeps an undefined daily rate empty',()=>{
 const records=[[1,2],[0,0],[0,4]].map(([verifiedCoupons,orderedCoupons],index)=>{
  const r=record('2026-11-0'+(index+1),{verifiedCoupons,orderedCoupons},'meituan');
  r.rows[0]={...r.rows[0],storeId:'all',storeName:'全平台'};return r;
 });
 const options={sheet:'meituan',metric:'metric:verificationRate'};
 const chart=build(records,'2026-11-03',options);
 assert.deepEqual(chart.points.map(point=>point.value),[50,null,0]);
 assert.equal(operatingChartPointText(chart.periodRatio!,chart.metric!),'16.67%');
 const missingDay=build(records.slice(1),'2026-11-03',options);
 assert.equal(missingDay.periodRatio?.value,null);
 const noDenominator=structuredClone(records);noDenominator.forEach(r=>{r.rows[0].values.orderedCoupons=0;});
 assert.match(build(noDenominator,'2026-11-03',options).periodRatio?.reason??'',/分母.*0/);
 const unknown=structuredClone(records);unknown[1].rows[0].values.verifiedCoupons=null;
 assert.equal(build(unknown,'2026-11-03',options).periodRatio?.value,null);
 const changedScope=structuredClone(records);changedScope[1].rows[0]={...changedScope[1].rows[0],storeId:'s001',storeName:'甲店'};
 assert.equal(build(changedScope,'2026-11-03',options).periodRatio?.value,null);
});

test('raw money points retain exact cent text alongside the numeric plotting value near the safe integer limit',()=>{
 const chart=build([record('2026-11-01',{revenue:Number.MAX_SAFE_INTEGER})],'2026-11-02');
 assert.equal(chart.points[0]?.value,90071992547409.9);
 assert.equal(chart.points[0]?.rawCents,'9007199254740991');
 assert.equal(chart.points[1]?.value,null);assert.equal(chart.points[1]?.rawCents,undefined);
});
test('store money totals retain exact cents after summing daily amounts before graph conversion',()=>{
 const chart=build([record('2026-11-01',{revenue:9007199254740000}),record('2026-11-02',{revenue:991})],'2026-11-02',{purpose:'stores'});
 assert.equal(chart.points[0]?.value,90071992547409.9);assert.equal(chart.points[0]?.rawCents,'9007199254740991');
});


test('an ID cannot represent two different confirmed business facts',()=>{
 const first=record('2026-11-01'),second=record('2026-11-02');
 assert.throws(()=>build([first,{...second,id:first.id}]),/重复|冲突/);
});

test('missing inputs and a known zero denominator have different explanations alongside the graph',()=>{
 const missing=record('2026-11-02',{orderedCoupons:10,verifiedCoupons:5},'meituan');
 missing.rows[0].values.verifiedCoupons=null;
 const chart=build([record('2026-11-01',{orderedCoupons:0,verifiedCoupons:0},'meituan'),missing],'2026-11-03',{sheet:'meituan',metric:'metric:verificationRate'});
 const [zero,unknown,absent]=chart.points;
 assert.equal(zero.value,null);assert.match(zero.reason,/分母.*0/);assert.doesNotMatch(zero.reason,/缺报/);
 assert.equal(unknown.value,null);assert.match(unknown.reason,/核销券数.*未提供/);assert.doesNotMatch(unknown.reason,/分母为0/);
 assert.match(absent.reason,/无已确认记录/);
});

test('a selected metric only aggregates its own source fields',()=>{
 const template={...operatingTemplatePresets()[1],dimension:'store' as const},sheet='tpl_ads';
 const r=record('2026-11-01',{orderAmount:Number.MAX_SAFE_INTEGER,leads:5},sheet,undefined,template);
 r.rows.push({...r.rows[0],storeId:'s002',storeName:'另一家店',values:{...r.rows[0].values,orderAmount:1,leads:8}});
 const leads=build([r],r.date,{sheet,metric:'leads'});
 assert.equal(leads.points[0].value,13);
 assert.throws(()=>build([r],r.date,{sheet,metric:'orderAmount'}),/安全|范围/);
});

test('the graph detail shows 23 verified of 160 ordered as 14.38 percent',()=>{
 const r=record('2026-11-01',{verifiedCoupons:23,orderedCoupons:160},'meituan');
 const chart=build([r],r.date,{sheet:'meituan',metric:'metric:verificationRate'});
 assert.equal(operatingChartPointText(chart.points[0],chart.metric!),'14.38%');
});
test('a historical formula with incompatible units explains its gap while raw fields stay available',()=>{
 const preset=operatingTemplatePresets()[1];
 const template={...preset,fields:preset.fields.map(f=>f.key==='leads'?{...f,kind:'money' as const}:f)};
 const r=record('2026-11-01',{spend:10000,leads:400},'tpl_ads',undefined,template);
 const chart=build([r],r.date,{sheet:'tpl_ads',metric:'metric:cpl'});
 assert.equal(chart.points[0].value,null);
 assert.match(chart.points[0].reason,/公式单位不匹配/);
 assert.ok(chart.notes.includes(chart.points[0].reason));
 assert.equal(build([r],r.date,{sheet:'tpl_ads',metric:'spend'}).points[0].value,100);
});
