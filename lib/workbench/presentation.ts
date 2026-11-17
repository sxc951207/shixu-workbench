import type {ReportSnapshot} from '../../cloud/company/model.ts';
import {isComparisonSnapshot} from './report-comparison.ts';
import {reportPeriod,type ReportPeriod} from './report-period.ts';
export type PresentationFilter={companyId:string;kind:'weekly'|'monthly';periodDate:string;projectId:string};
export type PresentationSlide={type:'overview';reports:ReportSnapshot[]}|{type:'detail';report:ReportSnapshot;field:'achievement'|'changeReason'|'risk'|'next'|'help';text:string;part:number;parts:number};
export async function loadPresentationReports(request:(b:any)=>Promise<any>,filter:PresentationFilter):Promise<{reports:ReportSnapshot[];period:ReportPeriod;revision:number}>{
 const period=reportPeriod(filter.kind,filter.periodDate),reports:ReportSnapshot[]=[],ids=new Set<string>(),projects=new Set<string>();let revision:number|undefined,total:number|undefined;
 for(let page=0;page<10;page++){
  const r=await request({...filter,action:'report.list',scope:'summary',page,...(revision===undefined?{}:{revision})});
  if(!Number.isSafeInteger(r.companyRevision)||r.companyRevision<0||revision!==undefined&&r.companyRevision!==revision)throw Error('公司内容已变化，请重新准备演示');
  if(r.period?.kind!==period.kind||r.period.start!==period.start||r.period.end!==period.end||!Number.isSafeInteger(r.total)||r.total<0||r.total>200||total!==undefined&&r.total!==total||r.page!==page||!Array.isArray(r.reports)||r.reports.length!==Math.min(20,r.total-page*20))throw Error('报表列表不完整或周期不一致，请刷新后重试');
  revision=r.companyRevision;total=r.total;
  for(const report of r.reports){
   if(!isComparisonSnapshot(report,filter.companyId,filter.projectId||report?.projectId,period)||ids.has(report.id)||projects.has(report.projectId))throw Error('已确认报表内容不一致，请刷新后重试');
   ids.add(report.id);projects.add(report.projectId);reports.push(report);
  }
  if(reports.length===total){if(!total)throw Error('本期没有已确认报表，主管确认后即可演示');return {reports,period,revision:revision!};}
  if(!r.reports.length||reports.length>total!)throw Error('报表列表不完整，请刷新后重试');
 }
 throw Error('报表列表不完整，请刷新后重试');
}
export function splitPresentationText(text:string):string[]{
 const clean=text.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();if(!clean)return [];
 const parts:string[]=[];let content='',line=1,column=0;
 for(const {segment}of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(clean)){
  if(segment==='\n'){content+=segment;column=0;if(line>=6){parts.push(content);content='';line=1;}else line++;continue;}
  if(column>=22){column=0;line++;}
  if(line>6){parts.push(content);content='';line=1;}
  content+=segment;column++;
 }
 if(content)parts.push(content);return parts;
}
export function buildPresentationSlides(reports:ReportSnapshot[],includeChangeReason=false):PresentationSlide[]{
 if(reports.some(r=>r.status!=='approved'))throw Error('只可演示已确认报表');
 const sorted=[...reports].sort((a,b)=>a.projectName.localeCompare(b.projectName,'zh-CN')),slides:PresentationSlide[]=[];
 for(let i=0;i<sorted.length;i+=6)slides.push({type:'overview',reports:sorted.slice(i,i+6)});
 for(const report of sorted)for(const field of ['achievement','changeReason','risk','next','help']as const){if(field==='changeReason'&&!includeChangeReason)continue;const parts=splitPresentationText(report[field]??'');parts.forEach((text,i)=>slides.push({type:'detail',report,field,text,part:i+1,parts:parts.length}));}
 return slides;
}
