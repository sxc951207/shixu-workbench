import {z} from 'zod';
import {addDays} from './productivity.ts';
import {reportPeriod} from './report-period.ts';
import {todayShanghai} from './domain.ts';
import {operatingDate,operatingRecordSchema,selectStoreRevenueSource} from './operating-data.ts';
import {operatingTableTotals} from './operating-paste.ts';
import type {OperatingRecord} from '../../cloud/company/operating-model.ts';

export type CompanyDayRequest=(body:Record<string,unknown>)=>Promise<unknown>;
export type CompanyDayProject={id:string;name:string;enabled:boolean;records:OperatingRecord[];revenueNote?:string;excludedRecords:number;pendingChanges:number;pendingPeriod:'day'|'range'|'month'};
export type CompanyDayOverviewData={companyId:string;date:string;companyRevision:number;projects:CompanyDayProject[]};
export type CompanyDayRevenueSummary={amount:number|null;complete:boolean;knownRows:number;totalRows:number;reason:string};

/** Sum only the selected project's single-day revenue rows; preserve partial and unsafe totals. */
export function companyDayRevenueSummary(records:OperatingRecord[]):CompanyDayRevenueSummary{
 const source=selectStoreRevenueSource(records),record=source.records[0];
 if(!record)return{amount:null,complete:false,knownRows:0,totalRows:0,reason:source.issue||'当天无已确认总业绩'};
 const totalRows=record.rows.length,knownRows=record.rows.filter(row=>row.values.revenue!=null).length;
 try{
  const amount=operatingTableTotals(record.rows,[{key:'revenue',label:'门店总业绩',kind:'money'}]).revenue;
  return{amount,complete:knownRows===totalRows&&totalRows>0,knownRows,totalRows,reason:knownRows<totalRows?`${totalRows-knownRows} 行未提供金额`:''};
 }catch{return{amount:null,complete:false,knownRows,totalRows,reason:'金额合计超出安全范围，请查看门店明细'};}
}
export type MeetingMode='yesterday'|'today'|'lastWeekDay'|'thisWeek'|'lastWeek'|'thisMonth'|'lastMonth'|'custom';
type Period={start:string;end:string};

export function meetingPeriod(mode:MeetingMode,today:string,custom=''):Period|null{
 const yesterday=addDays(today,-1);
 if(mode==='lastWeek'||mode==='lastMonth'||mode==='thisWeek'||mode==='thisMonth'){
  const kind=mode==='lastWeek'||mode==='thisWeek'?'weekly':'monthly';
  const current=reportPeriod(kind,today);
  if(mode==='lastWeek'||mode==='lastMonth'){
   const {start,end}=reportPeriod(kind,addDays(current.start,-1));
   return {start,end};
  }
  return current.start<=yesterday?{start:current.start,end:yesterday}:null;
 }
 const day=mode==='yesterday'?yesterday:mode==='lastWeekDay'?addDays(today,-7):mode==='custom'?custom:today;
 if(!day||day>today)return null;
 try{operatingDate(day);}catch{return null;}
 return {start:day,end:day};
}

export function companyPeriodRevenueSummary(records:OperatingRecord[],{start,end}:Period){
 const expectedDays=(Date.parse(end)-Date.parse(start))/86400000+1;
 const source=selectStoreRevenueSource(records.filter(record=>record.date>=start&&record.date<=end));
 const days=new Set<string>(),scopes=new Set<string>();let sum=BigInt(0),knownRows=0,unknownRows=0;
 for(const record of source.records){
  days.add(record.date);
  scopes.add(JSON.stringify(record.rows.map(row=>row.storeId).sort()));
  for(const row of record.rows){
   const amount=row.values.revenue;
   if(amount==null){unknownRows++;continue;}
   knownRows++;sum+=BigInt(amount);
  }
 }
 const overflow=sum>BigInt(Number.MAX_SAFE_INTEGER),reportedDays=days.size,scopeChanged=scopes.size>1;
 return{amount:knownRows&&!overflow?Number(sum):null,complete:reportedDays===expectedDays&&knownRows>0&&!unknownRows&&!overflow&&!scopeChanged,reportedDays,expectedDays,unknownRows,overflow,scopeChanged,sourceIssue:source.issue};
}

