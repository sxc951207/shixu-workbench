import {activeProjects} from './model.ts';
import {supervisedProjects} from './supervised.ts';
import {z} from 'zod';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {operatingDate,operatingFields} from '../../lib/workbench/operating-data.ts';
import {reportPeriod} from '../../lib/workbench/report-period.ts';
import {digest,loadCompany} from './core.ts';
import type {Actor,Company,ReportSnapshot} from './model.ts';
import type {OperatingSnapshot} from './operating-model.ts';
import type {CompanyTx} from './store.ts';

export const correctionLimit=12;
const key=(companyId:string)=>'confirmed_corrections_'+companyId;
const date=z.string().refine(s=>{try{return operatingDate(s)===s;}catch{return false;}});
const count=z.number().int().positive().safe();
const itemSchema=z.object({
 id:z.string().regex(/^(?:op|pr)_[a-f0-9]{32}$/),companyId:z.string().regex(/^co_[a-f0-9]{12}$/),projectId:z.string().regex(/^p_[a-f0-9]{24}$/),
 projectName:z.string().min(1).max(80),kind:z.enum(['operating','daily','weekly','monthly']),sheet:z.string().max(40).optional(),title:z.string().min(1).max(80),
 start:date,end:date,previousVersion:count,version:count,confirmedAt:z.string().datetime(),reason:z.string().max(4000),
 changedFields:z.array(z.string().min(1).max(80)).max(40)
}).strict();
export type CorrectionItem=z.infer<typeof itemSchema>;
type Confirmed=ReportSnapshot|OperatingSnapshot;
const indexSchema=z.object({companyId:z.string(),items:z.array(itemSchema).max(correctionLimit)}).strict();
const operatingTitles:Record<string,string>={revenue:'门店总业绩',targets:'月目标',meituan:'美团平台总盘',douyin:'抖音平台总盘','meituan-stores':'美团门店累计','douyin-stores':'抖音门店累计'};
const reportFields={progress:'项目进度',achievement:'本期成果',changeReason:'经营变化原因',risk:'风险与阻碍',next:'下期计划',help:'需要协调',sourceVersions:'参考来源'} as const;

function operatingInterval(sheet:string,date:string){
 if(sheet==='targets'){const {start,end}=reportPeriod('monthly',date);return {start,end};}
 if(sheet==='meituan-stores'||sheet==='douyin-stores')return {start:date.slice(0,7)+'-01',end:date};
 return {start:date,end:date};
}

