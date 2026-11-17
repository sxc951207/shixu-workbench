import{todayShanghai}from'./domain.ts';
import{operatingComparisonPeriods,buildOperatingComparison,type PreparedOperatingComparison}from'./operating-comparison.ts';
import type{OperatingRecord}from'../../cloud/company/operating-model.ts';
import {reportPeriod,type ReportPeriod} from './report-period.ts';
import {isComparisonSnapshot} from './report-comparison.ts';
type Filter={companyId:string;projectId:string;cutoff:string;mode?:'month'|'week'};
type ReasonFilter=Pick<PreparedOperatingComparison,'companyId'|'projectId'|'periods'|'revision'>;
export type ComparisonReason={text:string;version:number;confirmedAt:string};
export function comparisonReasonPeriod(periods:ReasonFilter['periods']):ReportPeriod|null{
 const period=reportPeriod(periods.mode==='week'?'weekly':'monthly',periods.current.end);
 return period.start===periods.current.start&&period.end===periods.current.end?period:null;
}
/** A project report can explain only its complete natural period at the selected company revision. */
export async function loadOperatingComparisonReason(request:(body:any)=>Promise<any>,filter:ReasonFilter):Promise<ComparisonReason|null>{
 const period=comparisonReasonPeriod(filter.periods);
 if(!period)throw Error('项目变化说明仅适用于完整周或整月');
 const response=await request({action:'report.list',companyId:filter.companyId,projectId:filter.projectId,scope:'summary',revision:filter.revision,page:0,kind:period.kind,periodDate:period.end});
 if(response?.companyRevision!==filter.revision)throw Error('确认版本已变化，请重新打开数字对比');
 if(response.period?.kind!==period.kind||response.period.start!==period.start||response.period.end!==period.end||response.page!==0||![0,1].includes(response.total)||!Array.isArray(response.reports)||response.reports.length!==response.total)throw Error('项目报表范围无法核对');
 if(!response.total)return null;
 const report=response.reports[0];
 if(!isComparisonSnapshot(report,filter.companyId,filter.projectId,period))throw Error('项目、周期或确认版本无法核对');
 return report.changeReason?.trim()?{text:report.changeReason.trim(),version:report.version,confirmedAt:report.updatedAt}:null;
}
/** All pages of both periods share the first response's revision and approved scope. */
export async function loadOperatingComparison(request:(body:any)=>Promise<any>,filter:Filter):Promise<PreparedOperatingComparison>{
 const periods=operatingComparisonPeriods(filter.cutoff,filter.mode);if(filter.cutoff>todayShanghai())throw Error('不能对比未来日期的经营数据');
 const records:OperatingRecord[]=[],ids=new Set<string>();let revision:number|undefined,projectName='',pendingChanges=0;
 const months=new Set<string>();for(const period of[periods.current,periods.previous]){
  for(let month=period.start.slice(0,7);month<=period.end.slice(0,7);){
   months.add(month);const[y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  }
 }
 for(const month of months){
  let page=0,total:number|undefined;
  do{
   const result=await request({action:'ops.month',companyId:filter.companyId,projectId:filter.projectId,month,scope:'summary',page,...(revision===undefined?{}:{revision})});
   if(result.project?.id!==filter.projectId||typeof result.project?.name!=='string'||!result.project.name.trim())throw Error('对比项目无法核对，请重新读取');
   if(!Number.isSafeInteger(result.companyRevision)||result.companyRevision<0)throw Error('对比版本无法核对');
   if(revision!==undefined&&result.companyRevision!==revision)throw Error('读取期间数据已变化，请重新读取两期');
   revision=result.companyRevision;if(!projectName)projectName=result.project.name;
   if(!Number.isSafeInteger(result.total)||result.total<0||result.total>40000||result.page!==page||!Array.isArray(result.records)||result.records.length!==Math.min(20,Math.max(0,result.total-page*20)))throw Error('对比分页内容不完整，请重新读取');
   if(total!==undefined&&result.total!==total)throw Error('读取期间数据已变化，请重新读取两期');total=result.total;
   const next=(page+1)*20<result.total?page+1:null;if(result.nextPage!==next)throw Error('对比分页进度异常，请重新读取');
   const pending=result.pendingChanges??0;if(!Number.isSafeInteger(pending)||pending<0||pending>result.records.length)throw Error('确认状态无法核对');pendingChanges+=pending;
   for(const record of result.records){if(typeof record.id!=='string'||!record.id||ids.has(record.id))throw Error('对比记录重复，请重新读取');if(typeof record.date!=='string'||record.date.slice(0,7)!==month)throw Error('对比日期范围无法核对');ids.add(record.id);records.push(record);}
   if(next===null)break;page=next;
  }while(page<2000);
 }
 if(revision===undefined)throw Error('对比数据尚未完整读取');
 return{...buildOperatingComparison(records,periods,{companyId:filter.companyId,projectId:filter.projectId,projectName}),revision,preparedAt:new Date().toISOString(),pendingChanges};
}
