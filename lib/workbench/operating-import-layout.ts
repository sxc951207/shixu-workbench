import {matchImportStore} from './operating-store-match.ts';
import type{OperatingStore}from'../../cloud/company/operating-model.ts';
import{operatingDate,parseOperatingInput}from'./operating-data.ts';
import{assertOperatingYuanUnit}from'./operating-field-dictionary.ts';
import{checkTitleDate,hasOperatingTitleRange}from'./operating-paste.ts';
export type RevenueColumnContext={date:string;stores:OperatingStore[];storeAliases?:ReadonlyMap<string,string>;targetMonth?:string};
export type RevenueMonthlyTargets={date:string;rows:{storeId:string;storeName:string;target:number|null}[]};
export class TargetMonthNeeded extends Error{
 readonly months:string[];
 constructor(months:Set<string>){
  super(months.size?'原表涉及多个业务月份，请按月核对并选择目标所属月份。':'原表没有明确的业务月份，请选择目标所属月份。');
  this.months=[...months].sort();
 }
}
export function operatingImportDate(value:unknown,reference?:string){
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw Error('日期无效');return operatingDate(value.toISOString().slice(0,10));}
 const raw=String(value??'').trim();
 const midnight=/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0{1,3})?Z$/.exec(raw);
 if(midnight)return operatingDate(midnight[1]);
 let m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
 if(m)return operatingDate(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
 m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);if(m)return operatingDate(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`);
 const chinese=/^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日$/.exec(raw);
 if(chinese){const year=chinese[1]||reference?.match(/^(\d{4})-\d{2}-\d{2}$/)?.[1];if(year)return operatingDate(year+'-'+chinese[2].padStart(2,'0')+'-'+chinese[3].padStart(2,'0'));}
 throw Error('日期列存在无法识别的值，请使用完整年月日');
}
function checkRevenueCaption(title:string,date:string){
 if(title.length>1000)throw Error('标题过长，请只保留本次表格的标题');assertOperatingYuanUnit(title);
 if(/累计|截至|截止|周报|月报|本月|本周|区间|日期范围|时间范围|\b(?:cumulative|mtd|ytd|until|through)\b|month.to.date|\bas\s+of\b|weekly\s+report|monthly\s+report/i.test(title))throw Error('累计或范围标题不能当作当日业绩，请改用对应累计报表');
 const pattern=/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g,dates=[...title.matchAll(pattern)];
 if(dates.length)checkTitleDate(title,date,'revenue');
 if(dates.length>1)throw Error('标题包含日期范围，不能转为单日业绩');
 if(dates.length===1&&operatingDate(`${dates[0][1]}-${dates[0][2].padStart(2,'0')}-${dates[0][3].padStart(2,'0')}`)!==date)throw Error('标题日期与所选业务日期不符');
 const monthPattern=/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/g;
 if(hasOperatingTitleRange(title.replace(pattern,'DATE').replace(monthPattern,'DATE')))throw Error('标题范围缺少完整起止日期，请核对后再导入');
 let remainder=title.replace(pattern,'');remainder=remainder.replace(monthPattern,(_,year,month)=>{if(year&&year!==date.slice(0,4)||Number(month)!==Number(date.slice(5,7)))throw Error('标题年份或月份与所选日期不符');return'';});
 if(/\d/.test(remainder))throw Error('标题日期无法核对，请补全或核对标题日期');
}
const label=(value:unknown)=>String(value??'').trim();
const dateHeading=/^(日期|业务日期|统计日期|数据日期|发生日期|成交日期|填报日期|date)$/i;
const summaryColumns=new Set(['合计','总计','小计','汇总','月总业绩目标','月总目标','月业绩指标','月业绩目标','月目标','业绩合计','总业绩合计','应完成率','累计完成率']);
const nonDailyRows=new Set([...summaryColumns,'每日业绩']);
const targetHeadings=new Set(['月业绩指标','月业绩目标','月目标','月总业绩目标','月总目标']);
const dimensionHeading=/^(?:门店(?:名称|全称|名|编号)?|店名|范围|渠道(?:名称)?|账号(?:名称)?|店铺(?:名称)?|项目|store(?:name|id)?)$/i;
const revenueHeading=/^(?:(?:门店)?总业绩|营业额|业绩)(?:[（(]元[)）])?$/;

export function findRevenueStoreHeader(matrix:unknown[][],context:RevenueColumnContext,selectedHeader?:number){
 const candidates=selectedHeader===undefined?matrix.slice(0,30).map((_,i)=>i):[selectedHeader];
 for(const index of candidates){
  const row=matrix[index]?.map(label);
  if(!row||!dateHeading.test(row[0])||row.slice(1).some(v=>dimensionHeading.test(v)))continue;
  const columns=row.slice(1).filter(v=>v&&!summaryColumns.has(v));
  const hasStore=columns.some(v=>{
   if(/(?:店|分院|院区)[）)]?$/.test(v))return true;
   try{matchImportStore(v,context.stores,context.storeAliases);return true;}catch{return false;}
  });
  const hasTargetRow=matrix.slice(index+1,index+4).some(row=>targetHeadings.has(label(row[0])));
  if(hasStore||columns.length>0&&hasTargetRow&&!columns.some(v=>revenueHeading.test(v)))return index;
 }
 return -1;
}

function readRevenueSource(matrix:unknown[][],headerRow:number,reference:string){
 if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=matrix.length||matrix.length>5000)throw Error('请选择正确表头行，表格最多5000行');
 const header=matrix[headerRow]?.map(label);
 if(!header||header.length<2||header.length>60||!dateHeading.test(header[0]))throw Error('横排总业绩表首列须为日期，其余列为已配置门店');
 header.forEach(assertOperatingYuanUnit);
 const sourceTitle=matrix.slice(0,headerRow).flat().map(label).filter(Boolean).join(' ');
 const titleYear=/^(?:.*?\D)?(\d{4})\s*年\s*\d{1,2}\s*月/.exec(sourceTitle)?.[1];
 const dateReference=titleYear?titleYear+reference.slice(4):reference;
 const ignoredColumns=header.slice(1).filter(v=>summaryColumns.has(v));
 const storeColumns=header.flatMap((heading,index)=>index>0&&!summaryColumns.has(heading)?[{heading,index}]:[]);
 if(!storeColumns.length||storeColumns.length>30)throw Error('须包含1至30个已配置门店列');
 const rows=new Map<string,unknown[]>(),filledDates:string[]=[],skippedNonDailyRows=new Set<string>(),targetRows:unknown[][]=[];
 for(const row of matrix.slice(headerRow+1)){
  if(!row.some(v=>label(v)))continue;
  if(row.slice(header.length).some(v=>label(v)))throw Error('数据列数超过表头，请核对完整矩形区域');
  const heading=label(row[0]);
  const dailyHeader=row.slice(1).some(v=>label(v))&&row.slice(1).every(v=>!label(v)||['每日业绩','合计'].includes(label(v)));
  if(targetHeadings.has(heading)&&!dailyHeader)targetRows.push(row);
  if(nonDailyRows.has(heading)||!heading&&dailyHeader){
   skippedNonDailyRows.add(heading||'每日业绩表头');continue;
  }
  const date=operatingImportDate(row[0],dateReference);
  if(rows.has(date))throw Error('业务日期 '+date+' 有重复行，请核对后仅保留一行');
  rows.set(date,row);
  if(storeColumns.some(({index})=>label(row[index])))filledDates.push(date);
 }
 return {header,sourceTitle,ignoredColumns,storeColumns,rows,filledDates:filledDates.sort(),skippedNonDailyRows:[...skippedNonDailyRows],targetRows};
}

export function revenueSourceDates(matrix:unknown[][],headerRow:number,reference:string){
 return readRevenueSource(matrix,headerRow,reference).filledDates;
}

function revenueValue(cell:unknown){
 // Some Chinese workbooks contain a full-width comma or a space after each grouping separator.
 if(typeof cell==='string'&&/^\d{1,3}(?:[,，][ \u00a0]*\d{3})+(?:\.\d{1,2})?$/.test(cell.trim()))return cell.trim().replace(/[,，][ \u00a0]*/g,',');
 return cell??null;
}

type ConfirmedRevenueContext=RevenueColumnContext&{confirmedDaily:boolean};
function monthlyTargets(source:Pick<ReturnType<typeof readRevenueSource>,'header'|'targetRows'>,columns:{index:number;store:OperatingStore}[],months:Set<string>,chosenMonth?:string):RevenueMonthlyTargets|undefined{
 if(source.targetRows.length>1)throw Error('同一张表有多行月业绩目标，请核对后保留一行');
 const targetRow=source.targetRows[0];
 if(!targetRow)return;
 const rows=columns.map(({index,store})=>{
  try{return {storeId:store.id,storeName:store.name,target:parseOperatingInput(label(revenueValue(targetRow[index])),'money')};}
  catch{throw Error(store.name+'的月目标金额无效，请核对千分位和小数位');}
 });
 const totalCols=source.header.flatMap((h,i)=>['合计','总计','月总业绩目标','月总目标'].includes(h)?[i]:[]);
 const sum=rows.reduce((total,r)=>total+BigInt(r.target??0),BigInt(0));
 for(const i of totalCols){
  const total=parseOperatingInput(label(revenueValue(targetRow[i])),'money');
  if(total!==null&&BigInt(total)!==sum)throw Error('已填写门店月目标之和与源表总目标不符，请核对目标行');
 }
 if(rows.every(r=>r.target===null))return;
 const month=months.size===1?[...months][0]:chosenMonth;
 if(!month||months.size&&!months.has(month))throw new TargetMonthNeeded(months);
 const date=operatingDate(month+'-01');
 return {date,rows};
}
function mappedStoreColumns(source:Pick<ReturnType<typeof readRevenueSource>,'storeColumns'>,context:RevenueColumnContext){
 const seen=new Set<string>();
 return source.storeColumns.map(({heading,index})=>{
  if(dimensionHeading.test(heading)||revenueHeading.test(heading)||/金额|完成率|累计|目标|指标|每日业绩|合计|汇总/.test(heading))throw Error('未知门店列「'+heading+'」可能是指标或汇总，请核对门店表头');
  const store=matchImportStore(heading,context.stores,context.storeAliases);
  if(seen.has(store.id))throw Error('重复门店列：'+store.name);
  seen.add(store.id);return {index,store};
 });
}

export function extractStoreTargets(matrix:unknown[][],headerRow:number,context:RevenueColumnContext){
 operatingDate(context.date);
 const header=matrix[headerRow]?.map(label);
 if(!header?.length||!dateHeading.test(header[0]))throw Error('请核对门店表头。');
 header.forEach(assertOperatingYuanUnit);
 const storeColumns=header.flatMap((heading,index)=>index>0&&!summaryColumns.has(heading)?[{heading,index}]:[]);
 const columns=mappedStoreColumns({storeColumns},context);
 const data=matrix.slice(headerRow+1),targetRows=data.filter(row=>targetHeadings.has(label(row[0]))&&row.slice(1).some(v=>label(v)&&!['每日业绩','合计'].includes(label(v))));
 const caption=matrix.slice(0,headerRow).flat().map(label).join(' ');assertOperatingYuanUnit(caption);
 const printed=[...caption.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/g)];
 const months=new Set<string>();
 for(const [,year,month] of printed)months.add(operatingDate((year||context.date.slice(0,4))+'-'+month.padStart(2,'0')+'-01').slice(0,7));
 if(!months.size){
  for(const row of data){
   // A goal-only import can also contain blank dates, captions and footers.
   try{months.add(operatingImportDate(row[0],context.date).slice(0,7));}catch{continue;}
  }
 }
 const result=monthlyTargets({header,targetRows},columns,months,context.targetMonth);
 if(!result)throw Error('没有读到门店月目标金额，请核对原表中的月业绩指标行。');
 return result;
}

function transposeDays(matrix:unknown[][],headerRow:number,context:ConfirmedRevenueContext,selectedDates?:string[],allowBlankDay=false){
 operatingDate(context.date);
 if(!context.confirmedDaily)throw Error('请确认所选日期行是当日发生额，不是月累计');
 const source=readRevenueSource(matrix,headerRow,context.date);
 const columns=mappedStoreColumns(source,context);
 const dates=selectedDates??source.filledDates;
 if(!dates.length)throw Error('没有含门店业绩的日期行，请核对源表');
 const filled=new Set(source.filledDates),output:unknown[][]=[['日期','门店','总业绩']];
 for(const date of dates){
  operatingDate(date);
  const row=source.rows.get(date);
  if(!row)throw Error('没有所选业务日期 '+date+' 的行，不能取其他日期代替');
  if(!allowBlankDay&&!filled.has(date))throw Error(date+' 的门店业绩全部未填，请核对源表');
  checkRevenueCaption(source.sourceTitle,date);
  for(const {index,store} of columns)output.push([date,store.name,revenueValue(row[index])]);
 }
 const targets=allowBlankDay?undefined:monthlyTargets(source,columns,new Set([...source.rows.keys()].map(d=>d.slice(0,7))),context.targetMonth);
 return {matrix:output,headerRow:0,dates,targets,sourceTitle:source.sourceTitle,skippedOtherDates:source.rows.size-dates.length,skippedNonDailyRows:source.skippedNonDailyRows.filter(v=>!targets||!targetHeadings.has(v)),ignoredColumns:source.ignoredColumns};
}

export function transposeRevenueDays(matrix:unknown[][],headerRow:number,context:ConfirmedRevenueContext,selectedDates?:string[]){
 return transposeDays(matrix,headerRow,context,selectedDates);
}

/** Keep the original single-day conversion contract for callers that review even a wholly blank date. */
export function transposeRevenueColumns(matrix:unknown[][],headerRow:number,context:ConfirmedRevenueContext){
 const result=transposeDays(matrix,headerRow,context,[context.date],true);
 return {...result,headerRow:1,matrix:[['填报日期 '+context.date],...result.matrix]};
}
