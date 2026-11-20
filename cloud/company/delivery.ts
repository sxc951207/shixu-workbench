import {activeProjects} from './model.ts';
import {supervisedProjects} from './supervised.ts';
import{randomUUID}from'node:crypto';
import type{CompanyTx}from'./store.ts';import type{Actor,Company,Project,ProjectHead,PeriodReport}from'./model.ts';import type{WorkItem,FollowUp}from'./work-model.ts';
import{digest,loadCompany,projectAt,text,writeProject}from'./core.ts';import{companyAbility,projectSubject}from'./policy.ts';
import{WorkbenchError,todayShanghai}from'../../lib/workbench/domain.ts';import{workDate}from'../../lib/workbench/project-delivery.ts';
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
function operational(c:Company,login:string){return c.members.some(m=>m.login===login&&m.active&&m.roles.some(r=>r==='employee'||r==='supervisor'));}
function supervisor(c:Company,login:string){return c.members.some(m=>m.login===login&&m.active&&m.roles.includes('supervisor'));}
function related(c:Company,p:ProjectHead,login:string){return operational(c,login)&&(p.ownerLogin===login||p.participants.includes(login)||p.reviewerLogin===login&&supervisor(c,login));}
function manager(c:Company,p:Project,actor:Actor){return !!actor.owner||p.ownerLogin===actor.login&&operational(c,actor.login)||p.reviewerLogin===actor.login&&supervisor(c,actor.login);}
function eligible(c:Company,p:Project,login:string){return login==='owner'?p.reviewerLogin==='owner':related(c,p,login);}
function safeProject(c:Company,p:Project,actor:Actor,summary=false){const manage=!summary&&manager(c,p,actor),uid=actor.owner?'owner':actor.login!,work=p.work||{items:[],nudges:[]},people=[...new Set([p.ownerLogin,p.reviewerLogin,...p.participants])].filter(u=>eligible(c,p,u)).map(login=>({login,name:login==='owner'?'管理员':c.members.find(m=>m.login===login)?.name||login}));return{id:p.id,name:p.name,version:p.version,status:p.status,ownerLogin:p.ownerLogin,reviewerLogin:p.reviewerLogin,participants:p.participants,submittedAt:p.submittedAt|| (p.status==='submitted'?p.updatedAt:null),submittedBy:p.submittedBy,updatedAt:p.updatedAt,work:{items:work.items,nudges:summary?[]:work.nudges.filter(n=>n.recipient===uid||manage)},people,permissions:{manage,completeIds:summary?[]:work.items.filter(i=>manage||i.assignee===uid&&eligible(c,p,uid)).map(i=>i.id),canNudgeProject:!summary&&p.status==='submitted'&&(!!actor.owner||p.ownerLogin===uid)&&(p.approvalFlow?.steps[p.approvalFlow.index]||p.progressReviewLogin||p.reviewerLogin)!==uid}};}
export async function executeDelivery(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 const{c,member}=await loadCompany(tx,actor,b.companyId),uid=actor.owner?'owner':actor.login!,ability=companyAbility(actor,c);
 if(b.action==='delivery.list'){
  const supervised=b.scope==='supervised'?supervisedProjects(member):null;
  const scope=supervised?'summary':b.scope||(actor.owner?'manage':member!.roles.includes('leader')&&!member!.roles.some(r=>r==='employee'||r==='supervisor')?'summary':'mine');
  if(!['manage','mine','summary'].includes(scope)||scope==='manage'&&!actor.owner||scope==='mine'&&!actor.owner&&!operational(c,uid)||scope==='summary'&&!supervised&&!actor.owner&&!member!.roles.includes('leader'))fail('没有该项目视图的权限',403);
  if(b.revision!==undefined&&b.revision!==c.revision)fail('项目已发生变化，请刷新后操作',409);
  const accessible=activeProjects(c).filter(p=>scope==='manage'?true:scope==='summary'?p.publishedVersion>0&&(supervised?supervised(p):actor.owner||ability.can('published',projectSubject({...p,companyId:c.id,published:{version:p.publishedVersion}}as Project))):related(c,p,uid));const headers=accessible.filter(p=>!b.projectId||p.id===b.projectId);
  const page=b.page===undefined?0:b.page;if(!Number.isSafeInteger(page)||page<0)fail('分页位置无效');
  const pageIds=new Set(headers.slice(page*10,page*10+10).map(p=>p.id));
  const summary=scope==='summary', projects=[], projectOptions=[];
  for(const head of accessible){
   const onPage=pageIds.has(head.id);
   let name=head.name;
   // An amended head can contain a name that its reviewer has yet to confirm.
   if(onPage || (summary && head.version!==head.publishedVersion)){
    const current=await projectAt(tx,c,head.id);
    const project=summary?current.published:current;
    if(!project)fail('项目确认快照不完整');
    name=project.name;
    if(onPage)projects.push(safeProject(c,project as Project,actor,summary));
   }
   projectOptions.push({id:head.id,name});
  }
  return{projects,projectOptions,total:headers.length,page,pageSize:10,companyRevision:c.revision,scope,today:todayShanghai(clock)};
 }
 const p0=await projectAt(tx,c,b.projectId);if(!actor.owner&&!related(c,p0,uid))fail('没有该项目协作事项的权限',403);
 const p:Project={...p0,work:{items:[...(p0.work?.items||[])],nudges:[...(p0.work?.nudges||[])]}},canManage=manager(c,p,actor);
 const reply=(existing=false)=>({project:safeProject(c,p,actor),companyRevision:c.revision,...(existing?{existing:true}:{})});
 if(b.action==='delivery.nudge'){
  if(p.status==='submitted'&&!p.submittedAt)p.submittedAt=p.updatedAt;
  let recipient='',round='',targetVersion=0,namedApprover=false;
  if(b.kind==='item'){
   const item=p.work!.items.find(i=>i.id===b.targetId);if(!item)fail('事项不存在',404);if(!canManage)fail('没有催办该事项的权限',403);if(item.status==='done')fail('事项已完成，无需催办');recipient=item.assignee;round=item.updatedAt;targetVersion=Date.parse(round);
  }else if(b.kind==='project-review'){
   if(!actor.owner&&p.ownerLogin!==uid)fail('没有催办该项目的权限',403);if(p.status!=='submitted'||b.targetId!==p.id)fail('项目当前不在待确认状态');namedApprover=!!p.approvalFlow;recipient=p.approvalFlow?.steps[p.approvalFlow.index]||p.progressReviewLogin||p.reviewerLogin;round=p.submittedAt||p.updatedAt;targetVersion=p.version;p.submittedAt=round;
  }else if(b.kind==='report-review'){
   if(!actor.owner&&p.ownerLogin!==uid)fail('没有催办该报表的权限',403);if(typeof b.targetId!=='string'||!/^pr_[a-f0-9]{32}$/.test(b.targetId))fail('报表编号无效');const r=await tx.get<PeriodReport>(b.targetId);if(!r||r.companyId!==c.id||r.projectId!==p.id)fail('报表不存在',404);if(r.status!=='submitted')fail('报表当前不在待确认状态');if(b.version!==r.version)fail('报表已发生变化，请刷新后操作',409);namedApprover=!!r.approvalFlow;recipient=r.approvalFlow?.steps[r.approvalFlow.index]||p.reviewerLogin;round=r.submittedAt||r.updatedAt;targetVersion=r.version;
  }else fail('提醒类型无效');
  if(recipient===uid)fail('不能催办本人');if(namedApprover?!c.members.some(m=>m.login===recipient&&m.active):b.kind==='project-review'&&p.progressReviewLogin?!c.members.some(m=>m.login===recipient&&m.active&&m.roles.includes('leader')):!eligible(c,p,recipient)||b.kind!=='item'&&recipient!=='owner'&&!supervisor(c,recipient))fail('责任人或确认主管已停用，请管理员重新分配');
  const marker='nudge_'+digest([c.id,p.id,b.kind,b.targetId,recipient,round,todayShanghai(clock)].join(':'));if(await tx.get(marker))return reply(true);
  if(b.kind!=='report-review'&&b.version!==p.version)fail('项目已发生变化，请刷新后操作',409);
  const n:FollowUp={id:'nu_'+randomUUID().replaceAll('-',''),kind:b.kind,targetId:b.targetId,recipient,by:actor.owner?'管理员':member!.name,at:clock.toISOString(),targetVersion};p.work!.nudges=[...p.work!.nudges,n].slice(-50);await tx.put(marker,{at:n.at,projectId:p.id,targetId:n.targetId,recipient});
 }else{
  if(b.version!==p.version)fail('项目已发生变化，请刷新后操作',409);
  if(p.status==='submitted')fail('项目待确认中，请先由主管退回补充',409);
  if(b.action==='delivery.item.save'){
   if(!canManage)fail('没有维护该项目事项的权限',403);if(!['milestone','decision'].includes(b.kind))fail('事项类型无效');const old=b.itemId?p.work!.items.find(i=>i.id===b.itemId):null;if(b.itemId&&!old)fail('事项不存在',404);if(old&&old.kind!==b.kind)fail('事项类型不能修改');if(!old&&p.work!.items.length>=100)fail('每项目最多100个协作事项');
   const start=workDate(b.start),due=workDate(b.due),meetingDate=b.kind==='decision'?workDate(b.meetingDate):null;if(due<start||meetingDate&&meetingDate>due)fail('截止日期不能早于开始或会议日期');if(typeof b.assignee!=='string'||!eligible(c,p,b.assignee))fail('责任人须为当前有效项目成员');
   const item:WorkItem={id:old?.id||'wi_'+randomUUID().replaceAll('-',''),kind:b.kind,title:text(b.title,120,true),notes:text(b.notes??'',1000),assignee:b.assignee,start,due,status:old?.status||'open',meetingDate,createdAt:old?.createdAt||clock.toISOString(),updatedAt:clock.toISOString(),completedAt:old?.completedAt||null};p.work!.items=old?p.work!.items.map(x=>x.id===old.id?item:x):[...p.work!.items,item];
  }else if(b.action==='delivery.item.complete'){
   const item=p.work!.items.find(i=>i.id===b.itemId);if(!item)fail('事项不存在',404);if(!canManage&&!(item.assignee===uid&&eligible(c,p,uid)))fail('没有完成该事项的权限',403);if(typeof b.done!=='boolean')fail('完成状态无效');if((item.status==='done')===b.done)return reply(true);p.work!.items=p.work!.items.map(i=>i.id===item.id?{...i,status:b.done?'done':'open',completedAt:b.done?clock.toISOString():null,updatedAt:clock.toISOString()}:i);
  }else fail('不支持的项目协作操作');
  if(p.status==='approved'){delete p.approvalFlow;p.status='draft';p.submittedAt=null;p.comment='协作事项有更新，请负责人重新提交确认';p.reviewerName='';}
 }
 p.version++;p.updatedAt=clock.toISOString();await writeProject(tx,c,p,b.action,actor,clock);return reply();
}
