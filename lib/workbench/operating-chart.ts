import type {OperatingRecord,OperatingRow,OperatingSheet,OperatingSnapshot,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {commonOperatingDefinition,operatingDate,operatingFields,operatingTemplateMetrics,validateOperatingRows} from './operating-data.ts';
import {formatOperatingDecimal,formatOperatingPercent} from './operating-display.ts';
import {operatingTableMetrics,operatingTableTotals} from './operating-paste.ts';

export type OperatingChartPurpose='time'|'stores';
export type OperatingChartKind='line'|'bar';
export type OperatingChartMetric={key:string;label:string;format:'money'|'count'|'percent'|'ratio';unit:string;dependencies:string[];definition:string;unitIssue?:string};
export type OperatingChartSheet={sheet:OperatingSheet;name:string;metrics:OperatingChartMetric[];defaultMetric:string|null;defaultPurpose:OperatingChartPurpose};
export type OperatingChartPoint={id:string;label:string;value:number|null;reason:string;rawCents?:string;fraction?:number};
type ChartMeasure=Omit<OperatingChartPoint,'id'|'label'>;
export type OperatingChartSelection={cutoff:string;sheet:OperatingSheet;metric?:string;purpose?:OperatingChartPurpose;kind?:OperatingChartKind};
export type OperatingChart={sheet:OperatingSheet;name:string;metric:OperatingChartMetric|null;metrics:OperatingChartMetric[];purpose:OperatingChartPurpose;recommended:OperatingChartKind;kind:OperatingChartKind;start:string;end:string;points:OperatingChartPoint[];periodRatio?:ChartMeasure;notes:string[];reported:number;validDays:number|null;expected:number;source:'daily'|'snapshot';hasData:boolean};

const names:Partial<Record<OperatingSheet,string>>={revenue:'门店总业绩',meituan:'美团平台日录',douyin:'抖音平台日录','meituan-stores':'美团门店累计','douyin-stores':'抖音门店累计'};
const dependencies:Record<string,string[]>={verificationRate:['verifiedCoupons','orderedCoupons'],refundRate:['refundOrders','orderedCoupons'],positiveRate:['positiveReviews','verifiedCoupons'],verifiedRoi:['verifiedAmount','adSpend'],orderRoi:['orderAmount','adSpend']};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const templateShape=(t?:OperatingTemplate)=>stable(t?{dimension:t.dimension,description:t.description,fields:t.fields,metrics:t.metrics}:null);
const datesThrough=(cutoff:string)=>Array.from({length:Number(cutoff.slice(8))},(_,i)=>cutoff.slice(0,8)+String(i+1).padStart(2,'0'));
const isSnapshot=(sheet:OperatingSheet)=>sheet==='meituan-stores'||sheet==='douyin-stores';
const metricSheet=(sheet:OperatingSheet):OperatingSheet=>sheet==='meituan'||sheet==='douyin'?(sheet+'-stores') as OperatingSheet:sheet;
const metricsFor=(sheet:OperatingSheet,values:Record<string,number|null>,template?:OperatingTemplate)=>template?operatingTemplateMetrics(template,values):operatingTableMetrics(metricSheet(sheet),values);

/** Working rows are never read here. A correction contributes only its immutable approved snapshot. */
function confirmedRecords(records:OperatingRecord[],cutoff:string):{records:OperatingSnapshot[];pending:number}{
 operatingDate(cutoff);const start=cutoff.slice(0,8)+'01',confirmed:OperatingSnapshot[]=[],seen=new Set<string>(),ids=new Set<string>();let scope='',pending=0;
 for(const parent of records){
  if(parent.date<start||parent.date>cutoff)continue;
  operatingDate(parent.date);
  let snapshot:OperatingSnapshot;
  if(parent.published){
   const published=parent.published;
   if(['id','companyId','projectId','sheet','date'].some(key=>parent[key as keyof OperatingRecord]!==published[key as keyof OperatingSnapshot]))throw Error('已确认快照身份或范围与原记录不一致，请刷新后核对');
   if(published.status!=='approved'||!Number.isSafeInteger(published.version)||published.version<1||published.publishedVersion!==published.version||parent.publishedVersion!==published.version||!Number.isSafeInteger(parent.version)||parent.version<published.version||parent.status==='approved'&&parent.version!==published.version)throw Error('已确认快照状态或版本不一致，请刷新后核对');
   snapshot=published;if(parent.status!=='approved')pending++;
  }else{
   if(parent.status!=='approved'){if(parent.publishedVersion>0)throw Error('记录缺少已确认快照，不能读取工作稿绘图');continue;}
   if(!Number.isSafeInteger(parent.version)||parent.version<1||parent.publishedVersion!==parent.version)throw Error('已确认记录版本无法核对');
   const {published,...approved}=parent;void published;snapshot=approved;
  }
  const currentScope=snapshot.companyId+':'+snapshot.projectId;
  if(scope&&scope!==currentScope)throw Error('不能混合不同公司或项目范围的图形数据');scope=currentScope;
  const key=snapshot.sheet+':'+snapshot.date;if(seen.has(key)||ids.has(snapshot.id))throw Error('已确认记录编号或同日同表经营事实重复或冲突，请重新读取');seen.add(key);ids.add(snapshot.id);
  const fields=operatingFields(snapshot.sheet,snapshot.template);
  // Normalize absent historical fields to unknown in a copy, never mutate the loaded record.
  const rows=snapshot.rows.map(row=>({...row,values:{...Object.fromEntries(fields.map(field=>[field.key,null])),...row.values}}));
  validateOperatingRows(snapshot.sheet,rows,rows.map(row=>({id:row.storeId,name:row.storeName})),false,snapshot.template);
  confirmed.push({...snapshot,rows});
 }
 return {records:confirmed.sort((a,b)=>a.date.localeCompare(b.date)),pending};
}

function chartMetrics(sheet:OperatingSheet,template?:OperatingTemplate):OperatingChartMetric[]{
 if(sheet==='targets')return [];
 const fields=operatingFields(sheet,template);
 const raw:OperatingChartMetric[]=fields.filter(f=>f.kind!=='stars').map(f=>({key:f.key,label:f.label,format:f.kind as 'money'|'count',unit:f.kind==='money'?'元':'个',dependencies:[f.key],definition:f.definition||''}));
 const calculated=metricsFor(sheet,{},template).map(m=>({key:'metric:'+m.key,label:m.label,format:m.format,unit:m.format==='percent'?'%':m.format==='money'?'元':'倍',dependencies:template?.metrics.find(v=>v.key===m.key)?[template.metrics.find(v=>v.key===m.key)!.numerator,template.metrics.find(v=>v.key===m.key)!.denominator]:dependencies[m.key]||[],definition:m.unitIssue||'先合计完整的分子与分母，再计算；分母为0时留空。',...(m.unitIssue?{unitIssue:m.unitIssue}:{})}));
 return [...raw,...calculated];
}
function defaultMetric(sheet:OperatingSheet,metrics:OperatingChartMetric[]):string|null{
 const known:Partial<Record<OperatingSheet,string>>={revenue:'revenue',meituan:'adSpend',douyin:'adSpend','meituan-stores':'adSpend','douyin-stores':'adSpend',tpl_ads:'spend',tpl_leads:'leads',tpl_ecommerce:'orderAmount'};
 const key=known[sheet];return key&&metrics.some(m=>m.key===key)?key:metrics.length===1?metrics[0].key:null;
}
function sameDefinition(records:OperatingSnapshot[]):OperatingTemplate|undefined{
 const template=commonOperatingDefinition(records);
 if(!template&&records.some(r=>r.template))throw Error('历史模板的字段、单位、定义或公式口径不同，暂不能合并绘图；请按同一确认口径核对');
 return template;
}

export function operatingChartOptions(records:OperatingRecord[],cutoff:string,_templates:OperatingTemplate[]=[]):OperatingChartSheet[]{
 const confirmed=confirmedRecords(records,cutoff).records;
 return [...new Set(confirmed.map(r=>r.sheet))].filter(sheet=>sheet!=='targets').map<OperatingChartSheet>(sheet=>{
  const selected=confirmed.filter(r=>r.sheet===sheet),template=commonOperatingDefinition(selected)||selected[0]?.template,metrics=chartMetrics(sheet,template);
  return {sheet,name:template?.name||names[sheet]||sheet,metrics,defaultMetric:defaultMetric(sheet,metrics),defaultPurpose:isSnapshot(sheet)?'stores':'time'};
 }).sort((a,b)=>a.sheet==='revenue'?-1:b.sheet==='revenue'?1:0);
}

/** Keep the integer-cent source separate from the approximate yuan coordinate used by Recharts. */
function chartMeasure(rows:OperatingRow[],metric:OperatingChartMetric,sheet:OperatingSheet,template?:OperatingTemplate):ChartMeasure{
 if(metric.unitIssue)return {value:null,reason:metric.unitIssue};
 const fields=operatingFields(sheet,template).filter(field=>metric.dependencies.includes(field.key));
 const totals=operatingTableTotals(rows,fields,true);
 const missing=fields.filter(field=>totals[field.key]==null).map(field=>field.label);
 if(missing.length)return {value:null,reason:missing.join('、')+'未提供，无法计算完整值'};
 const derived=metric.key.startsWith('metric:');
 if(derived&&totals[metric.dependencies[1]]===0){
  const denominator=fields.find(field=>field.key===metric.dependencies[1]);
  return {value:null,reason:'分母'+(denominator?.label||'')+'为0，比率无定义'};
 }
 const value=derived?metricsFor(sheet,totals,template).find(m=>'metric:'+m.key===metric.key)?.value:totals[metric.key];
 if(value==null||!Number.isFinite(value))return {value:null,reason:'指标公式无法核对'};
 if(metric.format==='money'&&!derived)return {value:value/100,rawCents:String(value),reason:''};
 if(metric.format==='percent')return {value:value*100,fraction:value,reason:''};
 return {value,reason:''};
}

export function operatingChartPointText(point:Pick<OperatingChartPoint,'value'|'rawCents'|'fraction'>,metric:OperatingChartMetric):string{
 if(point.value===null)return '—';
 if(metric.format==='money'&&!metric.key.startsWith('metric:')&&point.rawCents!==undefined){
  const cents=BigInt(point.rawCents),hundred=BigInt(100);
  return (cents/hundred).toLocaleString('zh-CN')+'.'+(cents%hundred).toString().padStart(2,'0')+' 元';
 }
 if(metric.format==='percent')return formatOperatingPercent(point.fraction??point.value/100);
 return formatOperatingDecimal(point.value,metric.format==='count'?0:2)+' '+metric.unit;
}

function hasConfirmedMetric(record:OperatingSnapshot,metric:OperatingChartMetric|null){
 return !record.template||!metric?.key.startsWith('metric:')||record.template.metrics.some(m=>'metric:'+m.key===metric.key);
}
function confirmedStoreNames(records:OperatingSnapshot[]){
 const names=new Map<string,string>();
 for(const record of records)for(const row of record.rows)names.set(row.storeId,row.storeName);
 return names;
}
function missingStores(record:OperatingSnapshot,storeNames:Map<string,string>){
 const provided=new Set(record.rows.map(row=>row.storeId));
 return [...storeNames].filter(([id])=>id!=='all'&&!provided.has(id));
}

export function operatingChartDetail(records:OperatingRecord[],chart:OperatingChart,id:string){
 const metric=chart.metric,point=chart.points.find(point=>point.id===id);
 if(!metric||!point)throw Error('请选择图形中的日期或门店');
 const selected=confirmedRecords(records,chart.end).records.filter(record=>record.sheet===chart.sheet);
 const template=sameDefinition(selected),points:OperatingChartPoint[]=[];
 const measure=(record:OperatingSnapshot,row:OperatingRow)=>hasConfirmedMetric(record,metric)
  ?chartMeasure([row],metric,chart.sheet,template)
  :{value:null,reason:'当日确认模板尚未使用这个公式'};
 if(chart.purpose==='time'){
  const record=selected.find(record=>record.date===id);
  if(record){
   for(const row of record.rows)points.push({id:row.storeId,label:row.storeId==='all'?row.storeName+'（总数）':row.storeName,...measure(record,row)});
   for(const [storeId,label] of missingStores(record,confirmedStoreNames(selected))){
    points.push({id:storeId,label,value:null,reason:'该日无此门店 / 渠道的已确认明细'});
   }
  }
 }else{
  const dates=chart.source==='snapshot'?[chart.end]:datesThrough(chart.end);
  for(const date of dates){
   const record=selected.find(record=>record.date===date),row=record?.rows.find(row=>row.storeId===id);
   const value=record&&row?measure(record,row):{value:null,reason:record?'当日未提供该门店 / 渠道明细':'该日无已确认记录'};
   points.push({id:date,label:date,...value});
  }
 }
 return {projectName:selected.at(-1)?.projectName??'',heading:chart.purpose==='time'?id:point.label,reason:point.reason,points};
}

export function buildOperatingChart(records:OperatingRecord[],selection:OperatingChartSelection,templates:OperatingTemplate[]=[]):OperatingChart{
 const {cutoff,sheet}=selection,projection=confirmedRecords(records,cutoff),selected=projection.records.filter(r=>r.sheet===sheet),template=sameDefinition(selected);
 const metrics=sheet.startsWith('tpl_')&&!template?[]:chartMetrics(sheet,template),key=selection.metric||defaultMetric(sheet,metrics),metric=metrics.find(m=>m.key===key)||null;
 if(selection.metric&&!metric)throw Error('所选图形指标不在原确认模板中，或该字段不能合计');
 const purpose=selection.purpose||(isSnapshot(sheet)?'stores':'time'),recommended=purpose==='time'?'line':'bar',kind=purpose==='stores'?'bar':selection.kind||recommended;
 const notes:string[]=[],dates=datesThrough(cutoff),start=dates[0],points:OperatingChartPoint[]=[],source=isSnapshot(sheet)?'snapshot':'daily';
 if(projection.pending)notes.push('本项目有 '+projection.pending+' 条记录正在更正，图形继续使用上次已确认版。');
 if(metric?.unitIssue)notes.push(metric.unitIssue);
 const configured=templates.find(t=>t.id===sheet);
 if(configured&&template&&templateShape(configured)!==templateShape(template))notes.push('当前模板配置已变化；本图保留原确认模板的字段、单位与公式。');
 if(purpose==='stores')notes.push('门店 / 渠道没有先后顺序，采用柱状图，避免连线暗示连续关系。');
 if(!metric)notes.push(sheet==='targets'?'月目标不是每日发生量，不参与经营趋势。':'请先选择要查看的指标；自定义字段不根据名称猜测业务含义。');
 const storeNames=confirmedStoreNames(selected);
 // Each validated record has unique row IDs, all contained in the period's union.
 const sameStores=(record:OperatingSnapshot)=>record.rows.length===storeNames.size;
 const scopeGap=(record:OperatingSnapshot)=>{
  const missing=missingStores(record,storeNames).map(([,name])=>name);
  return '当日门店 / 渠道范围不完整'+(missing.length?'，缺少'+missing.join('、')+'的已确认明细':'，期间包含总数与门店分行两种口径');
 };
 const dimensionChanged=selected.some(r=>!sameStores(r));
 const hasMetric=(record:OperatingSnapshot)=>hasConfirmedMetric(record,metric);
 if(dimensionChanged)notes.push('门店 / 渠道范围有变化，缺少相同范围的日期留空，不把缺报当作0。');
 let reported=selected.length;
 let periodRatio:ChartMeasure|undefined;
 if(sheet==='targets')return {sheet,name:'月目标',metric,metrics,purpose,recommended,kind,start,end:cutoff,points,notes,reported:0,validDays:null,expected:dates.length,source,hasData:false};
 if(isSnapshot(sheet)&&purpose==='time'){
  notes.push('手工门店累计快照覆盖月初至截止整段，不能当作某一天的发生量；请选择门店对比。');
 }else if(metric&&purpose==='time'){
  for(const date of dates){
   const record=selected.find(r=>r.date===date);
   const measure=!record?{value:null,reason:'该日无已确认记录'}
    :!sameStores(record)?{value:null,reason:scopeGap(record)}
    :!hasMetric(record)?{value:null,reason:'当日确认模板尚未使用这个公式'}:chartMeasure(record.rows,metric,sheet,template);
   points.push({id:date,label:date.slice(5),...measure});
  }
  if(metric.key.startsWith('metric:')){
   if(selected.length!==dates.length)periodRatio={value:null,reason:'期间缺少已确认日表'};
   else if(dimensionChanged)periodRatio={value:null,reason:'期间门店 / 渠道范围不一致'};
   else if(!selected.every(hasMetric))periodRatio={value:null,reason:'期间部分日表尚未使用这个公式'};
   else{
    try{periodRatio=chartMeasure(selected.flatMap(record=>record.rows),metric,sheet,template);}
    catch(cause){periodRatio={value:null,reason:cause instanceof Error?cause.message:'全期分子或分母无法核对'};}
   }
  }
 }else if(metric){
  const snapshot=isSnapshot(sheet)?selected.find(r=>r.date===cutoff):undefined,history=isSnapshot(sheet)?snapshot?[snapshot]:[]:selected;
  const ids=[...new Set(history.flatMap(r=>r.rows.map(row=>row.storeId)))];
  // "all" is a known aggregate, never a fictional store or channel.
  if(ids.length===1&&ids[0]==='all')notes.push('只有项目 / 平台总数，无法反推门店或渠道；请选择日期走势。');
  else for(const id of ids.filter(id=>id!=='all')){
   const rows=history.flatMap(r=>r.rows.filter(row=>row.storeId===id)),complete=isSnapshot(sheet)?!!snapshot:history.length===dates.length&&history.every(r=>r.rows.some(row=>row.storeId===id));
   const measure=!complete?{value:null,reason:'区间缺日或门店缺报，累计值暂不绘制'}:history.every(hasMetric)?chartMeasure(rows,metric,sheet,template):{value:null,reason:'区间内有已确认模板尚未使用这个公式'};
   points.push({id,label:rows.at(-1)?.storeName||id,...measure});
   if(new Set(rows.map(row=>row.storeName)).size>1)notes.push('门店 '+id+' 在区间内改名；按固定编号累计，显示最后确认名称。');
  }
  if(isSnapshot(sheet)){reported=snapshot?1:0;notes.push(snapshot?'采用 '+cutoff+' 已确认手工月初累计快照，仅用于整段门店对比。':'截止日没有已确认手工累计快照，不能用其他日期替代。');}
 }
 if(points.some(p=>p.value===null))notes.push('空白与缺日保留断点；真实0会显示为0。');
 if(metric?.format==='percent'||metric?.format==='ratio'||metric?.key.startsWith('metric:'))notes.push('比率和成本按完整分子、分母分别合计后计算，不平均每日或门店比率。');
 const validDays=source==='daily'&&purpose==='time'&&metric?points.filter(point=>point.value!==null).length:null;
 return {sheet,name:template?.name||names[sheet]||sheet,metric,metrics,purpose,recommended,kind,start,end:cutoff,points,periodRatio,notes:[...new Set(notes)],reported,validDays,expected:isSnapshot(sheet)?1:dates.length,source,hasData:points.some(p=>p.value!==null)};
}
