import type {OperatingRecord,OperatingSheet,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {commonOperatingDefinition,operatingFields,operatingTemplateMetrics} from './operating-data.ts';
import {operatingTableMetrics,operatingTableTotals} from './operating-paste.ts';
import {operatingComparisonPeriods} from './operating-comparison.ts';

export type BriefPeriod='day'|'week'|'month';
const shift=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function briefDates(end:string,kind:BriefPeriod){
 if(kind==='day'){const prev=shift(end,-1);return {current:{start:end,end},previous:{start:prev,end:prev},comparable:true};}
 return operatingComparisonPeriods(end,kind);
}
export function buildOperatingBrief(records:OperatingRecord[],companyId:string,projectId:string,sheet:OperatingSheet,cutoff:string,kind:BriefPeriod,fallback?:OperatingTemplate){
 const period=briefDates(cutoff,kind);
 const confirmed=records.filter(r=>r.companyId===companyId&&r.projectId===projectId&&r.sheet===sheet)
  .flatMap(r=>{const s=r.published??r;if(s.status!=='approved')return [];
   if(s.id!==r.id||s.companyId!==companyId||s.projectId!==projectId||s.sheet!==sheet||s.date!==r.date||s.version!==r.publishedVersion)throw Error('确认版与当前记录不一致，请刷新。');
   return [s];}).sort((a,b)=>a.date.localeCompare(b.date));
 if(new Set(confirmed.map(r=>r.date)).size!==confirmed.length)throw Error('同一业务日期出现多份确认记录，请核对。');
 const select=(p:{start:string;end:string})=>confirmed.filter(r=>r.date>=p.start&&r.date<=p.end);
 const current=select(period.current),previous=select(period.previous);
 const template=commonOperatingDefinition(current)??current[0]?.template??fallback;
 if(sheet.startsWith('tpl_')&&current.length&&!commonOperatingDefinition(current))throw Error('本期指标定义发生变化，请缩小日期范围。');
 const fields=operatingFields(sheet,template).filter(f=>f.kind!=='stars');
 const storeScope=(rows:typeof current)=>new Set(rows.map(r=>JSON.stringify(r.rows.map(x=>x.storeId).sort())));
 const dates=(range:{start:string;end:string})=>Array.from({length:Math.round((Date.parse(range.end)-Date.parse(range.start))/86400000)+1},(_,i)=>shift(range.start,i));
 const days=dates(period.current),priorDays=dates(period.previous);
 const rows=current.flatMap(r=>r.rows);
 const totals=operatingTableTotals(rows,fields,true);
 const complete=current.length===days.length&&storeScope(current).size===1;
 const comparable=period.comparable&&complete&&previous.length===priorDays.length&&storeScope([...current,...previous]).size===1&&(!template||!!commonOperatingDefinition([...current,...previous]));
 const priorTotals=comparable?operatingTableTotals(previous.flatMap(r=>r.rows),fields,true):{};
 const byDay=new Map(current.map(r=>[r.date,operatingTableTotals(r.rows,fields,true)]));
 const stores=new Map<string,{name:string;days:number;rows:typeof rows}>();
 for(const r of current)for(const row of r.rows){
  if(row.storeId==='all')continue;
  const s=stores.get(row.storeId)??{name:row.storeName,days:0,rows:[]};s.rows.push(row);s.days++;s.name=row.storeName;stores.set(row.storeId,s);
 }
 const details=[...stores].map(([id,s])=>({id,name:s.name,days:s.days,values:operatingTableTotals(s.rows,fields,true)}));
 const metricSheet=sheet==='meituan'||sheet==='douyin'?sheet+'-stores' as OperatingSheet:sheet;
 const metrics=complete?(template?operatingTemplateMetrics(template,totals):operatingTableMetrics(metricSheet,totals)): [];
 return {current,fields,metrics,totals,priorTotals,comparable,complete,days,byDay,details,period,missing:days.filter(d=>!byDay.has(d))};
}
