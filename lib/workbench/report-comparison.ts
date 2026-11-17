import type {ReportSnapshot} from '../../cloud/company/model.ts';
import {todayShanghai} from './domain.ts';
import {reportPeriod,type ReportPeriod} from './report-period.ts';

export type ReportComparisonPair={projectId:string;projectName:string;current:ReportSnapshot|null;previous:ReportSnapshot|null;progressDelta:number|null;riskUnchanged:boolean};
export type ComparisonFilter={companyId:string;kind:'weekly'|'monthly';periodDate:string;projectId:string};
export type PreparedReportComparison={period:ReportPeriod;previousPeriod:ReportPeriod;pairs:ReportComparisonPair[];revision:number};
export function comparisonPeriods(kind:unknown,input:unknown):{period:ReportPeriod;previousPeriod:ReportPeriod}{
 if(kind==='daily')throw Error('请选择周报或月报进行对比');
 const period=reportPeriod(kind,input),prior=new Date(period.start+'T00:00:00Z');
 if(period.kind==='weekly')prior.setUTCDate(prior.getUTCDate()-7);else prior.setUTCMonth(prior.getUTCMonth()-1);
 return{period,previousPeriod:reportPeriod(period.kind,prior.toISOString().slice(0,10))};
}
const validProgress=(r:ReportSnapshot)=>r.status==='approved'&&Number.isInteger(r.progress)&&r.progress!==null&&r.progress>=0&&r.progress<=100;
const normalizedRisk=(s:string)=>s.replace(/\s+/gu,' ').trim();
export function buildReportComparison(current:ReportSnapshot[],previous:ReportSnapshot[]):ReportComparisonPair[]{
 const now=new Map<string,ReportSnapshot>(),before=new Map<string,ReportSnapshot>();
 for(const[reports,index]of [[current,now],[previous,before]]as const)for(const r of reports){
  if(!validProgress(r)||index.has(r.projectId))throw Error('已确认报表内容不一致，请刷新后重试');index.set(r.projectId,r);
 }
 return [...new Set([...now.keys(),...before.keys()])].map(projectId=>{
  const current=now.get(projectId)||null,previous=before.get(projectId)||null;
  return{projectId,projectName:(current||previous)!.projectName,current,previous,progressDelta:current&&previous?current.progress!-previous.progress!:null,riskUnchanged:!!(current&&previous&&normalizedRisk(current.risk)&&normalizedRisk(current.risk)===normalizedRisk(previous.risk))};
 }).sort((a,b)=>a.projectName.localeCompare(b.projectName,'zh-CN')||a.projectId.localeCompare(b.projectId));
}
export function reportWaitingDays(submittedAt:string|null|undefined,clock=new Date()):number|null{
 if(!submittedAt||!Number.isFinite(Date.parse(submittedAt))||!Number.isFinite(clock.getTime()))return null;
 return Math.max(0,Math.round((Date.parse(todayShanghai(clock))-Date.parse(todayShanghai(new Date(submittedAt))))/86400000));
}
const samePeriod=(a:any,b:ReportPeriod)=>a?.kind===b.kind&&a.start===b.start&&a.end===b.end;
export function isComparisonSnapshot(value:unknown,companyId:string,projectId:string,period:ReportPeriod):value is ReportSnapshot{
 if(!value||typeof value!=='object')return false;const r=value as ReportSnapshot;
 return (r.kind==='daily'&&r.progress===null?r.status==='approved':validProgress(r))&&r.companyId===companyId&&r.projectId===projectId&&typeof projectId==='string'&&/^p_[a-f0-9]{24}$/.test(projectId)&&samePeriod(r,period)&&typeof r.id==='string'&&/^pr_[a-f0-9]{32}$/.test(r.id)&&Number.isSafeInteger(r.version)&&r.version>0&&r.publishedVersion===r.version&&Number.isFinite(Date.parse(r.updatedAt))&&(r.changeReason===undefined||typeof r.changeReason==='string'&&r.changeReason.length<=4000)&&['projectName','achievement','risk','next','help'].every(k=>typeof r[k as keyof ReportSnapshot]==='string');
}
export async function loadReportComparison(request:(b:any)=>Promise<any>,filter:ComparisonFilter):Promise<PreparedReportComparison>{
 const{period,previousPeriod}=comparisonPeriods(filter.kind,filter.periodDate),pairs:ReportComparisonPair[]=[],projects=new Set<string>(),ids=new Set<string>();let revision:number|undefined,total:number|undefined;
 for(let page=0;page<10;page++){
  const r=await request({...filter,action:'report.compare',page,...(revision===undefined?{}:{revision})});
  if(!Number.isSafeInteger(r.companyRevision)||r.companyRevision<0||revision!==undefined&&r.companyRevision!==revision)throw Error('公司内容已变化，请重新准备对比');
  if(!samePeriod(r.period,period)||!samePeriod(r.previousPeriod,previousPeriod)||!Number.isSafeInteger(r.total)||r.total<0||r.total>200||total!==undefined&&total!==r.total||r.page!==page||!Array.isArray(r.pairs)||r.pairs.length!==Math.min(20,r.total-page*20))throw Error('报表对比列表不完整，请刷新后重试');
  revision=r.companyRevision;total=r.total;
  for(const pair of r.pairs){
   if(!pair||typeof pair.projectId!=='string'||projects.has(pair.projectId)||filter.projectId&&pair.projectId!==filter.projectId||!pair.current&&!pair.previous)throw Error('已确认报表对比内容不一致，请刷新后重试');
   for(const[snapshot,expected]of [[pair.current,period],[pair.previous,previousPeriod]]as const){
    if(snapshot===null)continue;if(!isComparisonSnapshot(snapshot,filter.companyId,pair.projectId,expected)||ids.has(snapshot.id))throw Error('已确认报表对比内容不一致，请刷新后重试');ids.add(snapshot.id);
   }
   const checked=buildReportComparison(pair.current?[pair.current]:[],pair.previous?[pair.previous]:[])[0];
   if(pair.progressDelta!==checked.progressDelta||pair.riskUnchanged!==checked.riskUnchanged||pair.projectName!==checked.projectName)throw Error('已确认报表对比内容不一致，请刷新后重试');
   projects.add(pair.projectId);pairs.push(checked);
  }
  if(pairs.length===total)return{period,previousPeriod,pairs:pairs.sort((a,b)=>a.projectName.localeCompare(b.projectName,'zh-CN')||a.projectId.localeCompare(b.projectId)),revision:revision!};
 }
 throw Error('报表对比列表不完整，请刷新后重试');
}
