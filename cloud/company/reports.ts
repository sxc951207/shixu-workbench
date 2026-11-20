import {isDeepStrictEqual} from 'node:util';
import {submissionFlow,isCurrentApprover,nextApprovalStep,hasPendingApproval,updatePendingApprovers} from './approval-flow.ts';
import {activeProjects} from './model.ts';
import {approvalPreview} from '../../lib/workbench/approval-display.ts';
import {dailyRosterAction} from './daily-roster.ts';
import {supervisedProjects} from './supervised.ts';
import {recordConfirmedCorrection} from './corrections.ts';
import{WorkbenchError,todayShanghai}from'../../lib/workbench/domain.ts';import{reportPeriod}from'../../lib/workbench/report-period.ts';
import type{Actor,Company,Project,ProjectHead,PeriodReport,ReportHead,ReportVersion,Version}from'./model.ts';import type{CompanyTx}from'./store.ts';import{companyAbility,projectSubject,transitionStage}from'./policy.ts';import{digest,loadCompany,projectAt,saveDirectory,text,versionKey}from'./core.ts';
export const reportVersionKey=(id:string,v:number)=>'reportVersion_'+id+'_'+v;
import {confirmedHeads,previousConfirmedPeriod,reportId,readReportIndex,reportIndexKey,snapshotAt} from './confirmed-reports.ts';
export {reportIndexKey};
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
const scoped=(p:Project|ProjectHead,c:Company,r:Pick<ReportHead,'status'|'submittedBy'|'publishedVersion'>)=>projectSubject({...p,companyId:c.id,status:r.status,submittedBy:r.submittedBy,published:r.publishedVersion?{version:r.publishedVersion}:null}as Project);
async function reportAt(tx:CompanyTx,c:Company,id:unknown){if(typeof id!=='string'||!/^pr_[a-f0-9]{32}$/.test(id))fail('报表编号无效');const r=await tx.get<PeriodReport>(id);if(!r||r.companyId!==c.id)fail('报表不存在',404);return r;}
async function sourceAt(tx:CompanyTx,p:Project,r:PeriodReport,v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>p.version)fail('参考来源编号无效');const data=await tx.get<Version>(versionKey(p.id,Number(v)));if(!data||data.action!=='project.approve'||data.project.id!==p.id||data.project.companyId!==r.companyId||data.project.version!==v||data.project.status!=='approved'||!Number.isFinite(Date.parse(data.at)))fail('参考来源不是该项目的已确认版本');const day=todayShanghai(new Date(data.at));if(day<r.start||day>r.end)fail('参考来源不在本期范围内');return data;}
async function write(tx:CompanyTx,c:Company,r:PeriodReport,actor:Actor,action:string,clock:Date){const month=r.start.slice(0,7),key=reportIndexKey(c.id,month),index=await readReportIndex(tx,c,month);
 const existing=index.items.find(h=>h.id===r.id);
 if(existing?existing.version!==r.version-1:r.version!==1)fail('报表目录版本已变化，请刷新后重试',409);
 if(!index.items.some(x=>x.id===r.id)&&index.items.length>=3000)fail('本月报表数量已达测试版容量');const head:ReportHead={...(r.approvalFlow?{approvalFlow:r.approvalFlow}:{}),...(r.authorLogin?{authorLogin:r.authorLogin}:{}),id:r.id,projectId:r.projectId,kind:r.kind,start:r.start,end:r.end,status:r.status,version:r.version,publishedVersion:r.published?.version||0,submittedBy:r.submittedBy};updatePendingApprovers(c,r.projectId,existing,head);index.items=index.items.filter(x=>x.id!==r.id);index.items.push(head);index.revision++;index.versions++;const version:ReportVersion={report:r,action,actor:actor.owner?'管理员':c.members.find(x=>x.login===actor.login)?.name||'',at:clock.toISOString()},payload=JSON.stringify(version);await tx.put(r.id,r);await tx.put(reportVersionKey(r.id,r.version),version);await tx.put(reportVersionKey(r.id,r.version),{payload,checksum:digest(payload)},true);await tx.put(key,index);const ip=JSON.stringify(index);await tx.put(key+'_'+index.revision,{payload:ip,checksum:digest(ip)},true);c.reportMonths={...c.reportMonths,[month]:{revision:index.revision,versions:index.versions,count:index.items.length}};c.revision++;await saveDirectory(tx,c);return{report:r,companyRevision:c.revision};}
