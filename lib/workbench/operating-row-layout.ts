import {operatingImportDate} from './operating-import-layout.ts';

const label=(cell:unknown)=>String(cell??'').trim();
const metricAxis=/^(指标|指标名称|业务指标|统计指标)$/;
const dateHeader=/^(?:日期|业务日期|填报日期|统计日期|数据日期|发生日期|成交日期|date)$/i;
const looksDated=(cell:unknown)=>cell instanceof Date||/^\d{1,4}[-/年月]\d/.test(label(cell));

/** Normalize only explicitly labelled daily axes. Keep the source units and title for validation. */
export function normalizeDailyReportRows(rows:unknown[][],header:number,reference:string){
 const axis=rows.slice(0,30).findIndex(row=>metricAxis.test(label(row[0]))&&row.slice(1).some(looksDated));
 if(axis<0){
  const labels=rows[header]?.map(label);
  if(!labels?.some(v=>dateHeader.test(v))||labels.filter(Boolean).length<2)return {rows,header};
  const distinct=rows.filter((row,index)=>index<=header||row.length!==labels.length||row.some((cell,i)=>label(cell)!==labels[i]));
  return {rows:distinct.length===rows.length?rows:distinct,header};
 }
 const prefix=rows.slice(0,axis);
 if(prefix.some(row=>row.some(cell=>dateHeader.test(label(cell))||looksDated(cell)||typeof cell==='number')))throw Error('同页包含多组数据或日期，请先拆分横排日期表。');
 const days=new Map<string,number>(),head=rows[axis];
 const metrics=rows.slice(axis+1).filter(row=>row.some(cell=>label(cell)));
 if(!metrics.length||metrics.length>59)throw Error('横排日期表须有1至59行指标，请按业务拆分。');
 for(let col=1;col<head.length;col++){
  const cell=head[col],text=label(cell);
  if(/^(?:合计|总计|小计|汇总)$/.test(text))continue;
  if(!text&&metrics.every(row=>!label(row[col])))continue;
  let day:string;
  try{day=operatingImportDate(cell,reference);}catch{throw Error('横排日期表第'+(col+1)+'列「'+(text||'空白')+'」不是可确定的业务日期，请核对原表。');}
  if(days.has(day))throw Error('横排日期表包含重复业务日期 '+day+'，请区分来源后导入。');
  days.set(day,col);
 }
 const names=new Set<string>();
 for(const row of metrics){
  const name=label(row[0]);
  if(!name)throw Error('横排日期表有数值缺少指标名称，请先补全。');
  if(names.has(name))throw Error('横排日期表有重复指标「'+name+'」，请区分来源后导入。');
  if(row.slice(head.length).some(cell=>label(cell)))throw Error('横排日期表有数值超出日期列，请补全原表表头。');
  names.add(name);
 }
 return {header:axis,rows:[...prefix,['日期',...names],...Array.from(days,([day,col])=>[day,...metrics.map(row=>row[col]??null)])]};
}
