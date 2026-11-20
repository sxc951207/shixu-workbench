import type{OperatingSheet}from'../../cloud/company/operating-model.ts';
export type CompanyReviewType='project'|'operating'|'daily'|'weekly'|'monthly';
export type CompanyReviewItem={approvalFlow?:import('../../cloud/company/approval-flow.ts').ApprovalFlow;submissionBatchId?:string;type:CompanyReviewType;id:string;projectId:string;projectName:string;version:number;submittedBy:string;submittedAt:string|null;submittedName?:string;excerpt?:string;date:string;start?:string;end?:string;sheet?:OperatingSheet;name?:string;amendment?:boolean};
export type CompanyReviewCursor={stage:number;offset:number;query:string};
export type CompanyReviewFilter={type:'all'|CompanyReviewType;projectId:string;month:string;search?:string};
export type CompanyReviewPage={items:CompanyReviewItem[];nextCursor:CompanyReviewCursor|null;companyRevision:number;scanned:{candidates:number;indexes:number}};
export type ReviewConfigurationProject={id:string;name:string;configured:boolean;pendingIndicatorProposal?:boolean};
export type OperatingReviewShortcut={id:string;date:string;sheet:OperatingSheet;version:number};
export type ReportReviewShortcut={id:string;kind:'daily'|'weekly'|'monthly';start:string};

type ReviewSubmissionGroup={key:string;batch:boolean;items:CompanyReviewItem[]};

export function groupReviewSubmissions(rows:readonly CompanyReviewItem[]):ReviewSubmissionGroup[]{
 const groups=new Map<string,ReviewSubmissionGroup>();
 for(const item of rows){
  const batch=item.type==='operating'&&!!item.sheet&&!!item.submissionBatchId;
  const key=batch?JSON.stringify([item.projectId,item.sheet,item.submittedBy,item.submissionBatchId]):item.type+':'+item.id;
  const group=groups.get(key);
  if(group)group.items.push(item);
  else groups.set(key,{key,batch,items:[item]});
 }
 for(const group of groups.values()){
  if(group.batch)group.items.sort((a,b)=>a.date.localeCompare(b.date));
 }
 return [...groups.values()];
}