export function dailyReviewer(project:ProjectHead,author:string){
 return project.reviewerLogin===author?(project.progressLeaderLogin&&project.progressLeaderLogin!==author?project.progressLeaderLogin:'owner'):project.reviewerLogin;
}
export function canReviewDaily(actor:Actor,c:Company,p:ProjectHead,h:ReportHead){
 if(h.approvalFlow)return isCurrentApprover(actor,c,h);
 const uid=actor.owner?'owner':actor.login;
 if(!h.authorLogin||h.status!=='submitted'||uid===h.submittedBy||uid!==dailyReviewer(p,h.authorLogin))return false;
 return !!actor.owner||c.members.some(m=>m.active&&m.login===uid&&m.roles.includes(p.reviewerLogin===uid?'supervisor':'leader'));
}
export async function executeReport(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 const{c,member}=await loadCompany(tx,actor,b.companyId),ability=companyAbility(actor,c),uid=actor.owner?'owner':actor.login!;
 if(b.action==='report.dailyRoster'||b.action==='report.dailySchedule')return dailyRosterAction(tx,actor,c,member,b);
 const canPrepare=(p:Project|ProjectHead)=>ability.can('edit',scoped(p,c,{status:'draft',submittedBy:'',publishedVersion:0}));
 const dailyAssigned=(p:ProjectHead)=>!!actor.owner||!!member?.roles.some(role=>role==='employee'||role==='supervisor')&&(p.ownerLogin===uid||p.participants.includes(uid)||p.reviewerLogin===uid&&member.roles.includes('supervisor'));
 const dailySubject=(p:ProjectHead,h:ReportHead)=>scoped({...p,ownerLogin:dailyAssigned(p)&&h.authorLogin===uid?uid:'',participants:[]},c,h);
 if(b.action==='report.projects')return{projects:activeProjects(c).filter(b.kind==='daily'?dailyAssigned:canPrepare).map(p=>({id:p.id,name:p.name,version:p.version,ownerLogin:p.ownerLogin,reviewerLogin:p.reviewerLogin}))};
 if(b.action==='report.list'){
  if(b.revision!==undefined&&b.revision!==c.revision)fail('公司内容已发生变化，请刷新后重试',409);
  const period=reportPeriod(b.kind,b.periodDate),supervised=b.scope==='supervised'?supervisedProjects(member):undefined,scope=supervised?'summary':b.scope||'mine';
  if(!['mine','review','summary','manage'].includes(scope)||scope==='manage'&&!actor.owner||scope==='review'&&!actor.owner&&!member!.roles.includes('supervisor')&&!(period.kind==='daily'&&member!.roles.includes('leader'))&&!activeProjects(c).some(p=>hasPendingApproval(c,p.id,uid)||p.approvalChain?.includes(uid))||scope==='summary'&&!supervised&&!actor.owner&&!member!.roles.includes('leader'))fail('没有该报表视图的权限',403);
  const page=Number.isSafeInteger(b.page)&&b.page>=0?b.page:0;
  if(b.findPrevious===true){
   if(scope!=='summary')fail('只有已确认视图可查看往期确认记录',403);
   if(b.historyOffset!==undefined&&b.revision===undefined)fail('继续查询历史报表需要原公司版本');
   const history=await previousConfirmedPeriod(tx,c,actor,period,b.projectId||'',b.historyOffset??0,supervised);
   return {history,companyRevision:c.revision};
  }
  let headers:ReportHead[];
  if(scope==='summary'){
   headers=await confirmedHeads(tx,c,actor,period,b.projectId||'',supervised);
  }else{
   const index=await readReportIndex(tx,c,period.start.slice(0,7));
   headers=index.items.filter(h=>{
    if(scope==='review'&&b.reviewId&&b.reviewId!==h.id)return false;
    if(h.kind!==period.kind||h.start!==period.start||b.projectId&&h.projectId!==b.projectId)return false;
    const project=activeProjects(c).find(x=>x.id===h.projectId);
    if(!project)return false;
    const object=h.kind==='daily'?dailySubject(project,h):scoped(project,c,h);
    if(scope==='review'&&h.approvalFlow)return isCurrentApprover(actor,c,h);
    if(scope==='review'&&h.kind==='daily')return canReviewDaily(actor,c,project,h);
    if(scope==='review')return h.status==='submitted'&&h.submittedBy!==uid&&ability.can('review',object);
    return scope==='manage'||ability.can('read',object);
   });
  }
  headers.sort((a,b)=>b.id.localeCompare(a.id));
  const reports=[];
  for(const h of headers.slice(page*20,page*20+20)){
   if(scope==='summary'){reports.push(await snapshotAt(tx,c,h,period));continue;}
   const r=await reportAt(tx,c,h.id),project=await projectAt(tx,c,r.projectId);
   if(!isDeepStrictEqual(h.approvalFlow,r.approvalFlow)||r.version!==h.version||r.projectId!==h.projectId||r.status!==h.status||r.submittedBy!==h.submittedBy)fail('报表与待审目录不一致，请刷新',409);
   const nudge=project.work?.nudges.filter(n=>n.kind==='report-review'&&n.targetId===r.id&&n.targetVersion===r.version&&n.recipient===(r.approvalFlow?.steps[r.approvalFlow.index]||project.reviewerLogin)).at(-1);
   const submitter=r.authorLogin||(r.status==='submitted'?r.submittedBy:project.ownerLogin);
   const fallback=r.kind==='daily'?dailyReviewer(project,submitter):project.reviewerLogin===submitter?'owner':project.reviewerLogin;
   const recipients=r.status==='submitted'?[fallback]:project.approvalChain||[fallback];
   reports.push({...r,approvalPreview:approvalPreview(c.members,recipients),...(nudge?{nudge}:{})});
  }
  // The list page may not contain this writer's draft; keep its entry tied to their own project and day.
  const writing=period.kind==='daily'&&(scope==='mine'||scope==='manage');
  const myDailyStatuses=writing?Object.fromEntries(headers.filter(h=>h.authorLogin===uid).map(h=>[h.projectId,h.status])):undefined;
  const assignment=scope==='mine'&&period.kind==='daily'?{assignedProjectIds:(c.dailySchedules||[]).filter(s=>
   s.login===uid&&s.month===period.start.slice(0,7)&&s.days.includes(Number(period.start.slice(8)))&&(!b.projectId||s.projectId===b.projectId)&&activeProjects(c).some(p=>p.id===s.projectId&&dailyAssigned(p))
  ).map(s=>s.projectId)}:{};
  return{period,reports,total:headers.length,page,companyRevision:c.revision,...(writing?{myDailyStatuses}:{}),...assignment};
 }
 if(b.action==='report.create'){const p=await projectAt(tx,c,b.projectId);if(!(b.kind==='daily'?dailyAssigned(p):canPrepare(p)))fail('没有该项目报表的填写权限',403);const period=reportPeriod(b.kind,b.periodDate);if(period.start>todayShanghai(clock))fail('不能创建未来周期的报表');const id=reportId(c.id,p.id,period.kind,period.start,uid),old=await tx.get<PeriodReport>(id);if(old)return{report:old,existing:true,companyRevision:c.revision};const r:PeriodReport={id,companyId:c.id,projectId:p.id,projectName:p.name,...period,...(period.kind==='daily'?{authorLogin:uid}:{}),status:'draft',version:1,publishedVersion:0,submittedBy:'',submittedName:'',submittedAt:null,ownerLogin:period.kind==='daily'?uid:p.ownerLogin,reviewerLogin:p.reviewerLogin,progress:null,achievement:'',risk:'',next:'',help:'',changeReason:'',sourceVersions:[],createdAt:clock.toISOString(),updatedAt:clock.toISOString(),comment:'',reviewerName:'',published:null};return write(tx,c,r,actor,b.action,clock);}
 const current=await reportAt(tx,c,b.id),p=await projectAt(tx,c,current.projectId),object=current.kind==='daily'?dailySubject(p,current):scoped(p,c,current);
 if(b.action==='report.dailySources'||b.action==='report.weeklySources'){
  const daily=b.action==='report.dailySources';
  if(current.kind!==(daily?'weekly':'monthly')||!canPrepare(p))fail('没有该项目汇总权限',403);
  if(b.revision!==undefined&&b.revision!==c.revision)fail('汇总来源已更新，请重新读取',409);
  const first=daily?current.start:reportPeriod('weekly',current.start).start;
  const months=[...new Set([first.slice(0,7),current.end.slice(0,7)])];
  const heads:ReportHead[]=[];
  for(const month of months){
   const index=await readReportIndex(tx,c,month);
   heads.push(...index.items.filter(h=>h.projectId===p.id&&h.kind===(daily?'daily':'weekly')&&h.start<=current.end&&h.end>=current.start&&h.publishedVersion>0));
  }
  heads.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  const offset=b.offset??0;
  if(!Number.isSafeInteger(offset)||offset<0||offset>heads.length)fail('汇总分页位置无效');
  const sources=[];
  for(const h of heads.slice(offset,offset+12)){
   const s=await snapshotAt(tx,c,h,reportPeriod(h.kind,h.start));
   if(s)sources.push({id:s.id,start:s.start,end:s.end,version:s.version,author:s.submittedName,authorLogin:s.submittedBy,achievement:s.achievement,risk:s.risk,next:s.next,help:s.help});
  }
  return{sources,total:heads.length,companyRevision:c.revision};
 }
 if(b.action==='report.get'){if(!ability.can('read',object)&&!isCurrentApprover(actor,c,current))fail('没有该报表的查看权限',403);return{report:current};}
 if(b.action==='report.sources'){if(!canPrepare(p))fail('没有该项目参考记录的权限',403);if(b.projectVersion!==undefined&&b.projectVersion!==p.version)fail('项目进度已变化，请重新读取参考记录',409);const cursor=b.cursor===undefined?p.version:b.cursor;if(!Number.isSafeInteger(cursor)||cursor<0||cursor>p.version)fail('参考记录位置无效');const sources=[];let v=cursor;for(let n=0;n<20&&v>0;n++,v--){const data=await tx.get<Version>(versionKey(p.id,v));if(!data)fail('项目版本历史不完整，请联系管理员');if(data.action==='project.approve'&&data.project.status==='approved'&&data.project.id===p.id&&data.project.companyId===c.id){const day=todayShanghai(new Date(data.at));if(day>=current.start&&day<=current.end)sources.push({version:v,at:data.at,progress:data.project.progress,achievement:data.project.achievement,risk:data.project.risk,next:data.project.next,reviewerName:data.project.reviewerName});}}return{sources,cursor:v,projectVersion:p.version};}
 if(b.action==='report.history'){if(!ability.can('read',object))fail('没有该报表历史的权限',403);const versions=[];for(let v=current.version;v>Math.max(0,current.version-20);v--){const data=await tx.get<ReportVersion>(reportVersionKey(current.id,v));if(data&&(actor.owner||p.ownerLogin===uid||data.report.status!=='draft'))versions.push(data);}return{versions};}
 if(b.version!==current.version)fail('报表已发生变化，请刷新后再操作',409);let r={...current},event='';
 if(b.action==='report.save'){if((r.kind==='daily'&&r.authorLogin!==uid)||!ability.can('edit',object)||!['draft','returned'].includes(r.status))fail('没有修改该报表草稿的权限',403);if(b.progress!==null&&(!Number.isInteger(b.progress)||b.progress<0||b.progress>100))fail('进度填写0~100的整数');if(!Array.isArray(b.sourceVersions)||b.sourceVersions.length>40||new Set(b.sourceVersions).size!==b.sourceVersions.length)fail('参考来源编号无效');for(const v of b.sourceVersions)await sourceAt(tx,p,r,v);r={...r,projectName:p.name,progress:b.progress,achievement:text(b.achievement,8000),risk:text(b.risk,4000),next:text(b.next,4000),help:text(b.help,4000),...(b.changeReason===undefined?{}:{changeReason:text(b.changeReason,4000)}),sourceVersions:b.sourceVersions};}
 else if(b.action==='report.submit'){
  if(!ability.can('submit',object)||(r.kind==='daily'?r.authorLogin:p.ownerLogin)!==uid)fail('请由当前填报人提交',403);
  if((r.kind!=='daily'&&r.progress===null)||!r.achievement.trim())fail('请先填写项目进度和本期成果');
  delete r.approvalFlow;
  const flow=submissionFlow(c,p,uid);
  if(flow)r.approvalFlow=flow;
  const reviewer=flow?.steps[0]||(r.kind==='daily'?dailyReviewer(p,uid):p.reviewerLogin);
  if(r.kind==='daily'&&reviewer===uid)fail('请先在项目设置指定另一位确认主管或领导，再提交这份日报');
  if(!flow&&reviewer!=='owner'&&!c.members.some(x=>x.login===reviewer&&x.active&&x.roles.includes(reviewer===p.reviewerLogin?'supervisor':'leader')))fail('项目确认人已停用或权限变化，请联系管理员调整');
  r={...r,ownerLogin:r.authorLogin||p.ownerLogin,reviewerLogin:reviewer,submittedBy:uid,submittedName:actor.owner?'管理员':member!.name,submittedAt:clock.toISOString(),comment:'',reviewerName:''};
  event='SUBMIT';
 }
 else if(b.action==='report.amend'){if((r.kind==='daily'&&r.authorLogin!==uid)||!ability.can('amend',object)||r.status!=='approved')fail('没有发起报表更正的权限',403);r={...r,comment:'',reviewerName:'',submittedBy:'',submittedName:'',submittedAt:null};event='AMEND';}
 else if(b.action==='report.approve'||b.action==='report.return'){
  const allowed=r.approvalFlow?isCurrentApprover(actor,c,r):r.kind==='daily'?canReviewDaily(actor,c,p,r):ability.can('review',object);
  if(!allowed||r.status!=='submitted'||r.submittedBy===uid)fail('没有该报表确认权限或不能确认本人提交',403);
  if(b.action==='report.return'&&!String(b.comment||'').trim())fail('请填写退回原因');
  r={...r,comment:text(b.comment,1000),reviewerName:actor.owner?'管理员':member!.name};
  const next=b.action==='report.approve'?nextApprovalStep(r.approvalFlow):undefined;
  if(next){r.approvalFlow=next;r.reviewerLogin=next.steps[next.index];}
  else event=b.action==='report.approve'?'APPROVE':'RETURN';
 }
 else if(b.action==='report.restore'){if(!actor.owner)fail('只有管理员可恢复历史报表',403);if(!Number.isSafeInteger(b.targetVersion)||b.targetVersion<1||b.targetVersion>r.version)fail('历史版本无效');const doc=await tx.get<{payload:string;checksum:string}>(reportVersionKey(r.id,b.targetVersion),true);if(!doc||digest(doc.payload)!==doc.checksum)fail('报表备份完整性校验失败');const old=(JSON.parse(doc.payload)as ReportVersion).report;if(old.id!==r.id||old.companyId!==c.id||old.projectId!==p.id||old.start!==r.start||old.kind!==r.kind)fail('历史报表关系不匹配');r={...r,progress:old.progress,achievement:old.achievement,risk:old.risk,next:old.next,help:old.help,changeReason:old.changeReason??'',sourceVersions:old.sourceVersions,status:'draft',comment:'历史内容已恢复为草稿，需重新提交确认',reviewerName:'',submittedBy:'',submittedName:'',submittedAt:null};}
 else fail('不支持的报表操作');
 if(event){
  const status=transitionStage(r.status,event);
  if(status===r.status)fail('当前报表状态不能执行此操作',409);
  r.status=status;
 }
 if(r.status==='draft')delete r.approvalFlow;
 r.version++;r.updatedAt=clock.toISOString();
 if(b.action==='report.approve'&&r.status==='approved'){
  r.publishedVersion=r.version;
  const{published,...snapshot}=r;
  r.published=snapshot;
  await recordConfirmedCorrection(tx,c,current.published,snapshot);
 }
 const action=b.action==='report.approve'&&r.status==='submitted'?'report.approveStep':b.action;
 return write(tx,c,r,actor,action,clock);
}
