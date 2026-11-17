import{reportPeriod,type ReportKind}from'./report-period.ts';
import{readOperatingDraft,writeOperatingDraft,removeOperatingDraft,type OperatingDraftStorage}from'./operating-local-draft.ts';

/** A device-local safety copy, never a cloud save or approval. */
export type ReportDraftIdentity={companyId:string;projectId:string;reportId:string;kind:ReportKind;start:string;end:string;login:string};
export type ReportDraftForm={progress:string;achievement:string;risk:string;next:string;help:string;changeReason?:string;sourceVersions:number[]};
export type ReportLocalDraft={baseVersion:number;savedAt:number;form:ReportDraftForm};
const keys=['progress','achievement','risk','next','help','changeReason','sourceVersions'];
const tuple=(v:ReportDraftIdentity)=>[v.companyId,v.projectId,v.reportId,v.kind,v.start,v.end,v.login];
const schema=(v:ReportDraftIdentity)=>JSON.stringify(['shixu.project-report.form.v1',...tuple(v)]);
export function reportDraftKey(identity:ReportDraftIdentity){return'shixu-report-draft:v1:'+JSON.stringify(tuple(identity));}
function validIdentity(v:ReportDraftIdentity){
 try{if(tuple(v).some(x=>typeof x!=='string'||!x.trim()||x.length>128))return false;const period=reportPeriod(v.kind,v.start);return period.start===v.start&&period.end===v.end;}catch{return false;}
}
function validForm(v:unknown):v is ReportDraftForm{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const proto=Object.getPrototypeOf(v),r=v as Record<string,unknown>;
 if((proto!==Object.prototype&&proto!==null)||Object.keys(r).some(k=>!keys.includes(k)))return false;
 for(const[key,max]of[['progress',16],['achievement',8000],['risk',4000],['next',4000],['help',4000]]as const)if(typeof r[key]!=='string'||r[key].length>max)return false;
 if('changeReason'in r&&(typeof r.changeReason!=='string'||r.changeReason.length>4000))return false;
 return Array.isArray(r.sourceVersions)&&r.sourceVersions.length<=40&&r.sourceVersions.every(n=>Number.isSafeInteger(n)&&n>0)&&new Set(r.sourceVersions).size===r.sourceVersions.length;
}
export function writeReportDraft(storage:OperatingDraftStorage,identity:ReportDraftIdentity,baseVersion:number,form:unknown,now=Date.now()){
 try{
  if(!validIdentity(identity)||!Number.isSafeInteger(baseVersion)||baseVersion<1||!validForm(form))return{ok:false,error:'本机草稿内容不完整或超过大小限制，请先保留填写内容。'};
  // Long text lives in the bounded source payload; numeric-cell limits stay unchanged.
  return writeOperatingDraft(storage,reportDraftKey(identity),{baseVersion,schema:schema(identity),rows:[{id:'report',name:'project-report'}],form:{report:{marker:'v1'}},source:JSON.stringify(form)},now);
 }catch{return{ok:false,error:'本机草稿未能保存，请先保留填写内容。'};}
}
export function readReportDraft(storage:OperatingDraftStorage,identity:ReportDraftIdentity,now=Date.now()):ReportLocalDraft|null{
 if(!validIdentity(identity))return null;
 const key=reportDraftKey(identity),draft=readOperatingDraft(storage,key,now);if(!draft)return null;
 try{
  const form:unknown=JSON.parse(draft.source);
  if(draft.baseVersion<1||draft.schema!==schema(identity)||JSON.stringify(draft.rows)!==JSON.stringify([{id:'report',name:'project-report'}])||JSON.stringify(draft.form)!==JSON.stringify({report:{marker:'v1'}})||!validForm(form))throw Error('invalid report safety copy');
  return{baseVersion:draft.baseVersion,savedAt:draft.savedAt,form};
 }catch{removeOperatingDraft(storage,key);return null;}
}
export function removeReportDraft(storage:OperatingDraftStorage,identity:ReportDraftIdentity){removeOperatingDraft(storage,reportDraftKey(identity));}
