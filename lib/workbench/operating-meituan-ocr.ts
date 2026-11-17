import {operatingImportDate} from './operating-import-layout.ts';

export const meituanDailyColumns=[
 {index:2,label:'下单金额',money:true},{index:3,label:'核销金额',money:true},
 {index:4,label:'核销券数'},{index:5,label:'下单券数'},
 {index:7,label:'退款金额',money:true},{index:8,label:'退款订单数'},
 {index:10,label:'自然曝光'},{index:11,label:'付费曝光'},{index:13,label:'咨询数'},
 {index:14,label:'线索数'},{index:15,label:'推广花费',money:true}
] as const;
export function meituanDayCandidate(rows:string[][],date:string){
 const found=rows.map((row,index)=>({row,index})).filter(({row})=>{
  if(row.length!==18)return false;
  try{return operatingImportDate(row[0])===date;}catch{return false;}
 });
 if(found.length!==1)return null;
 const {row,index}=found[0];
 return {index,values:meituanDailyColumns.map(field=>meituanCellValue(row[field.index],'money' in field))};
}
export function verifiedMeituanCell(first:string,second:string,money:boolean){
 const value=meituanCellValue(second,money),initial=meituanCellValue(first,money);
 if(!value)return '';
 if(initial)return initial===value?value:'';
 return money&&/^\d+$/.test(first.trim())&&first.trim()===value.replace('.','')?value:'';
}
export function meituanCellValue(text:string,money:boolean){
 const value=text.trim();
 if(money)return /^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(value)?value.replaceAll(',',''):'';
 return /^\d+(?:\.0+)?$/.test(value)?value.split('.')[0]:'';
}

export function checkPrintedWeekday(date:string, weekday:string, before:string, after:string){
 const match=/^(?:星期|周)([日天一二三四五六])$/.exec(weekday.trim());
 if(!match||!/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
 const expected='日一二三四五六'.indexOf(match[1].replace('天','日'));
 if(new Date(date+'T00:00:00Z').getUTCDay()===expected)return date;
 const previous=Date.parse(before+'T00:00:00Z'),next=Date.parse(after+'T00:00:00Z');
 if(Number.isFinite(previous)&&next-previous===2*86400000){
  const middle=new Date(previous+86400000),candidate=middle.toISOString().slice(0,10);
  const observedMonth=String(Number(date.slice(5,7))),candidateMonth=String(Number(candidate.slice(5,7)));
  if(middle.getUTCDay()===expected&&candidate.slice(0,4)===date.slice(0,4)&&candidate.slice(8)===date.slice(8)&&candidateMonth.length===2&&observedMonth.length===1&&candidateMonth.endsWith(observedMonth))return candidate;
 }
 return date+'（请核对星期）';
}

/** Only collapse a recognized platform-wide daily sheet when every input column and row is accounted for. */
export function meituanDailyPreview(rows:string[][],header:number){
 const headings=rows[header],dateColumn=headings?.indexOf('日期');
 if(!headings||headings.length!==18||dateColumn<0||headings.some(h=>/^(?:门店|店铺|渠道)(?:名称)?$/.test(h)))return null;
 const columns=meituanDailyColumns.map(f=>headings.indexOf(f.label));
 if(columns.some((c,i)=>c<0||headings.lastIndexOf(meituanDailyColumns[i].label)!==c))return null;
 const matrix=[['日期','范围',...meituanDailyColumns.map(f=>f.label)]],dates=new Set<string>();
 for(const row of rows.slice(header+1)){
  const date=row[dateColumn]?.trim();
  if(/^(?:月度|合计|总计|小计|第[一二三四五六七八九十\d]+周(?:合计)?)$/.test(date))continue;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||dates.has(date))return null;
  dates.add(date);
  matrix.push([date,'全平台',...columns.map((c,i)=>meituanCellValue(row[c]||'','money' in meituanDailyColumns[i]))]);
 }
 return dates.size?matrix:null;
}
