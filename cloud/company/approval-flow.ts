import {approvalPreview} from '../../lib/workbench/approval-display.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import type {Actor,Company,ProjectHead} from './model.ts';

export type ApprovalFlow={steps:string[];index:number;names?:string[]};
type Submission={status:string;submittedBy:string;approvalFlow?:ApprovalFlow};

export function submissionFlow(c:Company,p:ProjectHead,submitter:string):ApprovalFlow|undefined{
 const steps=p.approvalChain;
 if(!steps?.length)return;
 if(steps.includes(submitter))throw new WorkbenchError('提交人也在项目审批名单中，请联系管理员更换审批人后重新提交');
 if(steps.some(login=>!c.members.some(m=>m.login===login&&m.active)))throw new WorkbenchError('项目审批名单中有已停用的成员，请联系管理员调整后重新提交');
 return {steps:[...steps],index:0,names:approvalPreview(c.members,steps)};
}

export function isCurrentApprover(actor:Actor,c:Company,record:Submission){
 const flow=record.approvalFlow;
 return !!flow&&!actor.owner&&actor.companyId===c.id&&record.status==='submitted'&&actor.login!==record.submittedBy
  &&flow.steps[flow.index]===actor.login&&c.members.some(m=>m.active&&m.login===actor.login);
}

// An intermediate confirmation advances the snapshot without publishing a new version.
export function nextApprovalStep(flow?:ApprovalFlow):ApprovalFlow|undefined{
 if(flow&&flow.index+1<flow.steps.length)return {...flow,index:flow.index+1};
}

function remaining(record:Submission|undefined){
 return record?.status==='submitted'&&record.approvalFlow?record.approvalFlow.steps.slice(record.approvalFlow.index):[];
}

// A login may contain a dot. Use a safe document field name, including for "constructor".
export const approvalCountKey=(login:string)=>'u_'+login.replaceAll('.','%2E');
export function hasPendingApproval(c:Company,projectId:string,login:string){
 return (c.pendingApprovers?.[projectId]?.[approvalCountKey(login)]??0)>0;
}

export function updatePendingApprovers(c:Pick<Company,'pendingApprovers'>,projectId:string,previous:Submission|undefined,current:Submission){
 const before=new Set(remaining(previous)),after=new Set(remaining(current));
 if(!before.size&&!after.size)return;
 const counts={...c.pendingApprovers?.[projectId]};
 for(const login of new Set([...before,...after])){
  const change=Number(after.has(login))-Number(before.has(login));
  if(!change)continue;
  const key=approvalCountKey(login),count=(counts[key]??0)+change;
  if(count<0)throw new WorkbenchError('审批待办目录与记录不一致，请刷新或联系管理员',409);
  if(count)counts[key]=count;else delete counts[key];
 }
 const projects={...c.pendingApprovers};
 if(Object.keys(counts).length)projects[projectId]=counts;else delete projects[projectId];
 if(Object.keys(projects).length)c.pendingApprovers=projects;else delete c.pendingApprovers;
}