type Filter={companyId:string;date:string;start?:string;now?:Date;minimumRevision?:number};
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity=z.string().regex(/^p_[a-f0-9]{24}$/);
const name=z.string().min(1).max(80).refine(value=>value===value.trim());
const optionsSchema=z.object({companyRevision:integer,projects:z.array(z.object({id:identity,name,enabled:z.boolean()}))});
// Summary config merges historical snapshots; renamed stores can legitimately share a name.
// Only its presence and project identity are consumed here. Each record keeps full validation.
const summaryConfigSchema=z.object({projectId:identity,revenueNote:z.string().min(1).max(300).optional()});
const pageSchema=z.object({day:z.string().optional(),start:z.string().optional(),end:z.string().optional(),companyRevision:integer,project:z.object({id:identity,name}),config:summaryConfigSchema.nullable(),records:z.array(operatingRecordSchema).max(20),pendingChanges:integer.optional(),total:integer.max(2000),page:integer,nextPage:integer.nullable()});
const inflight=new WeakMap<CompanyDayRequest,Map<string,Promise<CompanyDayOverviewData>>>();
function fail(message:string):never{throw Error(message+'，请重新读取各项目数据');}
const daily=(record:{sheet:string})=>record.sheet!=='targets'&&!record.sheet.endsWith('-stores');

/** Read all authorized projects atomically: every page shares the options revision. */
export async function loadCompanyDayOverview(request:CompanyDayRequest,filter:Filter):Promise<CompanyDayOverviewData>{
 operatingDate(filter.date);
 if(filter.start!==undefined){
  operatingDate(filter.start);
  if(filter.start>filter.date||addDays(filter.start,30)<filter.date)throw Error('请选择 31 天以内的业务期间');
 }
 if(filter.date>todayShanghai(filter.now))throw Error('不能查看未来业务日期');
 if(!/^co_[a-f0-9]{12}$/.test(filter.companyId))throw Error('公司编号无法核对');
 if(filter.minimumRevision!==undefined&&(!Number.isSafeInteger(filter.minimumRevision)||filter.minimumRevision<0))throw Error('公司版本无法核对');
 let reads=inflight.get(request);if(!reads){reads=new Map();inflight.set(request,reads);}
 const key=filter.companyId+':'+(filter.start||'')+':'+filter.date+':'+(filter.minimumRevision??0),existing=reads.get(key);if(existing)return existing;
 const pending=readOverview(request,filter);reads.set(key,pending);
 try{return await pending;}finally{if(reads.get(key)===pending)reads.delete(key);}
}

