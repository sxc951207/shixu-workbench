import {activeProjects} from './model.ts';
import {randomUUID} from 'node:crypto';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {extendsOperatingDefinition,operatingConfigSchema,operatingProposalSchema} from '../../lib/workbench/operating-data.ts';
import {assertOperatingYuanUnit} from '../../lib/workbench/operating-field-dictionary.ts';
import {operatingMetricUnitIssue} from '../../lib/workbench/operating-templates.ts';
import {digest,projectAt,saveDirectory,text} from './core.ts';
import type {Actor,Company,Member,ProjectHead} from './model.ts';
import type {OperatingConfig,OperatingProposal,OperatingTemplate} from './operating-model.ts';
import type {CompanyTx} from './store.ts';

type Mode='admin'|'supervisor'|'employee'|'leader';
type Parameters=Record<string,unknown>;
function isObject(input:unknown):input is Parameters{
 return input!==null&&typeof input==='object'&&!Array.isArray(input);
}
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
const configAt=(c:Company,id:string)=>c.operatingConfigs?.find(config=>config.projectId===id)||null;
export function indicatorBaseDigest(config:OperatingConfig|null){
 const shape=config&&{stores:config.stores,builtinSheets:config.builtinSheets,templates:config.templates,dimensionLabel:config.dimensionLabel};
 return digest(JSON.stringify(shape,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v));
}
function assignedEmployee(member:Member|null|undefined,p:ProjectHead){
 return !!member?.active&&((p.ownerLogin===member.login&&member.roles.some(r=>r==='employee'||r==='supervisor'))||
  (member.roles.includes('employee')&&p.participants.includes(member.login)));
}
function indicatorMode(actor:Actor,member:Member|null|undefined,p:ProjectHead,config:OperatingConfig|null):Mode|null{
 if(actor.owner)return 'admin';
 if(member?.roles.includes('supervisor')&&p.reviewerLogin===member.login)return 'supervisor';
 if(assignedEmployee(member,p))return 'employee';
 if(member?.roles.includes('leader')&&(p.publishedVersion||config?.confirmedProjectName))return 'leader';
 return null;
}
function employeeConfig(config:OperatingConfig):OperatingConfig{
 return {projectId:config.projectId,stores:config.stores,builtinSheets:[],templates:config.templates?.filter(t=>t.writer==='project-owner')||[],
  ...(config.dimensionLabel?{dimensionLabel:config.dimensionLabel}:{})};
}
function validateConfig(input:unknown,old:OperatingConfig|null):OperatingConfig{
 const parsed=operatingConfigSchema.safeParse(input);
 if(!parsed.success)fail('门店或模板字段配置无效：'+parsed.error.issues[0].message);
 const config=parsed.data;
 if(old?.stores.some(s=>!config.stores.some(n=>n.id===s.id)))fail('已配置的门店不能删除');
 for(const template of old?.templates||[]){
  const next=config.templates?.find(t=>t.id===template.id);
  if(!next)fail('旧模板不能删除，可停用并保留历史');
  if(!extendsOperatingDefinition(template,next))fail('已有字段或计算规则不能改写，只能在末尾追加指标');
 }
 for(const template of config.templates||[]){
  const previous=old?.templates?.find(t=>t.id===template.id);
  for(const field of template.fields.slice(previous?.fields.length||0))assertOperatingYuanUnit(field.label);
  for(const metric of template.metrics.slice(previous?.metrics.length||0)){
   const issue=operatingMetricUnitIssue(template.fields,metric);if(issue)fail(issue);
  }
 }
 return config;
}
function mergeEmployeeConfig(projectId:string,input:Parameters,old:OperatingConfig|null){
 if(!Array.isArray(input.templates)||!input.templates.length||input.templates.some(t=>!isObject(t)||t.writer!=='project-owner'))fail('员工模板的填写人必须为项目负责人',403);
 if(input.templates.some(t=>old?.templates?.some(o=>o.id===t.id&&o.writer!=='project-owner')))fail('模板编号已被使用，请复制为新模板');
 if(old&&(old.stores.some(s=>!Array.isArray(input.stores)||!input.stores.some(n=>isObject(n)&&n.id===s.id&&n.name===s.name))||
  input.dimensionLabel!==undefined&&input.dimensionLabel!==(old.dimensionLabel||'门店')))fail('已有分行名称由管理员维护，可追加新行',403);
 return validateConfig({...old,projectId,stores:input.stores,templates:[...(old?.templates||[]).filter(t=>t.writer!=='project-owner'),...input.templates],
  ...(!old?{builtinSheets:[]}:{}),...(input.dimensionLabel!==undefined?{dimensionLabel:input.dimensionLabel}:{})},old);
}
function append(config:OperatingConfig|null,projectId:string,addition:unknown,employee=false){
 if(!isObject(addition)||Object.keys(addition).some(k=>!['templateId','fields','metrics','field','metric'].includes(k)))fail('补充指标参数无效');
 if(addition.field!==undefined&&addition.fields!==undefined||addition.metric!==undefined&&addition.metrics!==undefined)fail('指标参数重复');
 const fields=addition.fields??(addition.field!==undefined?[addition.field]:[]),metrics=addition.metrics??(addition.metric!==undefined?[addition.metric]:[]);
 if(!Array.isArray(fields)||!Array.isArray(metrics)||!fields.length&&!metrics.length)fail('请至少添加一个字段或计算指标');
 const model=config||{projectId,stores:[],builtinSheets:[]},templates=[...(model.templates||[])];
 if(addition.templateId!==undefined){
  const index=templates.findIndex(t=>t.id===addition.templateId);
  if(index<0||employee&&templates[index].writer!=='project-owner')fail('没有该模板的指标配置权限',403);
  const old=templates[index];
  templates[index]={...old,fields:[...old.fields,...fields],metrics:[...old.metrics,...metrics]};
 }else{
  if(!fields.length)fail('首次配置请先添加填写字段');
  let name='项目补充指标',suffix=2;
  while(templates.some(t=>t.name===name))name='项目补充指标 '+suffix++;
  const template:OperatingTemplate={id:'tpl_'+randomUUID().replaceAll('-','').slice(0,20),name,description:'',writer:'project-owner',dimension:'total',fields,metrics,active:true};
  templates.push(template);
 }
 return validateConfig({...model,templates},config);
}
function visibleProposal(p:OperatingProposal|null){
 if(!p)return null;
 const {id,projectId,status,submittedBy,submittedName,submittedAt,comment,config}=p;
 return {id,projectId,status,submittedBy,submittedName,submittedAt,comment,config};
}
async function persist(tx:CompanyTx,c:Company){
 c.revision++;
 if(Buffer.byteLength(JSON.stringify(c))>900000)fail('公司模板配置较大，保存已停止');
 await saveDirectory(tx,c);
}
function setConfig(c:Company,config:OperatingConfig){
 const note=configAt(c,config.projectId)?.revenueNote;if(note)config={...config,revenueNote:note};
 c.operatingConfigs=[...(c.operatingConfigs||[]).filter(x=>x.projectId!==config.projectId),config];
}
export async function executeIndicators(tx:CompanyTx,c:Company,actor:Actor,member:Member|null|undefined,b:Parameters,clock:Date){
 if(b.action==='ops.options'){
  const projects=[];
  for(const head of activeProjects(c)){
   const config=configAt(c,head.id),mode=indicatorMode(actor,member,head,config);
   if(!mode)continue;
   const name=mode==='leader'?(await projectAt(tx,c,head.id)).published?.name||config?.confirmedProjectName:head.name;
   if(name)projects.push({id:head.id,name,enabled:!!config});
  }
  return {projects,companyRevision:c.revision};
 }
 const p=await projectAt(tx,c,b.projectId),old=configAt(c,p.id),mode=indicatorMode(actor,member,p,old);
 if(!mode)fail('没有本项目的指标配置权限',403);
 const supervisor=c.members.find(m=>m.active&&m.login===p.reviewerLogin&&m.roles.includes('supervisor'));
 const proposal=c.operatingProposals?.find(q=>q.projectId===p.id)||null;
 const review=mode==='admin'||mode==='supervisor',self=!!proposal&&member?.login===proposal.submittedBy;
 const visibleConfig=old&&mode==='employee'?employeeConfig(old):old;
 if(b.revision!==undefined&&b.revision!==c.revision)fail('公司设置已发生变化，请刷新',409);
 if(b.action==='ops.month')return {
  project:{id:p.id,name:mode==='leader'?p.published?.name||old?.confirmedProjectName:p.name},
  config:visibleConfig,proposal:review||mode==='employee'&&self?visibleProposal(proposal):null,records:[],pendingChanges:0,total:0,page:0,nextPage:null,
  permissions:{configureIndicators:true,indicatorMode:mode,reviewIndicators:review&&!self,revenue:false,platform:false,configure:false,configureOwn:false,projectOwner:false},companyRevision:c.revision
 };
 if(b.revision!==c.revision)fail('公司设置已发生变化，请刷新',409);
 if(!supervisor)fail('请先为项目指定一位已启用的主管');
 if(b.action==='ops.reviewIndicators'){
  if(!review||self)fail('只有指定主管或管理员可以独立确认其他人提交的指标',403);
  if(!proposal||proposal.id!==b.proposalId||proposal.status!=='submitted')fail('待确认指标已变化，请刷新',409);
  if(typeof b.approve!=='boolean')fail('请明确确认或退回');
  if(b.approve){
   if(!assignedEmployee(c.members.find(m=>m.login===proposal.submittedBy),p))fail('提交人已没有本项目的配置权限，请退回后重新提交',409);
   if(indicatorBaseDigest(old)!==proposal.baseDigest)fail('正式指标配置已变化，请退回并重新提交',409);
   let config=mergeEmployeeConfig(p.id,proposal.config,old);
   if(b.addition!==undefined)config=append(config,p.id,b.addition);
   setConfig(c,config);
   c.operatingProposals=c.operatingProposals!.filter(q=>q.projectId!==p.id);
   await persist(tx,c);
   return {config,proposal:null,companyRevision:c.revision};
  }
  if(typeof b.comment!=='string'||!b.comment.trim())fail('请填写退回原因');
  proposal.comment=text(b.comment,1000,true);proposal.status='returned';
  await persist(tx,c);
  return {config:old,proposal:visibleProposal(proposal),companyRevision:c.revision};
 }
 let config:OperatingConfig;
 if(b.action==='ops.appendIndicator'){
  const addition=Object.fromEntries(Object.entries(b).filter(([key])=>!['companyId','action','projectId','revision'].includes(key)));
  config=append(old,p.id,addition,mode==='employee');
  if(mode!=='employee'){
   setConfig(c,config);await persist(tx,c);return {config,companyRevision:c.revision};
  }
 }else{
  if(mode!=='employee')fail('仅本项目参与员工或负责人有权提交自己的指标配置',403);
  if(b.builtinSheets!==undefined)fail('无权调整管理员标准套表',403);
  config=mergeEmployeeConfig(p.id,b,old);
 }
 if(proposal?.status==='submitted'&&!self&&assignedEmployee(c.members.find(m=>m.login===proposal.submittedBy),p))fail('本项目已有其他员工的待确认指标，请主管处理后再提交',409);
 const submitted:OperatingProposal={id:'ip_'+randomUUID().replaceAll('-','').slice(0,24),projectId:p.id,status:'submitted',submittedBy:member!.login,submittedName:member!.name,submittedAt:clock.toISOString(),comment:'',config:employeeConfig(config),baseDigest:indicatorBaseDigest(old)};
 operatingProposalSchema.parse(submitted);
 c.operatingProposals=[...(c.operatingProposals||[]).filter(q=>q.projectId!==p.id),submitted];
 await persist(tx,c);
 return {config:visibleConfig,proposal:visibleProposal(submitted),companyRevision:c.revision};
}