function validItem(companyId:string,item:CorrectionItem):boolean{
 if(item.companyId!==companyId||item.previousVersion>=item.version)return false;
 if(item.kind==='operating'){
  if(!item.sheet)return false;
  const keyDate=item.sheet==='targets'?item.start:item.end;
  const period=operatingInterval(item.sheet,keyDate);
  return period.start===item.start&&period.end===item.end&&item.id==='op_'+digest([companyId,item.projectId,item.sheet,keyDate].join(':')).slice(0,32);
 }
 const period=reportPeriod(item.kind,item.start);
 return !item.sheet&&period.start===item.start&&period.end===item.end&&item.id==='pr_'+digest([companyId,item.projectId,item.kind,item.start].join(':')).slice(0,32);
}
async function readIndex(tx:CompanyTx,companyId:string):Promise<CorrectionItem[]>{
 const saved=await tx.get(key(companyId));
 if(!saved)return [];
 const parsed=indexSchema.safeParse(saved);
 if(!parsed.success||parsed.data.companyId!==companyId||!parsed.data.items.every(item=>validItem(companyId,item))||new Set(parsed.data.items.map(item=>item.id)).size!==parsed.data.items.length)throw new WorkbenchError('更正动态目录无法核对',409);
 return parsed.data.items;
}
function operatingDetails(previous:OperatingSnapshot,current:OperatingSnapshot){
 const old=new Map(previous.rows.map(r=>[r.storeId,r.values]));
 const changedFields=operatingFields(current.sheet,current.template)
  .filter(f=>current.rows.some(r=>(old.get(r.storeId)?.[f.key]??null)!==(r.values[f.key]??null)))
  .map(f=>f.label);
 if(old.size!==current.rows.length||current.rows.some(r=>!old.has(r.storeId)))changedFields.push('门店范围');
 return {kind:'operating' as const,sheet:current.sheet,...operatingInterval(current.sheet,current.date),title:current.template?.name||operatingTitles[current.sheet],reason:current.amendmentReason||'',changedFields};
}
function reportDetails(previous:ReportSnapshot,current:ReportSnapshot){
 const changedFields=(Object.keys(reportFields) as (keyof typeof reportFields)[]).filter(k=>
  k==='sourceVersions'?previous.sourceVersions.join(',')!==current.sourceVersions.join(','):(previous[k]??'')!==(current[k]??'')
 ).map(k=>reportFields[k]);
 const reason='amendmentReason' in current&&typeof current.amendmentReason==='string'?current.amendmentReason:'';
 return {kind:current.kind,start:current.start,end:current.end,title:current.kind==='daily'?'员工日报':current.kind==='weekly'?'项目周报':'项目月报',reason,changedFields};
}
/** A derived per-company feed; only a subsequent approval writes an entry. Restores do not replay it. */
export async function recordConfirmedCorrection(tx:CompanyTx,company:Company,previous:Confirmed|null,current:Confirmed){
 if(!previous)return;
 if(previous.companyId!==company.id||current.companyId!==company.id||previous.projectId!==current.projectId||previous.id!==current.id||previous.status!=='approved'||current.status!=='approved'||previous.publishedVersion!==previous.version||current.publishedVersion!==current.version||previous.version>=current.version)throw new WorkbenchError('更正确认版本无法核对',409);
 let details;
 if('sheet' in current&&'sheet' in previous&&current.sheet===previous.sheet&&current.date===previous.date)details=operatingDetails(previous,current);
 else if('kind' in current&&'kind' in previous&&current.kind===previous.kind&&current.start===previous.start&&current.end===previous.end)details=reportDetails(previous,current);
 else throw new WorkbenchError('更正业务范围无法核对',409);
 const item=itemSchema.parse({...details,id:current.id,companyId:company.id,projectId:current.projectId,projectName:current.projectName,previousVersion:previous.version,version:current.version,confirmedAt:current.updatedAt});
 if(!validItem(company.id,item))throw new WorkbenchError('更正记录身份无法核对',409);
 const prior=await readIndex(tx,company.id);
 // One newest effective notice per fact; a later amendment still being reviewed cannot replace it.
 await tx.put(key(company.id),{companyId:company.id,items:[item,...prior.filter(old=>old.id!==item.id)].slice(0,correctionLimit)});
}
export async function recentCorrections(tx:CompanyTx,actor:Actor,companyId:unknown,scope?:string){
 const {c,member}=await loadCompany(tx,actor,companyId);
 const supervised=scope==='supervised'?supervisedProjects(member):undefined;
 if(!supervised&&!actor.owner&&!member?.roles.includes('leader'))throw new WorkbenchError('没有查看已确认更正动态的权限',403);
 const projects=new Map(activeProjects(c).map(p=>[p.id,p]));
 const items=(await readIndex(tx,c.id)).filter(item=>{
  const project=projects.get(item.projectId);if(!project||supervised&&!supervised(project))return false;
  // Report summary permits this company's leader to view a project with a confirmed report.
  // Operating summary additionally requires a confirmed project or confirmed operating name.
  return actor.owner||item.kind!=='operating'||project.publishedVersion>0||!!c.operatingConfigs?.some(config=>config.projectId===project.id&&config.confirmedProjectName);
 });
 return {companyId:c.id,companyRevision:c.revision,items};
}