async function readOverview(request:CompanyDayRequest,filter:Filter):Promise<CompanyDayOverviewData>{
 const parsed=optionsSchema.safeParse(await request({action:'ops.options',companyId:filter.companyId,scope:'summary'}));
 if(!parsed.success)fail('可查看项目列表无法核对');
 const {projects,companyRevision}=parsed.data;
 if(companyRevision<(filter.minimumRevision??0))fail('公司数据已更新，本次读取版本已过期');
 if(new Set(projects.map(project=>project.id)).size!==projects.length)fail('项目列表存在重复');
 const result:CompanyDayProject[]=new Array(projects.length),ids=new Set<string>(),facts=new Set<string>();
 let cursor=0,stopped=false;
 async function readProject(project:typeof projects[number]):Promise<CompanyDayProject>{
  const value:CompanyDayProject={...project,records:[],excludedRecords:0,pendingChanges:0,pendingPeriod:'day'};
  if(!project.enabled)return value;
  const from=filter.start??filter.date,range=filter.start!==undefined;
  const months:string[]=[];
  for(let month=from.slice(0,7);month<=filter.date.slice(0,7);month=addDays(reportPeriod('monthly',month).end,1).slice(0,7))months.push(month);
  value.pendingPeriod=range?'range':'day';
  let configured=false;
  for(const month of months){
   const sliceStart=month===from.slice(0,7)?from:month+'-01';
   const sliceEnd=month===filter.date.slice(0,7)?filter.date:reportPeriod('monthly',month).end;
   let page=0,total:number|undefined,received=0,pageScope:CompanyDayProject['pendingPeriod']|undefined;
   while(true){
    if(stopped)throw Error('读取已停止，请重试');
    const parsedPage=pageSchema.safeParse(await request({action:'ops.month',companyId:filter.companyId,projectId:project.id,month,...(range?{start:sliceStart,end:sliceEnd}:{day:filter.date}),scope:'summary',page,revision:companyRevision}));
    if(!parsedPage.success)fail('项目经营记录结构或分页无法核对');
    const data=parsedPage.data;
    // Older servers ignore date filters. Label their correction counts by month; records are filtered below.
    const bounded=data.start!==undefined||data.end!==undefined;
    if(data.day!==undefined&&(range||data.day!==filter.date)||bounded&&(!range||data.start!==sliceStart||data.end!==sliceEnd))fail('经营数据日期范围不一致');
    const scope=data.day!==undefined?'day':bounded?'range':'month';
    if(pageScope&&pageScope!==scope)fail('经营数据日期范围不一致');
    pageScope=scope;
    if(scope==='month')value.pendingPeriod='month';
    if(data.config?.revenueNote)value.revenueNote=data.config.revenueNote;
    if(data.companyRevision!==companyRevision)fail('读取期间公司数据已变化');
    if(data.project.id!==project.id||data.project.name!==project.name||data.config&&data.config.projectId!==project.id)fail('读取项目身份不一致');
    if(data.page!==page||total!==undefined&&data.total!==total||data.records.length!==Math.min(20,Math.max(0,data.total-page*20)))fail('经营记录尚未完整读取');
    const next=(page+1)*20<data.total?page+1:null;
    if(data.nextPage!==next)fail('经营记录分页进度异常');
    const pending=data.pendingChanges??0;if(pending>data.records.length)fail('经营记录更正状态无法核对');
    total=data.total;received+=data.records.length;value.pendingChanges+=pending;
    if(!data.config){if(data.records.length||total)fail('经营配置与记录不一致');}else configured=true;
    for(const record of data.records){
     if(record.companyId!==filter.companyId||record.projectId!==project.id||record.status!=='approved'||record.date.slice(0,7)!==month)fail('经营记录公司、项目、日期或确认状态不一致');
     if(scope!=='month'&&(record.date<sliceStart||record.date>sliceEnd||!daily(record)))fail('所选日期内含有其他日期或累计记录');
     const fact=project.id+':'+record.sheet+':'+record.date;
     if(ids.has(record.id)||facts.has(fact))fail('经营事实重复或冲突');
     ids.add(record.id);facts.add(fact);
     if(!daily(record)){value.excludedRecords++;continue;}
     if(record.date>=sliceStart&&record.date<=sliceEnd)value.records.push(record as OperatingRecord);
    }
    if(next===null)break;page=next;
   }
   if(received!==total)fail('经营记录尚未完整读取');
  }
  return{...value,enabled:configured};
 }
 async function worker(){
  while(cursor<projects.length&&!stopped){const index=cursor++;try{result[index]=await readProject(projects[index]);}catch(error){stopped=true;throw error;}}
 }
 await Promise.all(Array.from({length:Math.min(3,projects.length)},()=>worker()));
 return{companyId:filter.companyId,date:filter.date,companyRevision,projects:result};
}
