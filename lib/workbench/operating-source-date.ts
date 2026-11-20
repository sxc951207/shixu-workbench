import {platformImportField} from './operating-paste.ts';
import {operatingDate,operatingFields} from './operating-data.ts';
import {operatingImportDate} from './operating-import-layout.ts';
import {operatingLeafLabels} from './operating-template-inference.ts';
import type {OperatingSheet} from '../../cloud/company/operating-model.ts';
import {addDays} from './productivity.ts';
import {todayShanghai} from './domain.ts';

export function latestOperatingDay(now=new Date()){
 return addDays(todayShanghai(now),-1);
}

export function groupSourceRows(matrix:unknown[][],header:number,selectedDates?:ReadonlySet<string>,reference?:string){
 const labels=operatingLeafLabels(matrix,header);
 const dateIndex=labels.findIndex(label=>/^(?:日期|业务日期|填报日期|统计日期|数据日期|发生日期|成交日期|date)$/i.test(label));
 const rows=new Map<string,unknown[][]>();if(dateIndex<0)return rows;
 const prefix=matrix.slice(0,header+1),other:unknown[][]=[];
 for(const row of matrix.slice(header+1)){
  let date:string;try{date=operatingImportDate(row[dateIndex],reference);}catch{other.push(row);continue;}
  if(selectedDates&&!selectedDates.has(date))continue;
  const group=rows.get(date);if(group)group.push(row);else rows.set(date,[...prefix,row]);
 }
 // Validate unrecognized and subtotal rows once, even when the period is split.
 const first=rows.values().next().value;if(first)first.push(...other);
 return rows;
}

export function douyinScreenshotPeriod(title:string,reference:string){
 const m=/(?<![\d./-])(?:(\d{4})[-./年])?(\d{1,2})[-./月](\d{1,2})\s*[-—~至到]\s*(?:(\d{4})[-./年])?(\d{1,2})[-./月](\d{1,2})日?(?!\d)/.exec(title.trim());
 if(!m)return;
 const year=m[1]||m[4]||reference.slice(0,4);
 const start=operatingDate(year+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')),end=operatingDate((m[4]||year)+'-'+m[5].padStart(2,'0')+'-'+m[6].padStart(2,'0'));
 if(start!==end.slice(0,8)+'01')throw Error('这张图的统计范围不是当月1日至截止日，请核对原图日期。');
 return {start,end};
}
export function sourceBusinessDates(matrix:unknown[][],header:number,sheet:OperatingSheet,reference?:string,includeOptionalOnly=true){
 if(!matrix[header])return [];
 if(sheet.endsWith('-stores')){
  const title=matrix.slice(0,header).flat().join(' ');
  if(sheet==='douyin-stores'&&reference){const period=douyinScreenshotPeriod(title,reference);if(period)return [period.end];}
  const matches=[...title.matchAll(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g)];
  return matches.length===2?[operatingImportDate(matches[1].slice(1,4).join('-'))]:[];
 }
 const labels=operatingLeafLabels(matrix,header),dateCol=labels.findIndex(s=>/^(?:日期|业务日期|填报日期|统计日期|数据日期|发生日期|成交日期|date)$/i.test(s));
 if(dateCol<0)return [];
 const platform=sheet==='meituan'||sheet==='douyin';
 const fields=platform?operatingFields(sheet):[];
 const mapped=platform?labels.map(label=>platformImportField(label,sheet,fields)):[];
 const focusRequired=!includeOptionalOnly&&mapped.some(field=>field?.required);
 const inputs=mapped.flatMap((field,i)=>field&&(!focusRequired||field.required)?[i]:[]);
 // Custom reports can contain unmapped inputs. Check those as well as known fields,
 // while ignoring the weekday and failed computed ratios on prefilled calendar rows.
 const customColumns=sheet.startsWith('tpl_')?labels.flatMap((label,i)=>
  label&&i!==dateCol&&!/^(?:周|星期|周次|星期几|门店|门店名称|渠道|项目|备注|序号)$/.test(label)?[i]:[]):[];
 const dates=new Set<string>();
 for(const row of matrix.slice(header+1)){
  if(customColumns.length&&customColumns.every(i=>{
   const value=String(row[i]??'').trim();
   return !value||(/率|ROI|投产比/i.test(labels[i])&&value==='#DIV/0!');
  }))continue;
  if(inputs.length&&inputs.every(i=>!String(row[i]??'').trim()))continue;
  try{const d=operatingImportDate(row[dateCol],reference);dates.add(sheet==='targets'?d.slice(0,7)+'-01':d);}catch{/* Unreadable dates are checked during preview. */}
 }
 return [...dates].sort();
}
