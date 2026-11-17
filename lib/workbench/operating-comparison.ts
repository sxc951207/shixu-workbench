import type{OperatingRecord,OperatingSheet,OperatingTemplate}from'../../cloud/company/operating-model.ts';
import{commonOperatingDefinition,operatingDate,operatingFields,operatingRecordSchema,operatingSummary,operatingTemplateMetrics}from'./operating-data.ts';
import{operatingTableMetrics,operatingTableTotals}from'./operating-paste.ts';

export type ComparisonPeriod={start:string;end:string};
export type OperatingComparisonPeriods={current:ComparisonPeriod;previous:ComparisonPeriod;mode:'same-day'|'full-month'|'week';comparable:boolean;reason:string};
export type ComparisonFormat='moneyCents'|'money'|'count'|'stars'|'percent'|'ratio';
type ColumnDefinition={key:string;label:string;format:ComparisonFormat;definition:string;dependencies:string[];unitIssue?:string};
export type ComparisonColumn=ColumnDefinition&{currentLabel:string|null;previousLabel:string|null;currentDefinition:string|null;previousDefinition:string|null};
export type ComparisonCell={key:string;current:number|null;previous:number|null;currentFormat:ComparisonFormat;previousFormat:ComparisonFormat;currentComplete:boolean;previousComplete:boolean;difference:number|null;changeRatio:number|null;changeNote:string;reasons:string[];roundedDifference?:string;roundedChangePercent?:string};
export type ComparisonRow={id:string;name:string;previousName:string;cells:ComparisonCell[]};
type Coverage={reported:number;expected:number;missingDates:string[];source:string};
export type ComparisonSheet={sheet:OperatingSheet;name:string;columns:ComparisonColumn[];total:ComparisonRow;rows:ComparisonRow[];currentCoverage:Coverage;previousCoverage:Coverage;notes:string[]};
export type OperatingComparison={companyId:string;projectId:string;projectName:string;periods:OperatingComparisonPeriods;sheets:ComparisonSheet[]};
export type PreparedOperatingComparison=OperatingComparison&{revision:number;preparedAt:string;pendingChanges:number};
const sheetNames:Record<string,string>={revenue:'门店总业绩',meituan:'美团平台总盘',douyin:'抖音平台总盘','meituan-stores':'美团门店累计','douyin-stores':'抖音门店累计'};
const endOfMonth=(date:string,offset=0)=>{const[y,m]=date.slice(0,7).split('-').map(Number);return new Date(Date.UTC(y,m+offset,0)).toISOString().slice(0,10);};
export function operatingComparisonPeriods(cutoff:string,mode:'month'|'week'='month'):OperatingComparisonPeriods{
 operatingDate(cutoff);
 if(mode==='week'){
  const date=new Date(cutoff+'T00:00:00Z'),weekday=(date.getUTCDay()+6)%7,shift=(days:number)=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
  const current={start:shift(-weekday),end:cutoff},previous={start:shift(-weekday-7),end:shift(-7)};
  if(previous.start<'1970-01-01')throw Error('首个统计周没有可读取的上期数据');
  return{current,previous,mode:'week',comparable:true,reason:''};
 }
 const current={start:cutoff.slice(0,7)+'-01',end:cutoff},priorEnd=endOfMonth(cutoff,-1);
 if(priorEnd<'1970-01-01')throw Error('首个统计月没有可读取的上期数据');
 const full=cutoff===endOfMonth(cutoff),day=Number(cutoff.slice(8)),priorDays=Number(priorEnd.slice(8)),previous={start:priorEnd.slice(0,7)+'-01',end:full?priorEnd:priorEnd.slice(0,8)+String(Math.min(day,priorDays)).padStart(2,'0')},comparable=full||day<=priorDays;
 return{current,previous,mode:full?'full-month':'same-day',comparable,reason:comparable?'':'上月没有同日，两个区间天数不同，暂不计算涨跌'};
}
const metrics=(sheet:OperatingSheet,values:Record<string,number|null>,template?:OperatingTemplate)=>template?operatingTemplateMetrics(template,values):operatingTableMetrics(sheet==='meituan'||sheet==='douyin'?(sheet+'-stores')as OperatingSheet:sheet,values);
type Side={sheet:OperatingSheet;summary:ReturnType<typeof operatingSummary>;records:OperatingRecord[];template?:OperatingTemplate;inconsistent:boolean};
const varyingScope=(s:Side)=>new Set(s.records.map(r=>JSON.stringify(r.rows.map(row=>row.storeId).sort()))).size>1;
function side(records:OperatingRecord[],sheet:OperatingSheet,p:ComparisonPeriod,week=false):Side{
 const selected=records.filter(r=>r.sheet===sheet&&r.date>=p.start&&r.date<=p.end),common=commonOperatingDefinition(selected),inconsistent=!common&&selected.some(r=>r.template);
 // A period with changing definitions has no valid aggregate, even if its days are present.
 const summary=operatingSummary(inconsistent?[]:records,sheet,p.end,week?{start:p.start}:undefined);
 if(inconsistent){summary.daysReported=selected.length;summary.missingDates=summary.missingDates.filter(date=>!selected.some(r=>r.date===date));}
 const source=sheet.endsWith('-stores')&&summary.source==='daily'?records.filter(r=>r.sheet===sheet.replace('-stores','')&&r.date>=p.start&&r.date<=p.end):summary.source==='snapshot'?selected.filter(r=>r.date===p.end):selected;
 return{sheet,summary,records:source,template:common||selected[0]?.template,inconsistent};
}
const coverage=(s:Side):Coverage=>({reported:s.summary.daysReported,expected:s.summary.daysExpected,missingDates:s.summary.missingDates,source:s.summary.source==='snapshot'?'手工累计快照':s.summary.source==='daily'?'逐日门店明细':'逐日记录'});
function columns(sheet:OperatingSheet,template?:OperatingTemplate):ColumnDefinition[]{
 const fields=operatingFields(sheet,template),raw:ColumnDefinition[]=fields.map(f=>({key:f.key,label:f.label,format:f.kind==='money'?'moneyCents':f.kind,definition:f.definition||'',dependencies:[f.key]}));
 const dependencies:Record<string,string[]>={verificationRate:['verifiedCoupons','orderedCoupons'],refundRate:['refundOrders','orderedCoupons'],positiveRate:['positiveReviews','verifiedCoupons'],verifiedRoi:['verifiedAmount','adSpend'],orderRoi:['orderAmount','adSpend']};
 return[...raw,...metrics(sheet,{},template).map(m=>{
  const formula=template?.metrics.find(metric=>metric.key===m.key);
  const keys=formula?[formula.numerator,formula.denominator]:dependencies[m.key]||[];
  const [numerator,denominator]=keys.map(key=>fields.find(f=>f.key===key)?.label);
  const definition=numerator&&denominator?numerator+'合计 ÷ '+denominator+'合计':'先合计完整的分子与分母再计算';
  return{key:'metric:'+m.key,label:m.label,format:m.format,definition,dependencies:keys,...('unitIssue' in m&&typeof m.unitIssue==='string'?{unitIssue:m.unitIssue}:{})};
 })];
}
function rowValues(s:Side,sheet:OperatingSheet,id:string){
 const descriptors=operatingFields(sheet,s.template),row=s.summary.rows.find(r=>r.storeId===id),total=id==='total';
 if(total){
  const totals=operatingTableTotals(s.summary.rows,descriptors);
  if(s.summary.sharedAdSpend!==undefined)totals.adSpend=s.summary.sharedAdSpend;
  return totals;
 }
 return row?.values||Object.fromEntries(descriptors.map(f=>[f.key,null]));
}
function fieldComplete(s:Side,key:string,id:string):boolean{
 if(id==='total')return !varyingScope(s)&&s.summary.rows.length>0&&
  (!s.summary.incompleteFields.includes(key)||key==='adSpend'&&s.summary.sharedAdSpend!==undefined);
 const row=s.summary.rows.find(r=>r.storeId===id);if(!row||row.values[key]==null)return false;
 // Store ratings are observations on the cutoff day, so prior missing ratings cannot dilute them.
 if(s.sheet==='meituan-stores'&&key==='stars')return true;
 if(s.summary.source==='snapshot')return true;
 if(s.records.length!==s.summary.daysExpected)return false;
 return s.records.every(r=>r.rows.some(row=>row.storeId===id&&typeof row.values[key]==='number'));
}
function values(s:Side,sheet:OperatingSheet,id:string,cols:ComparisonColumn[]){
 const raw=rowValues(s,sheet,id),safe={...raw,...Object.fromEntries(operatingFields(sheet,s.template).filter(f=>!fieldComplete(s,f.key,id)).map(f=>[f.key,null]))},derived=metrics(sheet,safe,s.template);
 const applicable=derived.filter(m=>!s.template||s.records.every(r=>r.template?.metrics.some(metric=>metric.key===m.key)));
 return new Map(cols.map(c=>[c.key,c.key.startsWith('metric:')?applicable.find(m=>'metric:'+m.key===c.key)?.value??null:raw[c.key]??null]));
}

