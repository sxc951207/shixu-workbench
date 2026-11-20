import {isDeepStrictEqual} from 'node:util';
import {submissionFlow,isCurrentApprover,nextApprovalStep,updatePendingApprovers} from './approval-flow.ts';
import {activeProjects} from './model.ts';
import {supervisedProjects} from './supervised.ts';
import {approvalPreview} from '../../lib/workbench/approval-display.ts';
import {operatingColumnRules} from './operating-column-rules.ts';
import {operatingStoreAliases} from './operating-alias.ts';
import {executeIndicators} from './operating-indicators.ts';
import {confirmedAmountChange} from './confirmed-amount-change.ts';
import {recordConfirmedCorrection} from './corrections.ts';
import type {Actor,Company,Project,Member} from './model.ts';
import type {CompanyTx} from './store.ts';
import type {OperatingRecord,OperatingHead,OperatingIndex,OperatingConfig,OperatingSheet,OperatingStore,OperatingTemplate,OperatingVersion} from './operating-model.ts';
import {companyKey,digest,loadCompany,projectAt,saveDirectory,text} from './core.ts';
import {WorkbenchError,todayShanghai} from '../../lib/workbench/domain.ts';
import {addDays} from '../../lib/workbench/productivity.ts';
import {fillPriority,operatingSheetNames,type OperatingHomeFill,type OperatingHomeResult} from '../../lib/workbench/operating-work-queue.ts';
import {operatingFields,operatingConfigSchema,operatingRecordSchema,submissionBatchIdSchema,operatingDate,revenueDraftIssue,validateOperatingRows} from '../../lib/workbench/operating-data.ts';
import {assertOperatingYuanUnit} from '../../lib/workbench/operating-field-dictionary.ts';
import {operatingMetricUnitIssue} from '../../lib/workbench/operating-templates.ts';
const builtins=['revenue','targets','meituan','douyin','meituan-stores','douyin-stores'] as const;
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
export const operatingIndexKey=(companyId:string,month:string)=>'operating_index_'+companyId+'_'+month;
export const operatingVersionKey=(id:string,version:number)=>'operating_version_'+id+'_'+version;
export function operatingHead(r:OperatingRecord):OperatingHead{return{...(r.approvalFlow?{approvalFlow:r.approvalFlow}:{}),id:r.id,projectId:r.projectId,sheet:r.sheet,date:r.date,status:r.status,version:r.version,publishedVersion:r.publishedVersion,submittedBy:r.submittedBy};}
export function operatingId(companyId:string,projectId:string,sheet:string,date:string){return'op_'+digest(companyId+':'+projectId+':'+sheet+':'+date).slice(0,32);}
const isCustom=(sheet:string)=>sheet.startsWith('tpl_');
function validMonth(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'1970-01'||value>'2100-12')fail('月份无效');return value;}
function validateVersion(value:unknown){if(!Number.isSafeInteger(value)||(value as number)<0)fail('记录版本无效');}
function configAt(c:Company,projectId:string){return c.operatingConfigs?.find(x=>x.projectId===projectId)||null;}
function realSupervisor(c:Company,p:Pick<Project,'reviewerLogin'>){return c.members.find(m=>m.login===p.reviewerLogin&&m.active&&m.roles.includes('supervisor'))||null;}
function platformContributor(member:Member|null|undefined,p:Pick<Project,'ownerLogin'|'participants'>){return !!member&&member.roles.includes('employee')&&(p.ownerLogin===member.login||p.participants.includes(member.login));}
function platformSheet(sheet:string){return ['meituan','douyin','meituan-stores','douyin-stores'].includes(sheet);}
function access(actor:Actor,member:Member|null|undefined,c:Company,p:Project){const supervisor=realSupervisor(c,p),all=!!actor.owner||!!member&&member.login===supervisor?.login,projectOwner=!!member&&p.ownerLogin===member.login&&member.roles.some(r=>r==='employee'||r==='supervisor');const platform=!!actor.owner||platformContributor(member,p);return{live:all||projectOwner||platform,all,projectOwner,platform,leader:!!actor.owner||!!member?.roles.includes('leader')&&!!(p.published||configAt(c,p.id)?.confirmedProjectName),supervisor};}
function templateAt(config:OperatingConfig,sheet:string){return config.templates?.find(x=>x.id===sheet);}
function sheetEnabled(config:OperatingConfig,sheet:string){return isCustom(sheet)?!!templateAt(config,sheet)?.active:(config.builtinSheets||builtins).includes(sheet as any);}
function writerFor(sheet:string,config:OperatingConfig){return isCustom(sheet)?templateAt(config,sheet)?.writer:sheet==='revenue'||sheet==='targets'?'supervisor':'owner';}
function canWrite(actor:Actor,member:Member|null|undefined,c:Company,p:Pick<Project,'ownerLogin'|'reviewerLogin'|'participants'>,config:OperatingConfig,sheet:string){const writer=writerFor(sheet,config);return !!actor.owner||platformSheet(sheet)&&platformContributor(member,p)||writer==='supervisor'&&!!member&&realSupervisor(c,p)?.login===member.login||writer==='project-owner'&&!!member&&p.ownerLogin===member.login&&member.roles.some(r=>r==='employee'||r==='supervisor');}
function canReadSheet(actor:Actor,member:Member|null|undefined,c:Company,p:Project,config:OperatingConfig|null,sheet:string){return !!actor.owner||platformSheet(sheet)&&platformContributor(member,p)||!!member&&realSupervisor(c,p)?.login===member.login||!!config&&isCustom(sheet)&&writerFor(sheet,config)==='project-owner'&&!!member&&p.ownerLogin===member.login&&member.roles.some(r=>r==='employee'||r==='supervisor');}
export function operatingReviewerLogin(c:Company,p:Project,r:OperatingRecord,viewer?:string){if(r.approvalFlow)return r.approvalFlow.steps[r.approvalFlow.index];const supervisor=realSupervisor(c,p)?.login;if(viewer==='owner'&&r.submittedBy!=='owner'&&(r.submittedBy===supervisor||r.reviewerLogin==='owner'))return 'owner';return supervisor||(r.reviewerLogin==='owner'&&r.submittedBy!=='owner'?'owner':'');}
function currentProjection(c:Company,p:Project,r:OperatingRecord,viewer:string):OperatingRecord&{approvalPreview?:string[]}{
 if(r.status!=='submitted')return r;
 const reviewerLogin=operatingReviewerLogin(c,p,r,viewer);
 return {...r,reviewerLogin,approvalPreview:approvalPreview(c.members,[reviewerLogin])};
}
function leaderProjection(r:OperatingRecord):OperatingRecord|null{return r.published?{...r.published,published:structuredClone(r.published)}:null;}
function snapshotConfig(projectId:string,records:OperatingRecord[]):OperatingConfig{const stores=new Map<string,OperatingStore>(),templates=new Map<string,OperatingTemplate>(),enabled=new Set<string>();for(const r of records){if(r.template)templates.set(r.template.id,r.template);else enabled.add(r.sheet);for(const row of r.rows)if(row.storeId!=='all')stores.set(row.storeId,{id:row.storeId,name:row.storeName});}return{projectId,stores:[...stores.values()],templates:[...templates.values()],builtinSheets:[...enabled]as any,dimensionLabel:'明细项'};}
export async function readIndex(tx:CompanyTx,c:Company,month:string){
 const meta=c.operatingMonths?.[month],index=await tx.get<OperatingIndex>(operatingIndexKey(c.id,month));
 if(!meta&&!index)return {revision:0,versions:0,items:[]} as OperatingIndex;
 if(!meta||!index||!Array.isArray(index.items)||index.items.length!==meta.count||index.items.length>2000||index.revision!==meta.revision||index.versions!==meta.versions||index.items.reduce((n,h)=>n+h.version,0)!==index.versions||new Set(index.items.map(h=>h.id)).size!==index.items.length)fail('经营数据目录不完整，请联系管理员',409);
 for(const head of index.items){
  if(head.date.slice(0,7)!==month||!Number.isSafeInteger(head.version)||head.version<1||!Number.isSafeInteger(head.publishedVersion)||head.publishedVersion<0||head.publishedVersion>head.version||head.status==='approved'&&head.version!==head.publishedVersion||head.id!==operatingId(c.id,head.projectId,head.sheet,head.date))fail('经营数据目录身份或版本不一致，请联系管理员',409);
 }
 return index;
}
async function write(tx:CompanyTx,c:Company,r:OperatingRecord,actor:Actor,member:Member|null|undefined,action:string,clock:Date){
 const parsed=operatingRecordSchema.safeParse(r);if(!parsed.success)fail('经营记录结构校验失败，请保留内容并检查字段');
 const month=r.date.slice(0,7),key=operatingIndexKey(c.id,month),index=await readIndex(tx,c,month),old=index.items.find(h=>h.id===r.id);
 if(!old&&index.items.length>=2000)fail('当月经营记录已达容量，请联系管理员');
 if(old?old.version!==r.version-1:r.version!==1)fail('经营记录目录版本已变化，请刷新',409);
 updatePendingApprovers(c,r.projectId,old,r);
 index.items=index.items.filter(h=>h.id!==r.id);index.items.push(operatingHead(r));index.revision++;index.versions++;
 if(Buffer.byteLength(JSON.stringify(index))>900000)fail('当月经营目录较大，保存已停止，请联系管理员');
 const version:OperatingVersion={operating:r,action,actor:actor.owner?'管理员':member!.name,at:clock.toISOString()},payload=JSON.stringify(version),indexPayload=JSON.stringify(index);
 await tx.put(r.id,r);await tx.put(operatingVersionKey(r.id,r.version),version);await tx.put(operatingVersionKey(r.id,r.version),{payload,checksum:digest(payload)},true);await tx.put(key,index);await tx.put(key+'_'+index.revision,{payload:indexPayload,checksum:digest(indexPayload)},true);
 c.operatingMonths={...c.operatingMonths,[month]:{revision:index.revision,versions:index.versions,count:index.items.length}};c.revision++;await saveDirectory(tx,c);return{record:r,companyRevision:c.revision};
}
function canonicalRows(sheet:OperatingSheet,rows:any,config:OperatingConfig,old?:OperatingRecord,template?:OperatingTemplate){
 if(!Array.isArray(rows))fail('经营字段或门店行无效');
 const isPlatform=sheet==='meituan'||sheet==='douyin',isTotal=isCustom(sheet)?template?.dimension==='total':isPlatform&&rows.length===1&&rows[0]?.storeId==='all';
 let stores:OperatingStore[]=isTotal?[{id:'all',name:isCustom(sheet)?'全项目':'全平台'}]:old&&old.rows[0]?.storeId!=='all'?old.rows.map(r=>({id:r.storeId,name:r.storeName})):config.stores;
 const names=new Map(stores.map(s=>[s.id,s.name]));const canonical=rows.map((row:any)=>row&&typeof row==='object'?{...row,storeName:names.get(row.storeId)||row.storeName}:row);
 return validateOperatingRows(sheet,canonical,stores,false,template);
}
export async function executeOperating(tx:CompanyTx,actor:Actor,b:any,clock=new Date()):Promise<any>{
 const{c,member}=await loadCompany(tx,actor,b.companyId),uid=actor.owner?'owner':actor.login!;
 if(b.action==='ops.nextFill'){
  const day=addDays(todayShanghai(clock),-1),month=day.slice(0,7);
  const previousMonth=addDays(month+'-01',-1).slice(0,7);
  const result:OperatingHomeResult={since:previousMonth+'-01',day,item:null};
  if(!member?.roles.includes('employee')||actor.owner)return result;
  const projects=activeProjects(c).filter(p=>platformContributor(member,p)&&configAt(c,p.id));
  if(!projects.length)return result;
  const headsBySheet=new Map<string,OperatingHead[]>();
  for(const period of [previousMonth,month]){
   const index=await readIndex(tx,c,period);
   for(const head of index.items){
    if(head.date>day)continue;
    const key=head.projectId+':'+head.sheet;
    const heads=headsBySheet.get(key);
    if(heads)heads.push(head);else headsBySheet.set(key,[head]);
   }
  }
  const items:OperatingHomeFill[]=[];
  for(const project of projects){
   const config=configAt(c,project.id)!;
   const sheets:OperatingSheet[]=[...builtins,...(config.templates||[]).map(t=>t.id as OperatingSheet)];
   for(const sheet of sheets){
    if(sheet.endsWith('-stores')||!canWrite(actor,member,c,project,config,sheet))continue;
    const heads=headsBySheet.get(project.id+':'+sheet)||[];
    const label={companyId:c.id,projectId:project.id,projectName:project.name,sheet,name:templateAt(config,sheet)?.name||operatingSheetNames[sheet]};
    for(const head of heads){
     if(head.status==='returned'||head.status==='draft')items.push({...label,date:head.date,status:head.status});
    }
    const date=sheet==='targets'?month+'-01':day;
    if(sheetEnabled(config,sheet)&&!heads.some(head=>head.date===date))items.push({...label,date,status:'missing'});
   }
  }
  items.sort((a,b)=>fillPriority(a.status)-fillPriority(b.status)||a.date.localeCompare(b.date)||a.projectName.localeCompare(b.projectName,'zh-CN')||a.name.localeCompare(b.name,'zh-CN'));
  result.item=items[0]||null;
  return result;
 }
 if(((b.action==='ops.options'||b.action==='ops.month')&&b.scope==='indicators')||
  ['ops.configureOwn','ops.proposeIndicators','ops.appendIndicator','ops.reviewIndicators'].includes(b.action)){
  return executeIndicators(tx,c,actor,member,b,clock);
 }
 if(['ops.storeAlias.list','ops.storeAlias.save','ops.columnRules.read','ops.columnRules.save'].includes(b.action)){
  const p=await projectAt(tx,c,b.projectId),config=configAt(c,p.id),sheet=text(b.sheet,80,true);
  if(!config||!(builtins.includes(sheet as any)||templateAt(config,sheet))||!canWrite(actor,member,c,p,config,sheet))fail('没有配置该表门店对应的权限',403);
  if(b.action.startsWith('ops.columnRules.'))return operatingColumnRules(tx,c.id,p.id,sheet,operatingFields(sheet as OperatingSheet,templateAt(config,sheet)),b);
  return operatingStoreAliases(tx,c.id,config,b);
 }
 if(b.action==='ops.options'){
  const supervised=b.scope==='supervised'?supervisedProjects(member):null;
  if(b.scope!==undefined&&!supervised&&!['working','summary'].includes(b.scope))fail('经营数据口径无效');
  const projects=[];for(const h of activeProjects(c)){const current=actor.owner||platformContributor(member,h)||!!member&&member.roles.includes('supervisor')&&h.reviewerLogin===uid||!!member&&h.ownerLogin===uid&&member.roles.some(r=>r==='employee'||r==='supervisor');
   if(supervised||b.scope==='summary'){const config=configAt(c,h.id);if((supervised?supervised(h):current||member?.roles.includes('leader'))&&(h.publishedVersion||config?.confirmedProjectName)){const p=await projectAt(tx,c,h.id),name=p.published?.name||config?.confirmedProjectName;if(name)projects.push({id:p.id,name,enabled:!!config});}continue;}
   if(current)projects.push({id:h.id,name:h.name,enabled:!!configAt(c,h.id)});
   else if(member?.roles.includes('leader')&&configAt(c,h.id)&&(h.publishedVersion||configAt(c,h.id)?.confirmedProjectName)){const p=await projectAt(tx,c,h.id);projects.push({id:p.id,name:p.published?.name||configAt(c,p.id)!.confirmedProjectName!,enabled:true});}}
  return{projects,companyRevision:c.revision};
 }
 if(b.action==='ops.revenueNote'){
  const p=await projectAt(tx,c,b.projectId),config=configAt(c,p.id);
  if(!access(actor,member,c,p).all)fail('只有项目指定主管或管理员可编辑总业绩说明',403);
  if(!config||config.builtinSheets&&!config.builtinSheets.includes('revenue'))fail('请先启用门店总业绩');
  if(b.revision!==c.revision)fail('项目资料已更新，请刷新后再编辑说明',409);
  const note=text(b.note,300);if(note)config.revenueNote=note;else delete config.revenueNote;
  c.revision++;if(Buffer.byteLength(JSON.stringify(c))>900000)fail('公司配置超过容量');
  await saveDirectory(tx,c);return{companyRevision:c.revision,note};
 }
 if(b.action==='ops.configure'){
  const p=await projectAt(tx,c,b.projectId);
  if(!access(actor,member,c,p).all)fail('只有本项目指定主管或管理员可配置经营模板',403);if(b.revision!==c.revision)fail('公司设置已发生变化，请刷新',409);
  if(!realSupervisor(c,p))fail('请先为项目指定一位已启用的主管');
  const old=configAt(c,p.id);
  const input={...old,projectId:p.id,stores:b.stores,...(b.templates!==undefined?{templates:b.templates}:{}),
   ...(b.builtinSheets!==undefined?{builtinSheets:b.builtinSheets}:{}),...(b.dimensionLabel!==undefined?{dimensionLabel:b.dimensionLabel}:{})};
  const parsed=operatingConfigSchema.safeParse(input);if(!parsed.success)fail('门店或模板字段配置无效');const config=parsed.data as OperatingConfig;
  for(const template of config.templates||[])if(!old?.templates?.some(t=>t.id===template.id)){
   for(const field of template.fields)assertOperatingYuanUnit(field.label);
   for(const metric of template.metrics){const issue=operatingMetricUnitIssue(template.fields,metric);if(issue)fail(issue);}
  }
  if(old){if(old.stores.some(s=>!config.stores.some(n=>n.id===s.id)))fail('已配置的门店不能删除，可保留旧行并新增门店');
   for(const template of old.templates||[]){const next=config.templates?.find(n=>n.id===template.id);if(!next)fail('旧模板不能删除，可停用并保留历史');
    if(JSON.stringify({dimension:template.dimension,fields:template.fields,metrics:template.metrics})!==JSON.stringify({dimension:next.dimension,fields:next.fields,metrics:next.metrics}))fail('已有模板字段或计算规则不能直接改写，请复制为新模板');}}
  c.operatingConfigs=[...(c.operatingConfigs||[]).filter(x=>x.projectId!==p.id),config];c.revision++;if(Buffer.byteLength(JSON.stringify(c))>900000)fail('公司模板配置较大，保存已停止');await saveDirectory(tx,c);return{config,companyRevision:c.revision};
 }
 if(b.action==='ops.month'){
  const p=await projectAt(tx,c,b.projectId),rights=access(actor,member,c,p);if(!rights.live&&!rights.leader)fail('没有该项目经营数据权限',403);
  const supervised=b.scope==='supervised'?supervisedProjects(member):null;
  const month=validMonth(b.month),config=configAt(c,p.id),summary=!!supervised||b.scope==='summary'||!rights.live;
  if(supervised&&(!supervised(p)||!(p.published||config?.confirmedProjectName)))fail('没有该项目主管总览权限',403);
  // Single-day readers request daily facts only. A missing day preserves the monthly API.
  const day=b.day===undefined?undefined:operatingDate(b.day);
  if(day&&(!supervised&&b.scope!=='summary'||day.slice(0,7)!==month||day>todayShanghai(clock)))fail('单日查询需要已确认口径及本月内有效的业务日期');
  const range=b.start!==undefined||b.end!==undefined?{start:operatingDate(b.start),end:operatingDate(b.end)}:null;
  if(range&&(day||!supervised&&b.scope!=='summary'||range.start>range.end||range.start.slice(0,7)!==month||range.end.slice(0,7)!==month||range.end>todayShanghai(clock)))fail('期间查询需要已确认口径及同月内有效的业务日期');
  const first=day??range?.start,last=day??range?.end;
  if(b.revision!==undefined&&b.revision!==c.revision)fail('读取期间经营数据已变化，请重新读取',409);
  const page=b.page===undefined?0:b.page;if(!Number.isSafeInteger(page)||page<0)fail('经营数据页码无效');
  const index=await readIndex(tx,c,month),heads=index.items.filter(h=>h.projectId===p.id&&(!first||h.date>=first&&h.date<=last!&&h.sheet!=='targets'&&!h.sheet.endsWith('-stores'))&&(summary?h.publishedVersion>0&&(!!supervised||rights.leader||canReadSheet(actor,member,c,p,config,h.sheet)):canReadSheet(actor,member,c,p,config,h.sheet))).sort((a,b)=>a.date.localeCompare(b.date)||a.sheet.localeCompare(b.sheet)||a.id.localeCompare(b.id));
  if(b.confirmedChangeSheet!==undefined){
   if(!summary||!range||range.start!==month+'-01'||typeof b.confirmedChangeSheet!=='string'||typeof b.changeField!=='string'||b.changeField.length>100)fail('请选择已确认报表、截止日和金额字段');
   const relevant=heads.filter(head=>head.sheet===b.confirmedChangeSheet);
   if(relevant.length>31||new Set(relevant.map(head=>head.date)).size!==relevant.length)fail('日期记录不唯一，无法核对累计变化',409);
   return confirmedAmountChange(tx,relevant,c.id,b.changeField,operatingVersionKey);
  }
  let pendingChanges=0;
  const records:OperatingRecord[]=[];
  for(const head of heads.slice(page*20,page*20+20)){
   const r=await tx.get<OperatingRecord>(head.id);
   if(!r||r.companyId!==c.id||r.projectId!==p.id||!isDeepStrictEqual(operatingHead(r),head))fail('经营记录与目录不一致，请联系管理员',409);
   if(summary&&!operatingRecordSchema.safeParse(r).success)fail('已确认经营快照与记录不一致，请联系管理员',409);
   const visible=summary?leaderProjection(r):currentProjection(c,p,r,actor.owner?'owner':member!.login);
   if(visible){records.push(visible);if(summary&&r.published&&r.status!=='approved')pendingChanges++;}
  }
  return{...range,...(day?{day}:{}),project:{id:p.id,...(summary?{}:{approvalPreview:approvalPreview(c.members,p.approvalChain||[rights.supervisor?.login||''])}),name:summary?p.published?.name||config?.confirmedProjectName||records[0]?.projectName||'已确认项目':p.name},config:summary?{...snapshotConfig(p.id,records),...(config?.revenueNote?{revenueNote:config.revenueNote}:{})}:!rights.all&&config?{...config,builtinSheets:(config.builtinSheets||builtins).filter(sheet=>rights.platform&&platformSheet(sheet)),templates:config.templates?.filter(t=>rights.projectOwner&&t.writer==='project-owner')}:config,records,pendingChanges,total:heads.length,page,nextPage:(page+1)*20<heads.length?page+1:null,permissions:{revenue:!summary&&rights.all,platform:!summary&&rights.platform,configure:!summary&&(rights.all||rights.projectOwner),configureOwn:!summary&&!rights.all&&rights.projectOwner,projectOwner:!summary&&(!!actor.owner||rights.projectOwner)},companyRevision:c.revision};
 }
 if(b.action==='ops.save'){
  const p=await projectAt(tx,c,b.projectId),rights=access(actor,member,c,p),config=configAt(c,p.id);if(!config)fail('请先启用项目经营模板');
  const sheet=b.sheet as OperatingSheet;if(typeof sheet!=='string'||(isCustom(sheet)?!templateAt(config,sheet):!builtins.includes(sheet as any)))fail('该模板不存在');
  if(!rights.live||!canWrite(actor,member,c,p,config,sheet))fail('没有填写该表的权限',403);
  const date=operatingDate(b.date);if(sheet==='targets'){if(!date.endsWith('-01'))fail('月目标日期应为月初1号');}
  validateVersion(b.version);const id=operatingId(c.id,p.id,sheet,date),old=await tx.get<OperatingRecord>(id);if(!old&&!sheetEnabled(config,sheet))fail('该模板已停用，不能新增记录；已有记录仍可更正');if(old&&(old.companyId!==c.id||old.projectId!==p.id||old.sheet!==sheet||old.date!==date))fail('经营记录身份不一致，请联系管理员',409);if(old?old.version!==b.version:b.version!==0)fail('同日记录已存在或版本已变化，请刷新后更正',409);
  const correction=old&&b.importCorrection===true;
  if(correction&&old.status==='submitted'&&old.submittedBy!==uid)fail('待确认记录须由原提交人撤回或主管退回后更新',409);
  if(old&&!correction&&!['draft','returned'].includes(old.status))fail(old.status==='submitted'?'记录待确认，退回后才能修改':'记录已确认，请先发起更正',409);
  const currentTemplate=isCustom(sheet)?templateAt(config,sheet):undefined,template=old?.template||currentTemplate;
  if(isCustom(sheet)&&!template)fail('模板定义不存在');
  const rows=canonicalRows(sheet,b.rows,config,old||undefined,template),at=clock.toISOString(),reviewerLogin=uid===rights.supervisor?.login?'owner':rights.supervisor?.login||'';
  const issue=revenueDraftIssue(sheet,rows,template);if(issue)fail(issue);
  const record:OperatingRecord=old?{...old,rows,writerLogin:uid,version:old.version+1,updatedAt:at}:{id,companyId:c.id,projectId:p.id,projectName:p.name,sheet,date,rows,status:'draft',version:1,publishedVersion:0,writerLogin:uid,reviewerLogin,submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',createdAt:at,updatedAt:at,published:null,...(template?{template:structuredClone(template)}:{})};
  if(correction&&(old.status==='approved'||old.status==='submitted')){
   delete record.submissionBatchId;
   delete record.approvalFlow;
   if(old.status==='approved')record.amendmentReason=text(b.reason,1000,true);
   Object.assign(record,{status:'draft',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:''});
  }
  if(Object.hasOwn(b,'sharedAdSpend')){if(b.sharedAdSpend===null)delete record.sharedAdSpend;else record.sharedAdSpend=b.sharedAdSpend;}
  if(record.sharedAdSpend!==undefined)validateOperatingRows(sheet,rows,rows.map(r=>({id:r.storeId,name:r.storeName})),false,template,record.sharedAdSpend);
  return write(tx,c,record,actor,member,correction?(old.status==='approved'?'ops.amend':old.status==='submitted'?'ops.withdraw':'ops.save'):b.action,clock);
 }
 if(!['ops.submit','ops.withdraw','ops.amend','ops.approve','ops.return','ops.history'].includes(b.action))fail('不支持的经营操作');
 if(typeof b.id!=='string'||!/^op_[a-f0-9]{32}$/.test(b.id))fail('经营记录编号无效');const current=await tx.get<OperatingRecord>(b.id);if(!current||current.companyId!==c.id)fail('经营记录不存在',404);
 const p=await projectAt(tx,c,current.projectId),rights=access(actor,member,c,p),config=configAt(c,p.id);
 const routedReview=['ops.approve','ops.return'].includes(b.action)&&isCurrentApprover(actor,c,current);
 if(!config||!rights.live&&!routedReview)fail('没有该项目经营操作权限',403);
 if(b.action==='ops.history'){if(!canReadSheet(actor,member,c,p,config,current.sheet))fail('没有该表历史的权限',403);const versions:OperatingVersion[]=[];for(let v=current.version;v>Math.max(0,current.version-20);v--){const version=await tx.get<OperatingVersion>(operatingVersionKey(current.id,v));if(!version)fail('经营历史不完整');versions.push(version);}return{versions};}
 validateVersion(b.version);if(b.version!==current.version)fail('经营记录已发生变化，请刷新',409);let r=structuredClone(current);
 delete r.submissionBatchId;
 if(b.action==='ops.withdraw'){
  if(r.status!=='submitted')fail('只有待确认记录可以撤回');
  if(!canWrite(actor,member,c,p,config,r.sheet)||r.submittedBy!==uid)fail('只有仍有填写权限的原提交人可以撤回',403);
  r={...r,status:'draft',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:''};
 }else if(b.action==='ops.submit'){
  if(!canWrite(actor,member,c,p,config,r.sheet))fail('没有提交该表的权限',403);if(!['draft','returned'].includes(r.status))fail('当前记录状态不能提交',409);
  validateOperatingRows(r.sheet,r.rows,r.rows.map(x=>({id:x.storeId,name:x.storeName})),true,r.template,r.sharedAdSpend);
  delete r.approvalFlow;const flow=submissionFlow(c,p,uid);if(flow)r.approvalFlow=flow;
  const reviewerLogin=flow?.steps[0]||rights.supervisor?.login;if(!reviewerLogin)fail('请先指定有效的项目确认主管');
  if(b.submissionBatchId!==undefined){
   const batch=submissionBatchIdSchema.safeParse(b.submissionBatchId);if(!batch.success)fail('经营提交批次编号无效');
   r.submissionBatchId=batch.data;
  }
  r={...r,status:'submitted',writerLogin:uid,reviewerLogin,submittedBy:uid,submittedName:actor.owner?'管理员':member!.name,submittedAt:clock.toISOString(),reviewerName:'',comment:''};
 }else if(b.action==='ops.amend'){
  if(!canWrite(actor,member,c,p,config,r.sheet))fail('没有更正该表的权限',403);if(r.status!=='approved')fail('只有已确认记录可发起更正',409);
  const amendmentReason=text(b.reason,1000,true);
  r={...r,status:'draft',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',amendmentReason};
 }else{
  if(r.status!=='submitted')fail('当前记录不在待确认状态',409);
  const reviewer=operatingReviewerLogin(c,p,r,uid);
  const allowed=r.approvalFlow?routedReview:uid===reviewer&&(uid!==r.submittedBy||uid===rights.supervisor?.login);
  if(!allowed)fail('没有该项目经营记录的确认权限',403);
  r={...r,status:b.action==='ops.approve'?'approved':'returned',reviewerLogin:uid,reviewerName:actor.owner?'管理员':member!.name,comment:text(b.comment??'',1000)};
  if(b.action==='ops.return'&&!r.comment)fail('请填写退回原因');
  const next=b.action==='ops.approve'?nextApprovalStep(r.approvalFlow):undefined;
  if(next){
   r.approvalFlow=next;r.status='submitted';r.reviewerLogin=next.steps[next.index];
   if(current.submissionBatchId)r.submissionBatchId=current.submissionBatchId;
  }
 }
 if(r.status==='draft')delete r.approvalFlow;
 r.version++;r.updatedAt=clock.toISOString();if(b.action==='ops.approve'&&r.status==='approved'){r.publishedVersion=r.version;const{published,...snapshot}=r;r.published=snapshot;config.confirmedProjectName=r.projectName;await recordConfirmedCorrection(tx,c,current.published,snapshot);}
 return write(tx,c,r,actor,member,b.action==='ops.approve'&&r.status==='submitted'?'ops.approveStep':b.action,clock);
}
