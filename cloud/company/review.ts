import type{Actor,Company,Member,Project,ProjectHead,PeriodReport,ReportHead,ReportIndex}from'./model.ts';
import type{CompanyTx}from'./store.ts';import type{OperatingHead,OperatingIndex,OperatingRecord}from'./operating-model.ts';
import type{CompanyReviewItem,CompanyReviewCursor,CompanyReviewPage,CompanyReviewType}from'../../lib/workbench/company-review.ts';
import{WorkbenchError,todayShanghai}from'../../lib/workbench/domain.ts';import{digest,loadCompany,projectAt,canConfirmProgress}from'./core.ts';import{companyAbility,projectSubject}from'./policy.ts';import{operatingHead,operatingId,operatingIndexKey,operatingReviewerLogin}from'./operating.ts';import{reportIndexKey,canReviewDaily}from'./reports.ts';
const MAX_CANDIDATES=20,MAX_INDEXES=4;
function fail(message:string,status=400):never{throw new WorkbenchError(message,status);}
function reviewerProjects(actor:Actor,member:Member|null|undefined,c:Company){const supervisor=member?.roles.includes('supervisor'),leader=member?.roles.includes('leader');const projects=c.projects.filter(p=>actor.owner||supervisor&&p.reviewerLogin===member!.login||leader&&p.progressLeaderLogin===member!.login);if(!actor.owner&&!supervisor&&!projects.length)fail('没有该项目待确认权限',403);return projects;}
function canReview(actor:Actor,c:Company,p:ProjectHead,status:string,submittedBy:string,publishedVersion=0){const uid=actor.owner?'owner':actor.login!;return status==='submitted'&&submittedBy!==uid&&companyAbility(actor,c).can('review',projectSubject({...p,companyId:c.id,status,submittedBy,published:publishedVersion?{version:publishedVersion}:null}as Project));}
function month(value:unknown){if(value===undefined||value==='')return'';if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'1970-01'||value>'2100-12')fail('待确认月份无效');return value;}
function recordDate(value:string|null,fallback:string){const stamp=value||fallback,date=new Date(stamp);if(!Number.isFinite(date.getTime()))fail('待确认记录时间无法核对');return todayShanghai(date);}
type Stage={type:'project'}|{type:'operating'|'report';month:string};
function checkIndex(index:OperatingIndex|ReportIndex|null,meta:{revision:number;versions:number;count:number}|undefined){if(!meta||!index||!Array.isArray(index.items)||index.revision!==meta.revision||index.versions!==meta.versions||index.items.length!==meta.count||index.items.reduce((n,h)=>n+h.version,0)!==meta.versions||new Set(index.items.map(h=>h.id)).size!==index.items.length)fail('待确认月目录不完整或版本不一致，请联系管理员');}
export async function executeCompanyReview(tx:CompanyTx,actor:Actor,b:any):Promise<any>{
 const{c,member}=await loadCompany(tx,actor,b.companyId),projects=reviewerProjects(actor,member,c),allowed=new Map(projects.map(p=>[p.id,p])),uid=actor.owner?'owner':actor.login!;
 function configurationProjects(){
  const pending=new Set((c.operatingProposals||[]).filter(proposal=>proposal.status==='submitted'&&proposal.submittedBy!==uid).map(proposal=>proposal.projectId));
  return {projects:projects.map(p=>({id:p.id,name:p.name,configured:!!c.operatingConfigs?.some(config=>config.projectId===p.id),...(pending.has(p.id)&&(actor.owner||member?.roles.includes('supervisor')&&p.reviewerLogin===uid)?{pendingIndicatorProposal:true}:{})})),companyRevision:c.revision};
 }
 if(b.action==='review.projects')return configurationProjects();
 if(b.action==='review.reminder'){
  if(!b.cursor&&b.knownRevision===c.revision)return {unchanged:true,companyRevision:c.revision};
  const page=await readQueue({cursor:b.cursor,revision:b.revision});
  const proposals=b.cursor?0:configurationProjects().projects.filter(p=>p.pendingIndicatorProposal).length;
  return {count:page.items.length+proposals,nextCursor:page.nextCursor,companyRevision:c.revision};
 }
 if(b.action==='review.project'){
  const p=await projectAt(tx,c,b.id),head=allowed.get(p.id);if(!head||!canConfirmProgress(actor,c,p))fail('没有该项目确认权限或已不在待确认状态',403);if(p.version!==head.version||p.status!==head.status||p.submittedBy!==head.submittedBy)fail('待确认项目与目录不一致，请刷新',409);return{project:p,companyRevision:c.revision};
 }
 if(b.action!=='review.list')fail('不支持的待确认读取');
 return readQueue(b);
 async function readQueue(b:any):Promise<CompanyReviewPage>{
 const type=b.type===undefined?'all':b.type;if(!['all','project','operating','daily','weekly','monthly'].includes(type))fail('待确认类型无效');const selectedMonth=month(b.month),projectId=b.projectId===undefined?'':b.projectId;if(typeof projectId!=='string'||projectId&&!allowed.has(projectId))fail('没有该项目待确认权限',403);
 if(b.revision!==undefined&&b.revision!==c.revision)fail('待确认内容已变化，请刷新后重新读取',409);
 const scopes=new Set(projects.filter(p=>!projectId||p.id===projectId).map(p=>p.id)),months=[...new Set([...Object.keys(c.operatingMonths||{}),...Object.keys(c.reportMonths||{})])].filter(m=>!selectedMonth||m===selectedMonth).sort().reverse(),stages:Stage[]=[];
 if(!scopes.size)return{items:[],nextCursor:null,companyRevision:c.revision,scanned:{candidates:0,indexes:0}} satisfies CompanyReviewPage;
 if(type==='all'||type==='project')stages.push({type:'project'});for(const m of months){if((type==='all'||type==='operating')&&c.operatingMonths?.[m])stages.push({type:'operating',month:m});if((type==='all'||type==='daily'||type==='weekly'||type==='monthly')&&c.reportMonths?.[m])stages.push({type:'report',month:m});}
 const search=typeof b.search==='string'?b.search.trim().toLowerCase():'';
 if(search&&(type!=='daily'||search.length>80))fail('请在员工日报内按姓名或登录名查找');
 const names=new Map(c.members.map(m=>[m.login,m.name]));
 const query=digest(JSON.stringify([c.id,uid,type,projectId,selectedMonth,search])).slice(0,24);let stage=0,offset=0;
 if(b.cursor!==undefined){const cursor=b.cursor as CompanyReviewCursor;if(!cursor||typeof cursor!=='object'||!Number.isSafeInteger(cursor.stage)||cursor.stage<0||cursor.stage>=stages.length||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.query!==query)fail('待确认游标或筛选已变化，请重新读取');if(b.revision===undefined)fail('继续读取待确认需要原公司版本');stage=cursor.stage;offset=cursor.offset;}
 const items:CompanyReviewItem[]=[],scanned={candidates:0,indexes:0};
 while(stage<stages.length&&scanned.candidates<MAX_CANDIDATES){
  const current=stages[stage];if(current.type!=='project'&&scanned.indexes>=MAX_INDEXES)break;
  let heads:(ProjectHead|OperatingHead|ReportHead)[];
  if(current.type==='project')heads=projects.filter(p=>scopes.has(p.id)&&canConfirmProgress(actor,c,p));
  else if(current.type==='operating'){
   const index=await tx.get<OperatingIndex>(operatingIndexKey(c.id,current.month));checkIndex(index,c.operatingMonths?.[current.month]);scanned.indexes++;
   heads=index!.items.filter(h=>scopes.has(h.projectId)&&h.status==='submitted').sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  }else{
   const index=await tx.get<ReportIndex>(reportIndexKey(c.id,current.month));checkIndex(index,c.reportMonths?.[current.month]);scanned.indexes++;
   heads=index!.items.filter(h=>scopes.has(h.projectId)&&(!search||[h.submittedBy,names.get(h.submittedBy)||''].some(value=>value.toLowerCase().includes(search)))&&(type==='all'||type===h.kind)&&(h.kind==='daily'?canReviewDaily(actor,c,allowed.get(h.projectId)!,h):canReview(actor,c,allowed.get(h.projectId)!,h.status,h.submittedBy,h.publishedVersion))).sort((a,b)=>b.start.localeCompare(a.start)||a.id.localeCompare(b.id));
  }
  if(offset>heads.length)fail('待确认游标与目录不一致，请刷新');
  while(offset<heads.length&&scanned.candidates<MAX_CANDIDATES){const head=heads[offset++];scanned.candidates++;
   if(current.type==='project'){
    const h=head as ProjectHead,p=await projectAt(tx,c,h.id);if(p.version!==h.version||p.status!==h.status||p.submittedBy!==h.submittedBy)fail('待确认项目与目录不一致，请刷新');const date=recordDate(p.submittedAt||null,p.updatedAt);if(selectedMonth&&date.slice(0,7)!==selectedMonth)continue;
    items.push({type:'project',id:p.id,projectId:p.id,projectName:p.name,version:p.version,submittedBy:p.submittedBy,submittedAt:p.submittedAt||null,date,amendment:!!p.published});
   }else if(current.type==='operating'){
    const h=head as OperatingHead,r=await tx.get<OperatingRecord>(h.id),p=allowed.get(h.projectId)!;if(!r||r.companyId!==c.id||r.projectId!==p.id||r.date.slice(0,7)!==current.month||r.id!==operatingId(c.id,p.id,r.sheet,r.date)||Object.entries(operatingHead(r)).some(([key,value])=>h[key as keyof OperatingHead]!==value))fail('待确认经营记录与目录不一致，请刷新');
    if(!actor.owner&&!member?.roles.includes('supervisor')||operatingReviewerLogin(c,p as Project,r,uid)!==uid)continue;
    items.push({type:'operating',id:r.id,projectId:p.id,projectName:p.name,version:r.version,submittedBy:r.submittedBy,submittedAt:r.submittedAt,date:r.date,sheet:r.sheet,...(r.submissionBatchId?{submissionBatchId:r.submissionBatchId}:{}),...(r.template?{name:r.template.name}:{}),amendment:!!r.published});
   }else{
    const h=head as ReportHead,r=await tx.get<PeriodReport>(h.id),p=allowed.get(h.projectId)!;if(!r||r.companyId!==c.id||r.projectId!==p.id||r.start.slice(0,7)!==current.month||(['id','projectId','kind','start','end','status','version','publishedVersion','submittedBy']as const).some(key=>r[key]!==h[key]))fail('待确认文字报表与目录不一致，请刷新');
    const daily=r.kind==='daily'?{submittedName:r.submittedName||names.get(r.submittedBy)||r.submittedBy,excerpt:(r.achievement.trim().match(/^[^。！？\r\n]*[。！？]?/u)?.[0]||'').slice(0,96)}:{};
    items.push({...daily,type:r.kind as CompanyReviewType,id:r.id,projectId:p.id,projectName:p.name,version:r.version,submittedBy:r.submittedBy,submittedAt:r.submittedAt,date:r.start,start:r.start,end:r.end,amendment:!!r.published});
   }
  }
  if(offset>=heads.length){stage++;offset=0;}
 }
 const result:CompanyReviewPage={items,nextCursor:stage<stages.length?{stage,offset,query}:null,companyRevision:c.revision,scanned};return result;
 }
}