// Round a nonnegative magnitude once, directly from integer totals, in the displayed unit.
function roundedMagnitude(numerator:bigint,denominator:bigint):string{
 const hundred=BigInt(100),absolute=numerator<BigInt(0)?-numerator:numerator;
 const hundredths=(absolute*hundred+denominator/BigInt(2))/denominator;
 return (hundredths/hundred).toLocaleString('zh-CN')+'.'+(hundredths%hundred).toString().padStart(2,'0');
}
function metricChange(column:ComparisonColumn,current:Record<string,number|null>,previous:Record<string,number|null>){
 const [numerator,denominator]=column.dependencies;
 // Caller has already checked completeness, a common formula, and nonzero denominators.
 const currentNumerator=BigInt(current[numerator]!),currentDenominator=BigInt(current[denominator]!);
 const previousNumerator=BigInt(previous[numerator]!),previousDenominator=BigInt(previous[denominator]!);
 const baseline=previousNumerator*currentDenominator;
 const delta=currentNumerator*previousDenominator-baseline,hundred=BigInt(100);
 const commonDenominator=currentDenominator*previousDenominator;
 const divisor=column.format==='money'?commonDenominator*hundred:commonDenominator;
 return {
  difference:Number(delta)/Number(divisor),changeRatio:baseline>BigInt(0)?Number(delta)/Number(baseline):null,
  roundedDifference:roundedMagnitude(column.format==='percent'?delta*hundred:delta,divisor),
  ...(baseline>BigInt(0)?{roundedChangePercent:roundedMagnitude(delta*hundred,baseline)+'%'}:{}),
 };
}
function makeRow(id:string,a:Side,b:Side,sheet:OperatingSheet,cols:ComparisonColumn[],currentColumns:Map<string,ColumnDefinition>,priorColumns:Map<string,ColumnDefinition>,baseReasons:string[],dimensionChanged:boolean):ComparisonRow{
 const ar=a.summary.rows.find(r=>r.storeId===id),br=b.summary.rows.find(r=>r.storeId===id),av=values(a,sheet,id,cols),bv=values(b,sheet,id,cols),aRaw=rowValues(a,sheet,id),bRaw=rowValues(b,sheet,id);
 const cells=cols.map(column=>{
  const current=av.get(column.key)??null,previous=bv.get(column.key)??null;
  const currentColumn=currentColumns.get(column.key),previousColumn=priorColumns.get(column.key);
  const complete=(s:Side,definition:ColumnDefinition|undefined,value:number|null)=>value!==null&&!!definition?.dependencies.length&&definition.dependencies.every(key=>fieldComplete(s,key,id));
  const currentComplete=complete(a,currentColumn,current),previousComplete=complete(b,previousColumn,previous);
  const reasons=[...baseReasons];if(id==='total'&&dimensionChanged)reasons.push('两期门店或分行范围变化，整体涨跌暂不计算');
  if(id!=='total'&&!ar)reasons.push('本期无同编号门店或分行');if(id!=='total'&&!br)reasons.push('上期无同编号门店或分行');
  const unavailable=(period:string,s:Side,raw:Record<string,number|null>,definition?:ColumnDefinition)=>{
   if(!definition)return period+'模板没有此字段或指标';
   if(definition.unitIssue)return period+' · '+definition.unitIssue;
   const denominator=definition.dependencies[1];
   if(denominator&&raw[denominator]===0&&fieldComplete(s,denominator,id))return period+'分母为0，指标不计算';
   return period+'该指标缺报、字段未齐或无法计算';
  };
  if(!currentComplete)reasons.push(unavailable('本期',a,aRaw,currentColumn));
  if(!previousComplete)reasons.push(unavailable('上期',b,bRaw,previousColumn));
  if(column.format==='stars'&&id==='total')reasons.push('星级不求合计');
  const difference=!reasons.length&&current!==null&&previous!==null?current-previous:null,changeRatio=difference!==null&&previous!==null&&previous>0?difference/previous:null;
  const derived=difference!==null&&column.key.startsWith('metric:')?metricChange(column,aRaw,bRaw):undefined;
  return{key:column.key,current,previous,currentFormat:currentColumn?.format||column.format,previousFormat:previousColumn?.format||column.format,currentComplete,previousComplete,difference,changeRatio,...derived,changeNote:difference!==null&&previous===0?'上期为0，不计算变化率':'',reasons:[...new Set(reasons)]};
 });
 return{id,name:id==='total'?'整体':ar?.storeName||br?.storeName||id,previousName:br?.storeName||'',cells};
}
export function buildOperatingComparison(records:OperatingRecord[],periods:OperatingComparisonPeriods,scope:{companyId:string;projectId:string;projectName:string}):OperatingComparison{
 const seen=new Set<string>(),ids=new Set<string>();for(const r of records){
  if(r.companyId!==scope.companyId||r.projectId!==scope.projectId)throw Error('不能比较不同公司或项目范围的数据');
  if(r.status!=='approved')throw Error('数字对比只接受已确认快照');
  const {published,...snapshot}=r;
  // Both the full API envelope and legacy flattened confirmed snapshots describe one immutable fact.
  const checked=operatingRecordSchema.safeParse({...snapshot,published:published??snapshot});
  if(!checked.success)throw Error('经营确认快照无效：'+checked.error.issues[0].message);
  const key=r.sheet+':'+r.date;
  if(seen.has(key)||ids.has(r.id))throw Error('经营事实重复或冲突，不能继续对比');
  seen.add(key);ids.add(r.id);
 }
 const eligible=records.filter(r=>r.date>=periods.current.start&&r.date<=periods.current.end||r.date>=periods.previous.start&&r.date<=periods.previous.end);
 const sheetIds=new Set(eligible.filter(r=>r.sheet!=='targets').map(r=>r.sheet));for(const platform of['meituan','douyin']as const)if(sheetIds.has(platform)&&eligible.some(r=>r.sheet===platform&&r.rows.some(row=>row.storeId!=='all')))sheetIds.add((platform+'-stores')as OperatingSheet);
 const sheets:ComparisonSheet[]=[];for(const sheet of sheetIds){
  const a=side(records,sheet,periods.current,periods.mode==='week'),b=side(records,sheet,periods.previous,periods.mode==='week'),template=a.template||b.template;
  // A missing period still uses the known definition, never a guessed same-name template.
  a.template=a.template||template;b.template=b.template||template;
  const currentColumns=new Map(columns(sheet,a.template).map(c=>[c.key,c])),priorColumns=new Map(columns(sheet,b.template).map(c=>[c.key,c]));
  const cols:ComparisonColumn[]=[...new Set([...currentColumns.keys(),...priorColumns.keys()])].map(key=>{
   const current=currentColumns.get(key),previous=priorColumns.get(key);
   return{...(current||previous!),currentLabel:current?.label??null,previousLabel:previous?.label??null,currentDefinition:current?.definition??null,previousDefinition:previous?.definition??null};
  });
  const reasons:string[]=[];
  if(!periods.comparable)reasons.push(periods.reason);
  if(a.inconsistent||b.inconsistent||template&&!commonOperatingDefinition([a,b]))reasons.push('两期字段、维度、公式或填写提示口径不同');
  if(coverage(a).source!==coverage(b).source)reasons.push('两期累计数据来源不同，请先核对口径');
  const aIds=a.summary.rows.map(r=>r.storeId).sort(),bIds=b.summary.rows.map(r=>r.storeId).sort(),scopeIds=(s:Side)=>[...new Set((sheet==='meituan'||sheet==='douyin'?s.records.flatMap(r=>r.rows):s.summary.rows).map(r=>r.storeId))].sort(),dimensionChanged=JSON.stringify(scopeIds(a))!==JSON.stringify(scopeIds(b))||varyingScope(a)||varyingScope(b),notes=[...reasons];
  if(a.inconsistent)notes.push('本期内模板字段或填写口径发生变化，该期无法累计；请按同一口径核对。');
  if(b.inconsistent)notes.push('上期内模板字段或填写口径发生变化，该期无法累计；请按同一口径核对。');
  if(dimensionChanged)notes.push('两期门店或分行范围变化；按固定编号核对同店，新门店不视为上期0。');
  const ids=[...new Set([...aIds,...bIds])].filter(id=>id!=='all');
  const row=(id:string)=>makeRow(id,a,b,sheet,cols,currentColumns,priorColumns,reasons,id==='total'&&dimensionChanged);
  sheets.push({sheet,name:template?.name||sheetNames[sheet]||sheet,columns:cols,total:row('total'),rows:ids.map(row),currentCoverage:coverage(a),previousCoverage:coverage(b),notes});
 }
 return{...scope,periods,sheets};
}
