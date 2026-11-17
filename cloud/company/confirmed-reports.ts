import {isDeepStrictEqual} from 'node:util';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {isComparisonSnapshot} from '../../lib/workbench/report-comparison.ts';
import {reportPeriod,type ReportPeriod} from '../../lib/workbench/report-period.ts';
import {historyPeriodInput,type ConfirmedReportHistory} from '../../lib/workbench/report-history.ts';
import {digest} from './core.ts';
import type {Actor,Company,PeriodReport,Project,ProjectHead,ReportHead,ReportIndex,ReportSnapshot} from './model.ts';
import {companyAbility,projectSubject} from './policy.ts';
import type {CompanyTx} from './store.ts';

export function reportId(companyId:string,projectId:string,kind:string,start:string,authorLogin?:string){
 const key=companyId+':'+projectId+':'+kind+':'+start+(kind==='daily'?':'+authorLogin:'');
 return 'pr_'+digest(key).slice(0,32);
}
export const reportIndexKey=(companyId:string,month:string)=>'reports_'+companyId+'_'+month;
const inconsistent=(message:string):never=>{throw new WorkbenchError(message,409);};

export async function readReportIndex(tx:CompanyTx,c:Company,month:string):Promise<ReportIndex>{
 const meta=c.reportMonths?.[month],index=await tx.get<ReportIndex>(reportIndexKey(c.id,month));
 if(!meta&&!index)return {revision:0,versions:0,items:[]};
 if(!meta||!index||!Array.isArray(index.items)||index.items.length!==meta.count||index.items.length>3000||index.revision!==meta.revision||index.versions!==meta.versions)throw new WorkbenchError('报表目录不完整，请刷新或联系管理员',409);
 const ids=new Set<string>();
 let versions=0;
 for(const h of index.items){
  if(!h||h.kind==='daily'&&!h.authorLogin||!h.start?.startsWith(month+'-')||h.id!==reportId(c.id,h.projectId,h.kind,h.start,h.authorLogin)||ids.has(h.id)||!Number.isSafeInteger(h.version)||h.version<1||!Number.isSafeInteger(h.publishedVersion)||h.publishedVersion<0||h.publishedVersion>h.version||!['draft','submitted','returned','approved'].includes(h.status)||h.status==='approved'&&h.version!==h.publishedVersion)inconsistent('报表目录内容不一致，请联系管理员');
  ids.add(h.id);versions+=h.version;
 }
 if(versions!==meta.versions)inconsistent('报表目录版本总数不一致，请联系管理员');
 return index;
}

function visibleConfirmedHead(c:Company,actor:Actor,supervised?:((project:ProjectHead)=>boolean)){
 const ability=companyAbility(actor,c),projects=new Map(c.projects.map(p=>[p.id,p]));
 return (h:ReportHead)=>{
  if(!h.publishedVersion)return false;
  const project=projects.get(h.projectId)??inconsistent('报表项目关系不完整，请联系管理员');
  const scope=projectSubject({...project,companyId:c.id,status:h.status,submittedBy:h.submittedBy,published:{version:h.publishedVersion}}as Project);
  return supervised?supervised(project):actor.owner||ability.can('published',scope);
 };
}

export async function confirmedHeads(tx:CompanyTx,c:Company,actor:Actor,period:ReportPeriod,projectId:string,supervised?:(project:ProjectHead)=>boolean){
 const index=await readReportIndex(tx,c,period.start.slice(0,7)),heads:ReportHead[]=[],visible=visibleConfirmedHead(c,actor,supervised);
 for(const h of index.items){
  if(h.kind!==period.kind||h.start!==period.start||projectId&&h.projectId!==projectId)continue;
  if(h.end!==period.end)inconsistent('报表目录周期不一致，请联系管理员');
  if(visible(h))heads.push(h);
 }
 return heads;
}

export async function previousConfirmedPeriod(tx:CompanyTx,c:Company,actor:Actor,period:ReportPeriod,projectId:string,offset:number,supervised?:(project:ProjectHead)=>boolean):Promise<ConfirmedReportHistory>{
 const visible=visibleConfirmedHead(c,actor,supervised),selectedMonth=period.start.slice(0,7);
 const months=Object.keys(c.reportMonths||{}).sort();
 const earlier=months.filter(month=>month<=selectedMonth).reverse(),later=months.filter(month=>month>=selectedMonth);
 const ordered=[...earlier,...later];
 if(!Number.isSafeInteger(offset)||offset<0||offset>ordered.length)throw new WorkbenchError('历史报表位置无效，请刷新');
 // Bound each transaction, even when several years contain only other report types.
 const limit=Math.min(ordered.length,offset+6);
 for(let i=offset;i<limit;i++){
  const index=await readReportIndex(tx,c,ordered[i]),lookingBack=i<earlier.length;
  const matches=index.items.filter(h=>h.kind===period.kind&&(!projectId||h.projectId===projectId)&&(lookingBack?h.start<period.start:h.start>period.start)&&visible(h));
  if(!matches.length)continue;
  const hit=matches.reduce((a,b)=>(lookingBack?a.start>b.start:a.start<b.start)?a:b);
  const target=reportPeriod(hit.kind,historyPeriodInput(hit));
  if(target.start!==hit.start||target.end!==hit.end)inconsistent('报表目录周期不一致，请联系管理员');
  await snapshotAt(tx,c,hit,target);
  const total=matches.filter(h=>h.start===hit.start).length;
  return {state:lookingBack?'found':'later',period:target,total};
 }
 return limit<ordered.length?{state:'continue',nextOffset:limit}:{state:'empty'};
}

export async function snapshotAt(tx:CompanyTx,c:Company,h:ReportHead|undefined,period:ReportPeriod):Promise<ReportSnapshot|null>{
 if(!h)return null;
 const r=await tx.get<PeriodReport>(h.id),snapshot=r?.published;
 if(!r||r.id!==h.id||r.companyId!==c.id||r.projectId!==h.projectId||r.version!==h.version||r.status!==h.status||r.submittedBy!==h.submittedBy||r.authorLogin!==h.authorLogin||snapshot?.authorLogin!==h.authorLogin||r.kind!==h.kind||r.start!==h.start||r.end!==h.end||r.publishedVersion!==h.publishedVersion||!isComparisonSnapshot(snapshot,c.id,h.projectId,period)||snapshot.id!==h.id||snapshot.version!==h.publishedVersion)throw new WorkbenchError('已确认报表快照不完整或不一致，请联系管理员',409);
 if(r.status==='approved'){
  const {published,...current}=r;
  if(!isDeepStrictEqual(current,published))inconsistent('已确认报表快照和当前确认版内容不一致，请联系管理员');
 }
 return snapshot;
}
