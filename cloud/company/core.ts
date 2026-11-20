import {organizationLevelFor} from '../../lib/workbench/organization.ts';
import {submissionFlow,isCurrentApprover,nextApprovalStep,hasPendingApproval} from './approval-flow.ts';
import {activeProjects} from './model.ts';
import {approvalPreview} from '../../lib/workbench/approval-display.ts';
import {assertMemberCanDeactivate,validatedApprovalChain} from '../../lib/workbench/organization.ts';
import {registerCompany} from './login-company.ts';
import {supervisedProjects} from './supervised.ts';
import {memberLoginPattern,suggestedMemberLogin} from '../../lib/workbench/member-login.ts';
import{createHash,randomUUID}from'node:crypto';import{WorkbenchError}from'../../lib/workbench/domain.ts';
import type{Actor,Company,Member,Project,Version}from'./model.ts';import type{CompanyTx}from'./store.ts';import{companyAbility,projectSubject,transitionStage}from'./policy.ts';
export const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export const accountKey=(c:string,u:string)=>'account_'+digest(c+':'+u);
export const companyKey=(id:string)=>'company_'+id;
export const versionKey=(id:string,v:number)=>'version_'+id+'_'+v;
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
export function text(v:unknown,max:number,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))return fail('填写内容不完整或超过长度限制');return v.trim();}
export function loginName(v:unknown){const s=text(v,40,true).toLowerCase();if(!memberLoginPattern.test(s)||s==='owner')fail('登录名可用中文姓名（至少2字），或3至40位英文账号；同名可加01、02');return s;}
export async function loadCompany(tx:CompanyTx,actor:Actor,id:unknown){if(typeof id!=='string'||!/^co_[a-f0-9]{12}$/.test(id))fail('公司编号无效');if(!actor.owner&&actor.companyId!==id)fail('没有该公司的权限',403);const c=await tx.get<Company>(companyKey(id));if(!c)fail('公司不存在',404);const member=actor.owner?null:c.members.find(m=>m.login===actor.login&&m.active);if(!actor.owner&&!member)fail('成员已停用或没有权限',403);return{c,member};}
export async function saveDirectory(tx:CompanyTx,c:Company){await tx.put(companyKey(c.id),c);const payload=JSON.stringify(c);await tx.put('head_'+c.id,{payload,checksum:digest(payload)},true);await tx.put('directory_'+c.id+'_'+c.revision,{payload,checksum:digest(payload)},true);}
export async function writeProject(tx:CompanyTx,c:Company,p:Project,action:string,actor:Actor,clock:Date){const{published,companyId,progress,achievement,risk,next,createdAt,updatedAt,comment,reviewerName,work,submittedAt,...head}=p;c.projects=c.projects.filter(x=>x.id!==p.id);c.projects.push({...head,publishedVersion:published?.version||0});c.revision++;const version:Version={project:p,action,actor:actor.owner?'管理员':c.members.find(m=>m.login===actor.login)?.name||'',at:clock.toISOString()},payload=JSON.stringify(version);await tx.put(p.id,p);await tx.put(versionKey(p.id,p.version),version);await tx.put(versionKey(p.id,p.version),{payload,checksum:digest(payload)},true);await saveDirectory(tx,c);return{project:p,companyRevision:c.revision};}
export async function projectAt(tx:CompanyTx,c:Company,id:unknown,includeDeleted=false){if(typeof id!=='string'||!/^p_[a-f0-9]{24}$/.test(id))fail('项目编号无效');const p=await tx.get<Project>(id);if(!p||p.companyId!==c.id||p.deletedAt&&!includeDeleted)fail('项目不存在',404);return p;}
function progressLeader(c:Company, value:unknown, ownerLogin:string){
 if(value===undefined||value==='')return undefined;
 const login=loginName(value);
 if(login===ownerLogin||!c.members.some(m=>m.active&&m.login===login&&m.roles.includes('leader')))fail('请选择本公司已启用且与负责人不同的领导');
 return login;
}
export function canConfirmProgress(actor:Actor,c:Company,p:Company['projects'][number]){
 if(p.approvalFlow)return isCurrentApprover(actor,c,p);
 const uid=actor.owner?'owner':actor.login;
 if(p.status!=='submitted'||!uid||uid===p.submittedBy)return false;
 if(p.progressReviewLogin)return !actor.owner&&p.progressReviewLogin===uid&&c.members.some(m=>m.login===uid&&m.active&&m.roles.includes('leader'));
 return !!actor.owner||p.reviewerLogin===uid&&c.members.some(m=>m.login===uid&&m.active&&m.roles.includes('supervisor'));
}
export async function executeCompany(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 if(b.action==='company.create'){if(!actor.owner)fail('只有管理员可创建公司',403);const registry=await tx.get<{ids:string[]}>('registry')||{ids:[]};if(registry.ids.length>=50)fail('公司数量已达测试版容量');const c:Company={id:'co_'+randomUUID().replaceAll('-','').slice(0,12),name:text(b.name,60,true),revision:1,createdAt:clock.toISOString(),members:[],projects:[],policy:{daily:90,monthly:0,yearly:0}};await registerCompany(tx,registry,c);await saveDirectory(tx,c);return{company:c};}
 if(b.action==='companies'){const ids=actor.owner?(await tx.get<{ids:string[]}>('registry'))?.ids||[]:actor.companyId?[actor.companyId]:[],companies=[];for(const id of ids){const{c,member}=await loadCompany(tx,actor,id);companies.push({id:c.id,name:c.name,roles:actor.owner?['admin','leader','supervisor']:member!.roles});}return{companies};}
 const{c,member}=await loadCompany(tx,actor,b.companyId),ability=companyAbility(actor,c),uid=actor.owner?'owner':actor.login!;
 if(['member.save','project.create','project.trash','project.untrash','policy'].includes(b.action)&&!actor.owner)fail('只有管理员可管理成员、项目与保存设置',403);
 if(['member.save','project.create','project.trash','project.untrash','policy'].includes(b.action)&&b.revision!==undefined&&b.revision!==c.revision)fail('公司设置已发生变化，请刷新后操作',409);
 if(b.action==='member.save'){const login=loginName(b.login),old=c.members.find(x=>x.login===login),roles=b.roles;if(old&&b.createOnly===true)fail('该登录名已有人使用，可改为“'+suggestedMemberLogin(login,c.members.map(m=>m.login))+'”。',409);if(!Array.isArray(roles)||!roles.length||roles.some(r=>!['employee','supervisor','leader'].includes(r))||new Set(roles).size!==roles.length)fail('角色设置无效');if(!old&&c.members.length>=200)fail('成员数量已达测试版容量');if(old?.active&&b.active===false)assertMemberCanDeactivate(c,login);const m:Member={login,name:text(b.name,40,true),roles,managerId:old?.managerId??'owner',active:b.active!==false};c.members=c.members.filter(x=>x.login!==login);c.members.push(m);c.revision++;await saveDirectory(tx,c);return{member:m};}
 if(b.action==='policy'){if(![30,90,180,365].includes(b.daily))fail('保留份数无效');c.policy={daily:b.daily,monthly:0,yearly:0};c.revision++;await saveDirectory(tx,c);return{ok:true};}
 if(b.action==='view'){
  const supervised=b.scope==='supervised'?supervisedProjects(member):null;
  const scope=supervised?'summary':b.scope||'mine';
  const progressReviewer=!!member&&activeProjects(c).some(p=>p.approvalChain?.includes(uid)||hasPendingApproval(c,p.id,uid)||isCurrentApprover(actor,c,p)||member.roles.includes('leader')&&p.progressLeaderLogin===uid);
  if(!['mine','review','summary','manage'].includes(scope)||scope==='manage'&&!actor.owner||scope==='review'&&!actor.owner&&!member!.roles.includes('supervisor')&&!progressReviewer||scope==='summary'&&!supervised&&!actor.owner&&!member!.roles.includes('leader'))fail('没有该视图的权限',403);
  const selected=activeProjects(c).filter(h=>{
   if(scope==='manage')return true;
   if(scope==='review')return canConfirmProgress(actor,c,h);
   if(scope==='summary'){
    if(!h.publishedVersion)return false;
    if(supervised)return supervised(h);
    return actor.owner||ability.can('published',projectSubject({...h,companyId:c.id,published:{version:h.publishedVersion}} as Project));
   }
   return ability.can('read',projectSubject({...h,companyId:c.id,published:null} as Project));
  });
  const page=Number.isSafeInteger(b.page)&&b.page>=0?b.page:0,projects=[];
  for(const h of selected.slice(page*20,page*20+20)){
   const p=await projectAt(tx,c,h.id);
   if(scope==='review'&&(p.version!==h.version||!canConfirmProgress(actor,c,p)))fail('待确认项目与目录不一致，请刷新',409);
   if(scope==='summary'){projects.push(p.published);continue;}
   const supervisorOwner=c.members.some(m=>m.login===p.ownerLogin&&m.roles.includes('supervisor'));
   const assigned=p.status==='submitted'?p.progressReviewLogin:supervisorOwner&&p.progressLeaderLogin;
   const legacy=assigned||(p.reviewerLogin===(p.status==='submitted'?p.submittedBy:p.ownerLogin)?'owner':p.reviewerLogin);
   const recipients=p.status==='submitted'?[legacy]:p.approvalChain||[legacy];
   projects.push({...p,approvalPreview:approvalPreview(c.members,recipients)});
  }
  return{company:{id:c.id,name:c.name,revision:c.revision,policy:c.policy,members:actor.owner?c.members:[],projectCount:supervised?selected.length:activeProjects(c).length,...(scope==='manage'&&actor.owner?{trashed:c.projects.filter(p=>p.deletedAt).map(({id,name,version,deletedAt})=>({id,name,version,deletedAt}))}:{})},me:{...(member&&c.organizationLevels?{organizationLevel:c.organizationLevels.find(level=>level.id===organizationLevelFor(c,member))?.name}:{}),login:uid,name:actor.owner?'管理员':member!.name,roles:actor.owner?['admin','supervisor','leader']:member!.roles,progressReviewer},projects,total:selected.length,page};
 }
 if(b.action==='project.create'){if(c.projects.length>=200)fail('项目数量已达测试版容量');const ownerLogin=loginName(b.ownerLogin),reviewerLogin=b.reviewerLogin==='owner'?'owner':loginName(b.reviewerLogin);if(!c.members.some(m=>m.login===ownerLogin&&m.active&&m.roles.some(r=>r==='employee'||r==='supervisor')))fail('请指定有效的项目负责人');if(reviewerLogin!=='owner'&&!c.members.some(m=>m.login===reviewerLogin&&m.active&&m.roles.includes('supervisor')))fail('请指定有效的确认主管');if(!Array.isArray(b.participants)||b.participants.some((u:unknown)=>!c.members.some(m=>m.login===u&&m.active)))fail('项目参与人无效');const leader=progressLeader(c,b.progressLeaderLogin,ownerLogin);const p:Project={...(b.approvalChain!==undefined?{approvalChain:validatedApprovalChain(c,b.approvalChain)}:{}),...(leader?{progressLeaderLogin:leader}:{}),id:'p_'+randomUUID().replaceAll('-','').slice(0,24),companyId:c.id,name:text(b.name,80,true),ownerLogin,reviewerLogin,participants:[...new Set<string>([ownerLogin,...b.participants])],status:'draft',version:1,publishedVersion:0,submittedBy:'',progress:0,achievement:'',risk:'',next:'',createdAt:clock.toISOString(),updatedAt:clock.toISOString(),comment:'',reviewerName:'',published:null};return writeProject(tx,c,p,b.action,actor,clock);}
 if(b.action==='project.trash'||b.action==='project.untrash'){
  const project=await projectAt(tx,c,b.id,true),removing=b.action==='project.trash';
  if(project.version!==b.version||c.revision!==b.revision||!!project.deletedAt===removing)fail('项目或关联数据已发生变化，请刷新后操作',409);
  const next={...project,version:project.version+1,updatedAt:clock.toISOString()};
  if(removing)next.deletedAt=next.updatedAt;else delete next.deletedAt;
  return writeProject(tx,c,next,b.action,actor,clock);
 }
 const p0=await projectAt(tx,c,b.id);if(b.action==='history'){if(!ability.can('read',projectSubject(p0)))fail('没有该项目历史的权限',403);const versions=[];for(let v=p0.version;v>Math.max(0,p0.version-20);v--){const item=await tx.get<Version>(versionKey(p0.id,v));if(item&&(actor.owner||p0.ownerLogin===uid||item.project.status!=='draft'))versions.push(item);}return{versions};}
 if(b.version!==p0.version)fail('项目已发生变化，请刷新后操作',409);let p={...p0},event='';
 if(b.action==='project.save'){if(!ability.can('edit',projectSubject(p))||!['draft','returned'].includes(p.status))fail('没有修改该项目的权限',403);if(!Number.isInteger(b.progress)||b.progress<0||b.progress>100)fail('进度填写0~100的整数');p={...p,progress:b.progress,achievement:text(b.achievement,4000,true),risk:text(b.risk,2000),next:text(b.next,2000)};}
 else if(b.action==='project.configure'){if(!actor.owner)fail('只有管理员可调整项目人员',403);const ownerLogin=loginName(b.ownerLogin),reviewerLogin=b.reviewerLogin==='owner'?'owner':loginName(b.reviewerLogin);if(!c.members.some(m=>m.login===ownerLogin&&m.active&&m.roles.some(r=>r==='employee'||r==='supervisor'))||reviewerLogin!=='owner'&&!c.members.some(m=>m.login===reviewerLogin&&m.active&&m.roles.includes('supervisor')))fail('负责人或主管无效');if(!Array.isArray(b.participants)||b.participants.some((u:unknown)=>!c.members.some(m=>m.login===u&&m.active)))fail('参与人无效');const leader=progressLeader(c,b.progressLeaderLogin??p.progressLeaderLogin,ownerLogin);
  const participants=[...new Set<string>([ownerLogin,...b.participants])],name=text(b.name,80,true);
  const onlyLeader=leader!==p.progressLeaderLogin&&p.name===name&&p.ownerLogin===ownerLogin&&p.reviewerLogin===reviewerLogin&&p.participants.length===participants.length&&participants.every(u=>p.participants.includes(u));
  delete p.progressLeaderLogin;if(!onlyLeader||p.status!=='approved')delete p.progressReviewLogin;if(leader)p.progressLeaderLogin=leader;
  if(onlyLeader){if(p.status==='submitted'&&leader&&c.members.some(m=>m.login===p.submittedBy&&m.roles.includes('supervisor')))p.progressReviewLogin=leader;}
  else p={...p,name,ownerLogin,reviewerLogin,participants,status:'draft',comment:'项目设置已调整，请重新提交确认',reviewerName:''};}
 else if(b.action==='project.submit'){
  if(!ability.can('submit',projectSubject(p))||!p.achievement)fail('没有提交权限或尚未填写项目成果',403);
  if(p.ownerLogin!==uid)fail('请由项目负责人提交',403);
  delete p.progressReviewLogin;
  delete p.approvalFlow;
  const flow=submissionFlow(c,p,uid);
  if(flow)p.approvalFlow=flow;
  else if(p.progressLeaderLogin&&member?.roles.includes('supervisor'))p.progressReviewLogin=progressLeader(c,p.progressLeaderLogin,uid);
  event='SUBMIT';p.submittedAt=clock.toISOString();p.submittedBy=uid;p.comment='';p.reviewerName='';
 }
 else if(b.action==='project.amend'){if(!ability.can('amend',projectSubject(p)))fail('没有更正该项目的权限',403);event='AMEND';p.submittedAt=null;p.comment='';}
 else if(b.action==='project.approve'||b.action==='project.return'){
  if(!canConfirmProgress(actor,c,p))fail('没有该项目确认权限或不能确认本人提交',403);
  p.comment=text(b.comment,1000,b.action==='project.return');
  p.reviewerName=actor.owner?'管理员':member!.name;
  const next=b.action==='project.approve'?nextApprovalStep(p.approvalFlow):undefined;
  if(next)p.approvalFlow=next;
  else event=b.action==='project.approve'?'APPROVE':'RETURN';
 }
 else if(b.action==='project.restore'){if(!actor.owner)fail('只有管理员可恢复项目历史',403);if(!Number.isSafeInteger(b.targetVersion)||b.targetVersion<1||b.targetVersion>p.version)fail('历史版本无效');const doc=await tx.get<{payload:string;checksum:string}>(versionKey(p.id,b.targetVersion),true);if(!doc||digest(doc.payload)!==doc.checksum)fail('备份完整性校验失败');const old=(JSON.parse(doc.payload) as Version).project;if(old.id!==p.id||old.companyId!==c.id)fail('备份关系校验失败');p={...p,progress:old.progress,achievement:old.achievement,risk:old.risk,next:old.next,work:{items:old.work?.items||[],nudges:(p.work?.nudges||[]).filter(n=>n.kind!=='item'||old.work?.items.some(i=>i.id===n.targetId))},submittedAt:null,status:'draft',comment:'已恢复历史内容，需重新提交确认',reviewerName:''};}
 else fail('不支持的公司操作');
 if(event){
  const status=transitionStage(p.status,event);
  if(status===p.status)fail('当前状态不能执行该操作',409);
  p.status=status;
 }
 if(p.status==='draft')delete p.approvalFlow;
 p.version++;p.updatedAt=clock.toISOString();
 if(b.action==='project.approve'&&p.status==='approved'){
  const{published,...snapshot}=p;
  p.published={...snapshot,publishedVersion:p.version};p.publishedVersion=p.version;
 }
 const action=b.action==='project.approve'&&p.status==='submitted'?'project.approveStep':b.action;
 return writeProject(tx,c,p,action,actor,clock);
}
