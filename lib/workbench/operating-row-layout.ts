import {assertOperatingYuanUnit} from './operating-field-dictionary.ts';
import {operatingImportDate} from './operating-import-layout.ts';

const label=(cell:unknown)=>String(cell??'').trim();
const metricAxis=/^(指标|指标名称|业务指标|统计指标)$/;
const dateHeader=/^(?:日期|业务日期|填报日期|统计日期|数据日期|发生日期|成交日期|date)$/i;
const looksDated=(cell:unknown)=>cell instanceof Date||/^\d{1,4}\s*[-/年月]\s*\d/.test(label(cell));

/** Locate stacked daily tables only when a header is followed by dated records. */
export function dailyReportSections(rows:unknown[][]){
 const groups:{start:number;header:number;end:number;title:string}[]=[];
 let previous='';
 for(let i=0;i<rows.length;i++){
  const labels=rows[i].map(label),date=labels.findIndex(s=>dateHeader.test(s));
  if(date<0||labels.filter(Boolean).length<2)continue;
  const next=rows.slice(i+1,i+4).find(r=>r.some(v=>label(v)));
  if(!next||!looksDated(next[date]))continue;
  if(labels.some((s,c)=>c!==date&&dateHeader.test(s)&&looksDated(next[c])))
   throw Error('这一行里有两组日期和明细。请将左右两张表分别截图，或在 Excel 中分成两个工作表后上传。');
  let start=i;
  while(start>0){
   const nonempty=rows[start-1].map(label).filter(Boolean);
   if(nonempty.length>1||nonempty.length===1&&(!/^[^\d]/.test(nonempty[0])||/合计|小计|汇总行/.test(nonempty[0])))break;
   start--;
  }
  const title=rows.slice(start,i).flat().map(label).filter(Boolean).join(' ');
  const signature=JSON.stringify(labels.map((s,c)=>c===date?'日期':s));
  if(previous===signature&&!title)continue;
  if(groups.length)groups[groups.length-1].end=start;
  groups.push({start:groups.length?start:0,header:i,end:rows.length,title:[title,labels.filter((s,c)=>s&&c!==date).join('、')].filter(Boolean).join(' · ')});
  previous=signature;
 }
 if(groups.length<2)return [];
 // Shared or in-section unit notes can occur outside the selected slice.
 for(const row of rows)for(const cell of row)if(typeof cell==='string')assertOperatingYuanUnit(cell);
 return groups;
}

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
