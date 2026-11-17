import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WorkbenchError} from '../lib/workbench/domain.ts';
import {combinedPlatformSummary,operatingConfigSchema,operatingRecordSchema,operatingTemplateSchema,operatingTemplatePresets,operatingTemplateMetrics,operatingFields,parseOperatingInput,operatingRatios,validateOperatingRows,operatingDate,operatingSummary,operatingReconciliation} from '../lib/workbench/operating-data.ts';
import type {OperatingRecord,OperatingRow,OperatingSheet,OperatingTemplate} from '../cloud/company/operating-model.ts';

const stores=[{id:'s001',name:'样例1号店'},{id:'s002',name:'样例2号店'}];
const financial={orderedCoupons:10,orderAmount:20000,verifiedCoupons:15,verifiedAmount:30000,refundOrders:2,refundAmount:4000,adSpend:10000};
const mt={...financial,naturalExposure:100,paidExposure:200,consultations:null,leads:null};
const stamp='2026-11-13T02:00:00.000Z';
const template:OperatingTemplate={id:'tpl_leads',name:'客资',description:'每日客资',dimension:'total',writer:'owner',fields:[{key:'leads',label:'线索数',kind:'count',required:true},{key:'spend',label:'花费',kind:'money',required:true}],metrics:[{key:'cpl',label:'线索成本',numerator:'spend',denominator:'leads',format:'money'}],active:true};
function row(storeId='s001',values:Record<string,number|null>={revenue:10000},storeName=stores.find(s=>s.id===storeId)?.name||'全平台'):OperatingRow{return{storeId,storeName,values};}
function record(sheet:OperatingSheet,date:string,rows:OperatingRow[],extra:Partial<OperatingRecord>={}):OperatingRecord{
 return{id:'op_'+createHash('sha256').update(sheet+date).digest('hex').slice(0,32),companyId:'co_012345abcdef',projectId:'p_'+'a'.repeat(24),projectName:'门店经营',sheet,date,status:'draft',version:1,publishedVersion:0,writerLogin:'owner',reviewerLogin:'supervisor',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',createdAt:stamp,updatedAt:stamp,rows,published:null,...extra};
}

test('monthly target progress uses only visible store revenue up to cutoff, and divides summed amounts for the total',async()=>{
 const {operatingTargetProgress}=await import('../lib/workbench/operating-data.ts');
 const targets=record('targets','2026-11-01',[row('s001',{target:10000}),row('s002',{target:30000})]);
 const first=record('revenue','2026-11-01',[row('s001',{revenue:6000}),row('s002',{revenue:0})],{status:'approved'});
 const second=record('revenue','2026-11-02',[row('s001',{revenue:null}),row('s002',{revenue:3000})]);
 const later=record('revenue','2026-11-04',[row('s001',{revenue:99999})]);
 const platform=record('douyin','2026-11-02',[row('s001',{verifiedAmount:99999})]);
 const foreign={...second,projectId:'other',rows:[row('s001',{revenue:99999})]};
 const source=[first,second,later,platform,foreign];
 const current=operatingTargetProgress(targets,source,'2026-11-03',false);
 assert.deepEqual(current.rows.map(r=>[r.target,r.revenue,r.rate,r.reportedDays,r.unconfirmedDays]),[[10000,6000,.6,1,0],[30000,3000,.1,2,1]]);
 assert.deepEqual(current.total,{target:40000,revenue:9000,rate:.225});
 assert.deepEqual(current.missingDates,['2026-11-03']);
 assert.equal(current.daysExpected,3);
 const approved=operatingTargetProgress({...targets,status:'approved'},source,'2026-11-03',true);
 assert.deepEqual(approved.total,{target:40000,revenue:6000,rate:.15});
 assert.deepEqual(approved.rows.map(r=>r.rate),[.6,0]);
 assert.deepEqual(approved.missingDates,['2026-11-02','2026-11-03']);
});
test('missing and zero targets, absent revenue, and partial goal coverage remain distinct',async()=>{
 const {operatingTargetProgress}=await import('../lib/workbench/operating-data.ts');
 const targets=record('targets','2026-11-01',[row('s001',{target:0}),row('s002',{target:10000})]);
 const day=record('revenue',targets.date,[row('s001',{revenue:0}),row('s003',{revenue:500},'新店')]);
 const result=operatingTargetProgress(targets,[day],targets.date,false);
 assert.deepEqual(result.rows.map(r=>[r.target,r.revenue,r.rate]),[[0,0,null],[10000,null,null],[null,500,null]]);
 assert.deepEqual(result.total,{target:10000,revenue:500,rate:null});
 assert.equal(operatingTargetProgress(targets,[],targets.date,false).total.revenue,null);
});
test('monthly target progress can use a single equivalent store template and never adds it to builtin revenue',async()=>{
 const {operatingTargetProgress}=await import('../lib/workbench/operating-data.ts');
 const date='2026-11-01',targets=record('targets',date,[row('s001',{target:10000})]);
 const definition:OperatingTemplate={...template,id:'tpl_revenue',name:'门店业绩日报',dimension:'store',fields:[{key:'revenue',label:'门店总业绩',kind:'money',required:true}],metrics:[]};
 const custom=record('tpl_revenue',date,[row('s001',{revenue:20000})],{template:definition});
 const builtin=record('revenue',date,[row('s001',{revenue:5000})]);
 assert.equal(operatingTargetProgress(targets,[custom],date,false).total.rate,2);
 assert.equal(operatingTargetProgress(targets,[custom,builtin],date,false).total.rate,.5);
 const other=record('tpl_other',date,custom.rows,{template:{...definition,id:'tpl_other'}});
 assert.throws(()=>operatingTargetProgress(targets,[custom,other],date,false),/核对.*来源/);
});
test('money is exact integer cents while empty remains unreported rather than zero',()=>{
 for(const[input,want]of [['',null],['  ',null],['0',0],['0.01',1],['1.10',110],['1234.56',123456],['1,234.56',123456]] as const)assert.equal(parseOperatingInput(input,'money'),want);
 for(const input of['-1','1.001','1e3','=1+2','￥2','1,23.45','Infinity','90071992547409.92'])assert.throws(()=>parseOperatingInput(input,'money'));
 assert.equal(parseOperatingInput('90071992547409.91','money'),Number.MAX_SAFE_INTEGER);
});
test('counts and stars reject fractional counts, negative counts, formulas and out of range ratings',()=>{
 assert.equal(parseOperatingInput('0','count'),0);assert.equal(parseOperatingInput('5.0','stars'),5);assert.equal(parseOperatingInput('4.7','stars'),4.7);
 for(const input of['-1','1.0','1.2','1e2','+2','=2','9007199254740992'])assert.throws(()=>parseOperatingInput(input,'count'));
 for(const input of['5.1','4.77','-0.1'])assert.throws(()=>parseOperatingInput(input,'stars'));
});
test('dates validate real calendar days independently of timezone',()=>{
 assert.equal(operatingDate('2024-02-29'),'2024-02-29');
 for(const date of['2026-02-29','2026-11-31','2026-1-01','2026-11-01T00:00:00Z','1969-12-31'])assert.throws(()=>operatingDate(date));
});
test('ratios permit cross-period verification above 100 percent and missing denominators never become zero',()=>{
 assert.deepEqual(operatingRatios({...financial,positiveReviews:6,naturalExposure:100,paidExposure:200}),{verificationRate:1.5,refundRate:0.2,verifiedRoi:3,orderRoi:2,positiveRate:0.4,totalExposure:300});
 const empty=operatingRatios({orderedCoupons:0,verifiedCoupons:0,refundOrders:0,adSpend:null,naturalExposure:100,paidExposure:null});
 for(const key of['verificationRate','refundRate','verifiedRoi','orderRoi','positiveRate','totalExposure'] as const)assert.equal(empty[key],null);
});
test('financial fields are required on submit while platform traffic and meituan reviews remain optional',()=>{
 const fields=operatingFields('meituan-stores');assert.equal(fields.find(f=>f.key==='positiveReviews')?.required,false);assert.equal(fields.find(f=>f.key==='stars')?.kind,'stars');
 const values={...financial,positiveReviews:null,stars:null};assert.equal(validateOperatingRows('meituan-stores',[row('s001',values),row('s002',values)],stores,true).length,2);
 assert.throws(()=>validateOperatingRows('meituan-stores',[row('s001',{...values,orderAmount:null}),row('s002',values)],stores,true));
 assert.throws(()=>validateOperatingRows('revenue',[row('s001',{revenue:null}),row('s002',{revenue:0})],stores,true));
});
test('row boundary rejects missing or unknown keys, duplicate or unknown stores and renamed current rows',()=>{
 assert.deepEqual(validateOperatingRows('revenue',[row('s002',{revenue:null}),row()],stores),[row('s002',{revenue:null}),row()]);
 for(const rows of[[row()],[row(),row()],[row(),row('s003')],[row(),row('s002',{revenue:2,other:3})],[row(),row('s002',{})],[row(),row('s002',{revenue:2},'旧名称')]])assert.throws(()=>validateOperatingRows('revenue',rows,stores));
 assert.throws(()=>validateOperatingRows('revenue',[row('s001',{revenue:1.2}),row('s002')],stores));
 assert.throws(()=>validateOperatingRows('meituan',[row('all',{...mt,orderedCoupons:-1})],stores));
 assert.throws(()=>validateOperatingRows('meituan',[row('s001',mt)],stores));
 assert.equal(validateOperatingRows('meituan',[row('all',mt)],stores,true)[0].storeName,'全平台');
 assert.throws(()=>validateOperatingRows('meituan',[row('all',{...mt,orderedCoupons:-1})],stores),(error:unknown)=>error instanceof WorkbenchError&&error.status===400);
});
test('config enforces stable bounded store ids and unique names',()=>{
 const base={projectId:'p_'+'a'.repeat(24),stores};assert.ok(operatingConfigSchema.safeParse(base).success);
 for(const input of[{...base,projectId:'x'},{...base,stores:[]},{...base,stores:[stores[0],stores[0]]},{...base,stores:[{id:'s031',name:'店'}]},{...base,stores:[{id:'s001',name:' '}]} ,{...base,stores:[{id:'s001',name:'店'},{id:'s002',name:'店'}]},{...base,other:1}])assert.equal(operatingConfigSchema.safeParse(input).success,false);
});
test('record schema strictly validates IDs, dates, complete keys, values and historical store row sets',()=>{
 const old=record('revenue','2026-11-01',[row('s001',{revenue:null},'历史名称')]);assert.ok(operatingRecordSchema.safeParse(old).success);
 for(const patch of[{id:'op_x'},{companyId:'x'},{projectId:'x'},{date:'2026-02-30'},{version:0},{rows:[row('s031')]},{rows:[row(),row()]},{rows:[row('s001',{revenue:1,other:null})]},{rows:[row('s001',{})]},{rows:[{...row(),extra:1}]},{rows:[row('s001',{revenue:Number.MAX_SAFE_INTEGER+1})]},{unknown:true}])assert.equal(operatingRecordSchema.safeParse({...old,...patch}).success,false,JSON.stringify(patch));
 assert.equal(operatingRecordSchema.safeParse(record('targets','2026-11-02',[row('s001',{target:1})])).success,false);
 assert.ok(operatingRecordSchema.safeParse({...old,createdAt:'2026-11-13T02:00:00Z'}).success);
});
test('star precision is exactly one decimal in stored data, not an epsilon approximation',()=>{
 assert.equal(operatingRecordSchema.safeParse(record('meituan-stores','2026-11-01',[row('s001',{...financial,positiveReviews:null,stars:4.7000000001})])).success,false);
});
test('record schema rejects incomplete submissions and snapshots with identity, version or shape mismatch',()=>{
 const submitted=record('revenue','2026-11-01',[row()],{status:'submitted',version:2,submittedBy:'owner',submittedName:'管理员',submittedAt:stamp});assert.ok(operatingRecordSchema.safeParse(submitted).success);
 assert.equal(operatingRecordSchema.safeParse({...submitted,rows:[row('s001',{revenue:null})]}).success,false);
 assert.equal(operatingRecordSchema.safeParse({...submitted,submittedAt:null}).success,false);
 const approved={...submitted,status:'approved' as const,version:3,publishedVersion:3,reviewerName:'主管'};const{published,...snapshot}=approved;
 const current={...approved,published:snapshot};assert.ok(operatingRecordSchema.safeParse(current).success);
 const amended={...current,status:'draft',version:4};assert.ok(operatingRecordSchema.safeParse(amended).success);
 for(const patch of[{published:null},{published:{...snapshot,date:'2026-11-02'}},{published:{...snapshot,rows:[row('s001',{revenue:null})]}},{published:{...snapshot,published:null}},{published:{...snapshot,status:'draft'}},{published:{...snapshot,publishedVersion:2}},{published:{...snapshot,id:'op_'+'f'.repeat(32)}}])assert.equal(operatingRecordSchema.safeParse({...current,...patch}).success,false);
});
test('daily summaries add only the selected sheet in the same month and report absent dates',()=>{
 const records=[record('revenue','2026-10-31',[row('s001',{revenue:999})]),record('revenue','2026-11-01',[row('s001',{revenue:10000})]),record('revenue','2026-11-03',[row('s001',{revenue:20000})]),record('meituan','2026-11-01',[row('all',mt)]),record('revenue','2026-11-04',[row('s001',{revenue:999})])];
 assert.deepEqual(operatingSummary(records,'revenue','2026-11-03'),{start:'2026-11-01',end:'2026-11-03',rows:[row('s001',{revenue:30000})],daysExpected:3,daysReported:2,missingDates:['2026-11-02'],scopeChanged:false,complete:false,incompleteFields:['revenue'],incompleteFieldsByStore:{s001:['revenue']}});
});
test('null field leaves a visible filled subtotal while summary remains incomplete',()=>{
 const result=operatingSummary([record('revenue','2026-11-01',[row('s001',{revenue:0})]),record('revenue','2026-11-02',[row('s001',{revenue:null})])],'revenue','2026-11-02');
 assert.equal(result.rows[0].values.revenue,0);assert.equal(result.daysReported,2);assert.equal(result.complete,false);assert.deepEqual(result.missingDates,[]);
 assert.equal(operatingSummary([record('revenue','2026-11-01',[row('s001',{revenue:null})])],'revenue','2026-11-01').rows[0].values.revenue,null);
});
test('platform weighted ratios derive from summed numerators and denominators',()=>{
 const other={...mt,orderedCoupons:90,verifiedCoupons:45,orderAmount:180000,verifiedAmount:90000,adSpend:50000};
 const result=operatingSummary([record('meituan','2026-11-01',[row('all',mt)]),record('meituan','2026-11-02',[row('all',other)])],'meituan','2026-11-02');
 assert.equal(result.complete,true);assert.equal(operatingRatios(result.rows[0].values).verificationRate,0.6);assert.equal(operatingRatios(result.rows[0].values).verifiedRoi,2);
});
test('cumulative store snapshots use only exact cutoff and targets only month-start',()=>{
 const a=record('meituan-stores','2026-11-07',[row('s001',{...financial,positiveReviews:6,stars:4.7})]);const b=record('meituan-stores','2026-11-14',[row('s001',{...financial,verifiedAmount:60000,positiveReviews:12,stars:4.8})]);
 const result=operatingSummary([a,b],'meituan-stores','2026-11-14');assert.equal(result.rows[0].values.verifiedAmount,60000);assert.equal(result.rows[0].values.stars,4.8);assert.equal(result.daysExpected,14);assert.equal(result.complete,true);
 const absent=operatingSummary([a,b],'meituan-stores','2026-11-21');assert.equal(absent.complete,false);assert.deepEqual(absent.rows,[]);assert.equal(absent.source,'daily');assert.equal(absent.missingDates.length,21);assert.equal(absent.missingDates[0],'2026-11-01');assert.equal(absent.missingDates.at(-1),'2026-11-21');
 const target=operatingSummary([record('targets','2026-11-01',[row('s001',{target:100000})])],'targets','2026-11-21');assert.equal(target.rows[0].values.target,100000);assert.equal(target.daysReported,1);assert.equal(target.complete,true);
});
test('summaries retain latest historical name, expose missing store rows and never mutate source records',()=>{
 const first=record('revenue','2026-11-01',[row('s001',{revenue:10000},'旧名称')]);const next=record('revenue','2026-11-02',[row('s001',{revenue:20000},'新名称'),row('s002',{revenue:30000})]);const before=JSON.stringify([first,next]);
 const result=operatingSummary([next,first],'revenue','2026-11-02');assert.equal(result.complete,false);assert.equal(result.rows.find(r=>r.storeId==='s001')?.storeName,'新名称');assert.equal(result.rows.find(r=>r.storeId==='s002')?.values.revenue,30000);assert.equal(JSON.stringify([first,next]),before);
});
test('summary selects the highest version but rejects duplicate versions and conflicting date identities',()=>{
 const first=record('revenue','2026-11-01',[row('s001',{revenue:100})]);const latest={...first,version:2,rows:[row('s001',{revenue:200})]};
 assert.equal(operatingSummary([latest,first],'revenue','2026-11-01').rows[0].values.revenue,200);
 assert.throws(()=>operatingSummary([first,first],'revenue','2026-11-01'));
 assert.throws(()=>operatingSummary([first,{...first,id:'op_'+'f'.repeat(32),version:2}],'revenue','2026-11-01'));
 assert.throws(()=>operatingSummary([first,{...latest,projectId:'p_'+'b'.repeat(24)}],'revenue','2026-11-01'));
});
test('reconciliation reports exact financial differences without comparing traffic or combining snapshots',()=>{
 const daily=record('meituan','2026-11-01',[row('all',mt)]);const detail=record('meituan-stores','2026-11-01',[row('s001',{...financial,positiveReviews:null,stars:null})]);
 assert.equal(operatingReconciliation([daily,detail],'meituan','2026-11-01').state,'match');
 const mismatch={...detail,rows:[row('s001',{...financial,verifiedAmount:31000,positiveReviews:9,stars:4.9})]};const result=operatingReconciliation([daily,mismatch],'meituan','2026-11-01');assert.equal(result.state,'different');assert.deepEqual(result.differences.find(x=>x.key==='verifiedAmount'),{key:'verifiedAmount',label:'核销金额',daily:30000,stores:31000,difference:1000});
 assert.equal(operatingReconciliation([daily,detail],'meituan','2026-11-02').state,'incomplete');
});
test('reconciliation treats blank finance, missing days and unequal historical store sets as incomplete',()=>{
 const daily=record('meituan','2026-11-01',[row('all',mt)]);const detail=record('meituan-stores','2026-11-01',[row('s001',{...financial,refundAmount:null,positiveReviews:null,stars:null})]);
 const result=operatingReconciliation([daily,detail],'meituan','2026-11-01');assert.equal(result.state,'incomplete');assert.equal(result.differences.find(x=>x.key==='refundAmount')?.stores,null);assert.equal(result.differences.find(x=>x.key==='refundAmount')?.difference,null);
 assert.equal(operatingReconciliation([daily,{...detail,rows:[]}],'meituan','2026-11-01').state,'incomplete');
});

test('template definitions reject executable, unknown, duplicate and circular metric references',()=>{
 assert.ok(operatingTemplateSchema.safeParse(template).success);
 for(const patch of[{id:'tpl_Invalid'},{name:'<script>bad</script>'},{fields:[]},{fields:[template.fields[0],template.fields[0]]},{fields:[{...template.fields[0],key:'__proto__'}]},{fields:[{...template.fields[0],label:'=SUM(A1)'}]},{metrics:[{...template.metrics[0],numerator:'spend/leads'}]},{metrics:[{...template.metrics[0],key:'leads'}]},{metrics:[{...template.metrics[0],denominator:'cpl'}]},{metrics:[template.metrics[0],template.metrics[0]]},{fields:[...template.fields,{key:'stars',label:'星级',kind:'stars',required:false}],metrics:[{...template.metrics[0],numerator:'stars'}]},{extra:'x'}])assert.equal(operatingTemplateSchema.safeParse({...template,...patch}).success,false,JSON.stringify(patch));
});
test('safe template metrics normalize money units before division and unknown or zero inputs stay null',()=>{
 const mixed={...template,fields:[...template.fields,{key:'revenue',label:'收入',kind:'money' as const,required:true}],metrics:[...template.metrics,{key:'roi',label:'金额ROI',numerator:'revenue',denominator:'spend',format:'ratio' as const}]};
 assert.deepEqual(operatingTemplateMetrics(mixed,{leads:4,spend:10000,revenue:25000}),[{key:'cpl',label:'线索成本',format:'money',value:25},{key:'roi',label:'金额ROI',format:'ratio',value:2.5}]);
 assert.deepEqual(operatingTemplateMetrics(template,{leads:0,spend:10000})[0].value,null);assert.equal(operatingTemplateMetrics(template,{leads:null,spend:10000})[0].value,null);
});
test('preset library supplies independent lead, ad and ecommerce metadata with no profit inference',()=>{
 const presets=operatingTemplatePresets();assert.deepEqual(presets.map(p=>p.id),['tpl_leads','tpl_ads','tpl_ecommerce']);
 assert.ok(presets.every(p=>operatingTemplateSchema.safeParse(p).success&&p.dimension==='total'&&p.writer==='owner'));
 assert.deepEqual(presets[0].fields.map(f=>f.key),['leads','validLeads','appointments','arrivals','deals','revenue','spend']);assert.deepEqual(presets[1].fields.map(f=>f.key),['impressions','clicks','leads','orders','orderAmount','spend']);
 assert.deepEqual(presets[2].fields.map(f=>f.key),['orders','orderAmount','refundAmount','spend']);
 presets[0].fields[0].label='changed';assert.equal(operatingTemplatePresets()[0].fields[0].label,'线索数');
});
test('total-only template config needs no stores but store templates and builtins require dimensions',()=>{
 const base={projectId:'p_'+'a'.repeat(24),stores:[],builtinSheets:[],templates:[template],dimensionLabel:'渠道'};
 assert.ok(operatingConfigSchema.safeParse(base).success);
 assert.ok(operatingConfigSchema.safeParse({...base,builtinSheets:['meituan']}).success);
 for(const patch of[{builtinSheets:['revenue']},{builtinSheets:['meituan','meituan']},{templates:[template,template]},{templates:[{...template,dimension:'store'}]},{dimensionLabel:''},{dimensionLabel:'长'.repeat(13)}])assert.equal(operatingConfigSchema.safeParse({...base,...patch}).success,false);
});
test('generic rows strictly follow their immutable schema and dimension rather than builtin finance',()=>{
 const rows=[row('all',{leads:4,spend:10000},'全项目')];assert.deepEqual(operatingFields('tpl_leads',template),template.fields);assert.deepEqual(validateOperatingRows('tpl_leads',rows,[],true,template),rows);
 assert.throws(()=>operatingFields('tpl_leads'));assert.throws(()=>operatingFields('tpl_other',template));assert.throws(()=>validateOperatingRows('tpl_leads',[row('s001',{leads:4,spend:10000})],stores,true,template));
 assert.throws(()=>validateOperatingRows('tpl_leads',[row('all',{leads:4,spend:10000,unknown:0},'全项目')],[],true,template));
 assert.throws(()=>validateOperatingRows('tpl_leads',[row('all',{leads:4,spend:null},'全项目')],[],true,template));
 const perStore={...template,dimension:'store' as const};assert.equal(validateOperatingRows('tpl_leads',[row('s001',{leads:4,spend:10000}),row('s002',{leads:0,spend:0})],stores,true,perStore).length,2);
});
test('generic record schema requires matching schema snapshots and validates published snapshots recursively',()=>{
 const generic=record('tpl_leads','2026-11-01',[row('all',{leads:4,spend:10000},'全项目')],{template});assert.ok(operatingRecordSchema.safeParse(generic).success);
 for(const patch of[{template:undefined},{template:{...template,id:'tpl_ads'}},{rows:[row('all',{leads:4},'全项目')]}])assert.equal(operatingRecordSchema.safeParse({...generic,...patch}).success,false);
 assert.equal(operatingRecordSchema.safeParse({...record('revenue','2026-11-01',[row()]),template}).success,false);
 const approved={...generic,status:'approved' as const,version:2,publishedVersion:2,submittedBy:'owner',submittedName:'管理员',submittedAt:stamp,reviewerName:'主管'};const{published,...snapshot}=approved;const current={...approved,published:snapshot};assert.ok(operatingRecordSchema.safeParse(current).success);
 assert.equal(operatingRecordSchema.safeParse({...current,published:{...snapshot,template:{...template,fields:[]}}}).success,false);
});
test('generic month summaries use weighted raw fields and reject mixed historical field units',()=>{
 const one=record('tpl_leads','2026-11-01',[row('all',{leads:1,spend:10000},'全项目')],{template});const two=record('tpl_leads','2026-11-02',[row('all',{leads:9,spend:10000},'全项目')],{template:{...template,name:'改名不改历史口径'}});
 const result=operatingSummary([one,two],'tpl_leads','2026-11-02');assert.equal(result.complete,true);assert.deepEqual(result.rows[0].values,{leads:10,spend:20000});assert.equal(operatingTemplateMetrics(template,result.rows[0].values)[0].value,20);
 assert.throws(()=>operatingSummary([one,{...two,template:{...template,fields:[{...template.fields[0],kind:'money'},template.fields[1]]}}],'tpl_leads','2026-11-02'));
});
test('platform daily store rows produce a single platform total before month aggregation',()=>{
 const rows=[row('s001',mt),row('s002',{...mt,orderedCoupons:30,verifiedCoupons:15})];assert.equal(validateOperatingRows('meituan',rows,stores,true).length,2);
 assert.throws(()=>validateOperatingRows('meituan',[row('all',mt),row('s001',mt)],stores));assert.throws(()=>validateOperatingRows('meituan',[row('s001',mt)],stores));
 assert.ok(operatingRecordSchema.safeParse(record('meituan','2026-11-01',rows)).success);
 const result=operatingSummary([record('meituan','2026-11-01',rows)],'meituan','2026-11-01');assert.deepEqual(result.rows,[row('all',{...mt,orderedCoupons:40,verifiedCoupons:30,orderAmount:40000,verifiedAmount:60000,refundOrders:4,refundAmount:8000,adSpend:20000,naturalExposure:200,paidExposure:400,positiveReviews:null,stars:null})]);assert.equal(result.complete,true);
});
test('one daily store entry feeds cumulative detail and a manual snapshot cannot double count it',()=>{
 const daily=[record('meituan','2026-11-01',[row('s001',mt),row('s002',mt)]),record('meituan','2026-11-02',[row('s001',mt),row('s002',mt)])];const manual=record('meituan-stores','2026-11-02',[row('s001',{...financial,verifiedAmount:999999,positiveReviews:9,stars:4.7})]);
 const result=operatingSummary([...daily,manual],'meituan-stores','2026-11-02');assert.equal(result.source,'daily');assert.equal(result.complete,true);assert.equal(result.rows.length,2);assert.equal(result.rows[0].values.verifiedAmount,60000);assert.equal(result.rows[0].values.positiveReviews,null);assert.equal(result.rows[0].values.stars,null);
 assert.equal(operatingReconciliation([...daily,manual],'meituan','2026-11-02').state,'different');
});
test('missing daily dimensions use only an exact manual cumulative snapshot and never infer stores from totals',()=>{
 const one=record('meituan','2026-11-01',[row('s001',mt)]),two=record('meituan','2026-11-02',[row('all',mt)]),manual=record('meituan-stores','2026-11-02',[row('s001',{...financial,positiveReviews:2,stars:4.7})]);
 const fallback=operatingSummary([one,two,manual],'meituan-stores','2026-11-02');assert.equal(fallback.source,'snapshot');assert.equal(fallback.rows[0].values.verifiedAmount,30000);assert.equal(fallback.complete,true);
 const partial=operatingSummary([one,two,{...manual,date:'2026-11-01'}],'meituan-stores','2026-11-02');assert.equal(partial.source,'daily');assert.equal(partial.complete,false);assert.deepEqual(partial.missingDates,['2026-11-02']);assert.equal(partial.rows[0].values.verifiedAmount,30000);
 const totalOnly=operatingSummary([two],'meituan-stores','2026-11-02');assert.equal(totalOnly.rows.length,0);assert.equal(totalOnly.complete,false);
});
test('derived store cumulative marks missing finance and store-set changes without averaging stars',()=>{
 const one=record('douyin','2026-11-01',[row('s001',{...financial,shopVisits:null,shopVisitors:null,privateContacts:null,privateOpens:null,privateLeads:null})]);const two=record('douyin','2026-11-02',[row('s001',{...financial,orderAmount:null,shopVisits:null,shopVisitors:null,privateContacts:null,privateOpens:null,privateLeads:null}),row('s002',{...financial,shopVisits:null,shopVisitors:null,privateContacts:null,privateOpens:null,privateLeads:null})]);
 const result=operatingSummary([one,two],'douyin-stores','2026-11-02');assert.equal(result.source,'daily');assert.equal(result.complete,false);assert.deepEqual(result.missingDates,['2026-11-01','2026-11-02']);
});
test('summary incompleteFields prevents metrics from mixing optional missing inputs with filled subtotals',()=>{
 const optional={...template,fields:[template.fields[0],{...template.fields[1],required:false}]};
 const one=record('tpl_leads','2026-11-01',[row('all',{leads:1,spend:10000},'全项目')],{template:optional}),two=record('tpl_leads','2026-11-02',[row('all',{leads:9,spend:null},'全项目')],{template:optional});
 const result=operatingSummary([one,two],'tpl_leads','2026-11-02');assert.equal(result.complete,true);assert.equal(result.rows[0].values.spend,10000);assert.deepEqual(result.incompleteFields,['spend']);
 const safe={...result.rows[0].values,...Object.fromEntries(result.incompleteFields.map(key=>[key,null]))};assert.equal(operatingTemplateMetrics(optional,safe)[0].value,null);
 const absent=operatingSummary([one],'tpl_leads','2026-11-02');assert.deepEqual(absent.incompleteFields,['leads','spend']);
});
test('incompleteFields applies to each source dimension and snapshot without losing known values',()=>{
 const daily=record('meituan','2026-11-01',[row('s001',mt),row('s002',{...mt,paidExposure:null})]);
 const total=operatingSummary([daily],'meituan','2026-11-01');assert.deepEqual(total.incompleteFields,['paidExposure','consultations','leads','positiveReviews','stars']);assert.equal(total.rows[0].values.paidExposure,200);
 const derived=operatingSummary([daily],'meituan-stores','2026-11-01');assert.deepEqual(derived.incompleteFields,['positiveReviews','stars']);
 const snapshot=operatingSummary([record('meituan-stores','2026-11-01',[row('s001',{...financial,positiveReviews:null,stars:4.7})])],'meituan-stores','2026-11-01');assert.deepEqual(snapshot.incompleteFields,['positiveReviews']);
 const target=operatingSummary([record('targets','2026-11-01',[row('s001',{target:0})])],'targets','2026-11-20');assert.deepEqual(target.incompleteFields,[]);
});
test('project-owner templates retain strict field references and trusted record snapshots',()=>{
 const delegated={...template,writer:'project-owner'};
 assert.ok(operatingTemplateSchema.safeParse(delegated).success);
 assert.ok(operatingConfigSchema.safeParse({projectId:'p_'+'a'.repeat(24),stores:[],builtinSheets:[],templates:[delegated]}).success);
 const daily=record('tpl_leads','2026-11-01',[row('all',{leads:4,spend:10000},'全项目')],{template:delegated as OperatingTemplate,writerLogin:'employee'});
 assert.ok(operatingRecordSchema.safeParse(daily).success);
 assert.equal(operatingTemplateSchema.safeParse({...delegated,writer:'employee'}).success,false);
 assert.equal(operatingTemplateSchema.safeParse({...delegated,metrics:[{...template.metrics[0],numerator:'cpl'}]}).success,false);
 assert.equal(operatingTemplateSchema.safeParse({...delegated,fields:[...template.fields,{key:'stars',label:'星级',kind:'stars',required:false}],metrics:[{...template.metrics[0],numerator:'stars'}]}).success,false);
 assert.ok(operatingTemplatePresets().every(p=>p.writer==='owner'));
});
test('template input labels must be unique so exported column headers remain unambiguous on reimport',()=>{
 const duplicate={...template,fields:[template.fields[0],{...template.fields[1],label:'线索数'}]};
 assert.equal(operatingTemplateSchema.safeParse(duplicate).success,false);
 assert.equal(operatingTemplateSchema.safeParse({...duplicate,fields:[template.fields[0],{...template.fields[1],label:' 线索数 '}]}).success,false);
 assert.ok(operatingTemplateSchema.safeParse({...template,metrics:[...template.metrics,{key:'costPerLead',label:template.metrics[0].label,numerator:'spend',denominator:'leads',format:'money'}]}).success);
});
test('meituan optional reviews normalize only new saves while legacy approved rows retain their raw checksum content',()=>{
 const oldRows=[row('s001',mt),row('s002',mt)],before=JSON.stringify(oldRows),normalized=validateOperatingRows('meituan',oldRows,stores,true);
 assert.deepEqual(normalized[0].values,{...mt,positiveReviews:null,stars:null});assert.equal(JSON.stringify(oldRows),before);
 const descriptors=operatingFields('meituan');assert.deepEqual(descriptors.filter(f=>['positiveReviews','stars'].includes(f.key)),[{key:'positiveReviews',label:'新增好评',kind:'count',required:false},{key:'stars',label:'星级',kind:'stars',required:false}]);
 const approved=record('meituan','2026-11-01',oldRows,{status:'approved',version:3,publishedVersion:3,submittedBy:'owner',submittedName:'管理员',submittedAt:stamp,reviewerName:'主管'});const{published,...snapshot}=approved;const legacy={...approved,published:snapshot};const parsed=operatingRecordSchema.parse(legacy);
 assert.equal(JSON.stringify(parsed.rows[0].values),JSON.stringify(mt));assert.equal(JSON.stringify(parsed.published!.rows[0].values),JSON.stringify(mt));assert.equal(Object.hasOwn(parsed.rows[0].values,'positiveReviews'),false);
 assert.throws(()=>validateOperatingRows('meituan',[row('all',{...mt,unexpected:null})],stores));
 const missingOldTraffic={...mt} as Record<string,number|null>;delete missingOldTraffic.leads;assert.throws(()=>validateOperatingRows('meituan',[row('all',missingOldTraffic)],stores));
 assert.throws(()=>validateOperatingRows('meituan',[row('all',{...mt,positiveReviews:-1,stars:4.7})],stores));assert.throws(()=>validateOperatingRows('meituan',[row('all',{...mt,positiveReviews:0,stars:4.77})],stores));
});
test('meituan 1-to-cutoff daily reviews add once and stars come only from that exact cutoff',()=>{
 const daily=Array.from({length:14},(_,i)=>record('meituan','2026-11-'+String(i+1).padStart(2,'0'),[row('s001',{...mt,positiveReviews:i+1,stars:i===13?3.8:4.9}),row('s002',{...mt,positiveReviews:0,stars:i===13?0:4.1})]));
 const result=operatingSummary(daily,'meituan-stores','2026-11-14');assert.equal(result.source,'daily');assert.equal(result.complete,true);assert.equal(result.rows[0].values.positiveReviews,105);assert.equal(result.rows[0].values.stars,3.8);assert.equal(result.rows[1].values.positiveReviews,0);assert.equal(result.rows[1].values.stars,0);assert.deepEqual(result.incompleteFields,[]);
 const partial=operatingSummary(daily.slice(1),'meituan-stores','2026-11-14');assert.equal(partial.complete,false);assert.equal(partial.rows[0].values.stars,3.8);assert.equal(partial.incompleteFields.includes('stars'),false);
 const missingLast=structuredClone(daily);missingLast[13].rows[0].values.stars=null;const missing=operatingSummary(missingLast,'meituan-stores','2026-11-14');assert.equal(missing.rows[0].values.stars,null);assert.equal(missing.incompleteFields.includes('stars'),true);
 const noCutoff=operatingSummary(daily.slice(0,13),'meituan-stores','2026-11-14');assert.equal(noCutoff.rows[0].values.stars,null);assert.equal(noCutoff.incompleteFields.includes('stars'),true);
 const genericTemplate={...template,fields:[...template.fields,{key:'stars',label:'星级',kind:'stars' as const,required:false}]};const generic=operatingSummary([record('tpl_leads','2026-11-01',[row('all',{leads:1,spend:10000,stars:4.9},'全项目')],{template:genericTemplate})],'tpl_leads','2026-11-01');assert.equal(generic.rows[0].values.stars,null);
});
test('independent reconciliation compares an exact manual snapshot even when complete daily details drive the main view',()=>{
 const daily=[record('meituan','2026-11-01',[row('s001',mt)]),record('meituan','2026-11-02',[row('s001',mt)])];
 const manual=record('meituan-stores','2026-11-02',[row('s001',{orderedCoupons:20,orderAmount:40000,verifiedCoupons:30,verifiedAmount:65000,refundOrders:4,refundAmount:8000,adSpend:20000,positiveReviews:null,stars:null})]);
 assert.equal(operatingSummary([...daily,manual],'meituan-stores','2026-11-02').source,'daily');
 const result=operatingReconciliation([...daily,manual],'meituan','2026-11-02');assert.equal(result.state,'different');assert.equal(result.storesSource,'snapshot');assert.deepEqual(result.differences.find(d=>d.key==='verifiedAmount'),{key:'verifiedAmount',label:'核销金额',daily:60000,stores:65000,difference:5000});
 const withoutExact=operatingReconciliation([...daily,{...manual,date:'2026-11-01'}],'meituan','2026-11-02');assert.equal(withoutExact.storesSource,'daily');assert.equal(withoutExact.state,'match');
});
test('independent reconciliation cannot replace an incomplete exact snapshot with complete same-source daily details',()=>{
 const daily=[record('meituan','2026-11-01',[row('s001',mt)])],manual=record('meituan-stores','2026-11-01',[row('s001',{...financial,refundAmount:null,positiveReviews:null,stars:null})]);
 assert.equal(operatingSummary([...daily,manual],'meituan-stores','2026-11-01').source,'daily');
 const result=operatingReconciliation([...daily,manual],'meituan','2026-11-01');assert.equal(result.state,'incomplete');assert.equal(result.storesSource,'snapshot');assert.deepEqual(result.differences.find(d=>d.key==='refundAmount'),{key:'refundAmount',label:'退款金额',daily:4000,stores:null,difference:null});
});

test('one missing store input cannot erase another store’s confirmed complete rate',()=>{
 const days=['2026-11-01','2026-11-02'].map((day,i)=>record('meituan',day,[row('s001',{...mt,positiveReviews:3,stars:4.4}),row('s002',{...mt,positiveReviews:i===0?4:null,stars:null})]));
 const result=operatingSummary(days,'meituan-stores','2026-11-02');
 assert.deepEqual(result.incompleteFieldsByStore?.s001,[]);assert.deepEqual(result.incompleteFieldsByStore?.s002,['positiveReviews','stars']);
 assert.equal(operatingRatios(result.rows[0].values).positiveRate,0.2);assert.ok(result.incompleteFields.includes('positiveReviews'));
});
test('changing described metric definitions or store scope cannot silently produce a comparable complete total',()=>{
 const one=record('tpl_leads','2026-11-01',[row('all',{leads:2,spend:20},'全项目')],{template});
 const two=record('tpl_leads','2026-11-02',one.rows,{template:{...template,description:'按退款后净额和有效线索统计'}});
 assert.throws(()=>operatingSummary([one,two],'tpl_leads','2026-11-02'),/口径/);
 const daily=[record('meituan','2026-11-01',[row('s001',mt)]),record('meituan','2026-11-02',[row('s001',mt),row('s002',mt)])];
 const platform=operatingSummary(daily,'meituan','2026-11-02');assert.equal(platform.complete,false);assert.ok(platform.incompleteFields.includes('verifiedAmount'));
});
test('reconciliation never certifies equal numbers from different stores or projects',()=>{
 const day=record('meituan','2026-11-01',[row('s001',mt)]);
 const snapshot=record('meituan-stores','2026-11-01',[row('s002',{...financial,positiveReviews:0,stars:4.2})]);
 const result=operatingReconciliation([day,snapshot],'meituan','2026-11-01');
 assert.equal(result.scopeMismatch,true);assert.equal(result.state,'different');assert.ok(result.differences.every(d=>d.difference===null));
 const another={...snapshot,projectId:'p_'+'b'.repeat(24)};
 assert.throws(()=>operatingReconciliation([day,another],'meituan','2026-11-01'),/项目/);
 assert.throws(()=>operatingSummary([day,another],'meituan-stores','2026-11-01'),/项目/);
});
test('a historical formula with mismatched units preserves raw fields and independently valid derived metrics',()=>{
 const bad={...template,metrics:[...template.metrics,{key:'badRate',label:'费用占比',numerator:'spend',denominator:'leads',format:'percent' as const},{key:'badValue',label:'虚假金额',numerator:'leads',denominator:'leads',format:'money' as const}]};
 const values={leads:4,spend:10000},legacy=record('tpl_leads','2026-11-01',[row('all',values,'全项目')],{template:bad});
 assert.ok(operatingRecordSchema.safeParse(legacy).success);assert.deepEqual(operatingSummary([legacy],'tpl_leads',legacy.date).rows[0].values,values);
 const metrics=operatingTemplateMetrics(bad,values);assert.equal(metrics[0].value,25);
 for(const invalid of metrics.slice(1)){assert.equal(invalid.value,null);assert.match(invalid.unitIssue||'',/公式单位不匹配/);}
 for(const preset of operatingTemplatePresets())assert.ok(operatingTemplateMetrics(preset,{}).every(metric=>!metric.unitIssue));
});

test('pair totals use matching dates and metric, keep zero, and exclude revenue and store snapshots',()=>{
 const day='2026-11-01',next='2026-11-02';
 const records=[record('meituan',day,[row('all',financial)]),record('douyin',day,[row('all',{...financial,verifiedAmount:0})]),record('revenue',day,[row()]),record('meituan-stores',day,[row('s001',financial)]),record('meituan',next,[row('all',financial)])];
 assert.equal(combinedPlatformSummary(records,day,day,'verifiedAmount').total,30000);
 assert.equal(combinedPlatformSummary(records,day,day,'orderAmount').total,40000);
 const partial=combinedPlatformSummary(records,day,next,'verifiedAmount');
 assert.equal(partial.total,null);assert.equal(partial.parts[0].value,60000);assert.equal(partial.parts[1].latest,day);
 const missing=combinedPlatformSummary([record('douyin',day,[row('all',{...financial,verifiedAmount:null})]),records[0]],day,day,'verifiedAmount');assert.equal(missing.total,null);
});
