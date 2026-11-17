'use client';
import {supervisedRequest} from '../cloud/supervised-request';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {SectionMark} from './workspace-material';
import {ArrowLeft,ArrowRight,ArrowLeftRight,BarChart3,CalendarDays,Check,ClipboardPaste,Download,FileClock,History,Plus,RefreshCw,Save,Settings2,ShieldCheck,Store,TriangleAlert,X} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {OperatingConfig,OperatingRecord,OperatingRow,OperatingSheet,OperatingStore,OperatingTemplate,OperatingVersion} from '../cloud/company/operating-model';
import {combinedPlatformSummary,combinedPlatformFields,isStoreRevenueSheet,operatingDate,operatingFields,operatingRatios,operatingReconciliation,operatingSummary,operatingTargetProgress,operatingTemplateMetrics,parseOperatingInput,revenueDraftIssue,validateOperatingRows} from '../lib/workbench/operating-data';
import {blankOperatingTsv,formatOperatingInput as inputValue,formatOperatingMoney as yuan,operatingTableMetrics,operatingTableTotals as totals,previewOperatingPaste,type OperatingPastePreview} from '../lib/workbench/operating-paste';
import {formatOperatingDecimal,formatOperatingPercent} from '../lib/workbench/operating-display';
import {operatingTableColumns} from '../lib/workbench/operating-table-columns';
import {todayShanghai} from '../lib/workbench/domain';
import OperatingIndicatorSettings from './operating-indicator-settings';
import type {OperatingReviewShortcut} from '../lib/workbench/company-review';
import {operatingReviewChanges} from '../lib/workbench/operating-review';
import OperatingSpreadsheetImport from './operating-spreadsheet-import';
import OperatingTargetChart from './operating-target-chart';
import OperatingImportOutcome from './operating-import-outcome';
import {receiptStorageKey,receiptLocator,readReceiptLocator,writeReceiptLocator,refreshReceipt,importSourceFingerprint,unconfirmedImportReceipts} from '../lib/workbench/operating-receipt-locator';
import '../app/operating-import-outcome.css';
import {canWriteOperatingSheet,completeOperatingRecord as complete,importDayComplete,saveOperatingImportBatch,type OperatingImportEntry,type OperatingImportReceipt as ImportReceipt} from '../lib/workbench/operating-reimport';
import {groupSourceRows,latestOperatingDay} from '../lib/workbench/operating-source-date';
import {isBrandedPlatformTotal,prepareOperatingFileRows} from '../lib/workbench/operating-file';
import {operatingDraftKey,readOperatingDraft,writeOperatingDraft,removeOperatingDraft,operatingDraftRowsMatch,type OperatingDraftIdentity} from '../lib/workbench/operating-local-draft';
import{resolveOperatingProject,type ProjectShortcut}from'../lib/workbench/project-navigation';
import{operatingWorkQueue,operatingSheetNames,type OperatingFillTarget}from'../lib/workbench/operating-work-queue';
import OperatingWorkQueue from'./operating-work-queue';
import ReportHistoryNav from'./report-history-nav';
import OperatingComparison from'./operating-comparison';
const OperatingCharts=React.lazy(()=>import('./operating-charts'));
import{loadOperatingComparison}from'../lib/workbench/operating-comparison-reader';
import type{PreparedOperatingComparison}from'../lib/workbench/operating-comparison';
import '../app/company-operating.css';
import '../app/company-entry-forms.css';

type Props={supervised?:boolean;confirmedOnly?:boolean;initialFill?:OperatingFillTarget;initialReview?:OperatingReviewShortcut;initialSetup?:boolean;initialProject?:ProjectShortcut;companyId:string;owner:boolean;me:{login:string;name:string;roles:string[]};revision:number;onBusy?:(busy:boolean)=>void;onRevision?:(revision:number)=>void};
type MonthData={project:{id:string;name:string};config:OperatingConfig|null;records:OperatingRecord[];permissions:{revenue:boolean;platform:boolean;configure:boolean;configureOwn?:boolean;projectOwner?:boolean};companyRevision:number;loadedAt?:string;pendingChanges?:number;total?:number;page?:number;nextPage?:number|null};
const localDraftStorage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value),removeItem:(key:string)=>window.localStorage.removeItem(key)};
type Field=ReturnType<typeof operatingFields>[number];
type EditorValue={sheet:OperatingSheet;date:string;record?:OperatingRecord;stores:OperatingStore[];currentStores:OperatingStore[];template?:OperatingTemplate};
type BatchMode='submit'|'approve';
type Modal={kind:'receipt';receipts:ImportReceipt[]}|{kind:'revenue-note';revision:number}|{kind:'batch';mode:BatchMode;records:OperatingRecord[];title:string}|({kind:'edit'}&EditorValue)|{kind:'comparison';value:PreparedOperatingComparison}|{kind:'amend';record:OperatingRecord}|{kind:'setup';projectId?:string;stores?:boolean}|{kind:'target-period'}|{kind:'target-record';record:OperatingRecord;records:OperatingRecord[];cutoff:string|null}|{kind:'review';record:OperatingRecord;approve:boolean}|{kind:'history';record:OperatingRecord;versions:OperatingVersion[]};
const sheetName=(sheet:OperatingSheet,template?:OperatingTemplate)=>template?.name||operatingSheetNames[sheet]||'自定义记录';
const writerName=(template:OperatingTemplate)=>template.writer==='owner'?'管理员':template.writer==='project-owner'?'项目负责人':'项目指定主管';
import {defaultRevenueNote} from '../lib/workbench/operating-data';
const approvalReceipt='已确认，领导汇总已更新为这一版本。';
const stages={draft:'草稿',returned:'已退回',submitted:'待确认',approved:'已确认'};
const actionNames:Record<string,string>={'ops.save':'保存草稿','ops.submit':'提交确认','ops.withdraw':'撤回提交','ops.amend':'发起更正','ops.approve':'确认通过','ops.return':'退回补充'};
const display=(value:number|null|undefined,kind:Field['kind'])=>value==null?'—':kind==='money'?yuan(value):kind==='stars'?value.toFixed(1):value.toLocaleString('zh-CN');
const percent=(value:number|null)=>value==null?'—':formatOperatingPercent(value);
const metricDisplay=(metric:ReturnType<typeof operatingTableMetrics>[number]|undefined)=>!metric||metric.value==null?'—':metric.format==='percent'?percent(metric.value):metric.format==='money'?'¥'+metric.value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):formatOperatingDecimal(metric.value);
const time=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const monthEnd=(month:string)=>{const [year,m]=month.split('-').map(Number);return month+'-'+String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,'0');};
const range=(date:string)=>date.slice(0,7)+'-01 — '+date;
const isPlatform=(sheet:OperatingSheet)=>sheet==='meituan'||sheet==='douyin';
const emptyRows=(sheet:OperatingSheet,stores:OperatingStore[],template?:OperatingTemplate,total=false):OperatingRow[]=>(template?.dimension==='total'?[{id:'all',name:'全项目'}]:isPlatform(sheet)&&total?[{id:'all',name:'全平台'}]:stores).map(s=>({storeId:s.id,storeName:s.name,values:Object.fromEntries(operatingFields(sheet,template).map(f=>[f.key,null]))}));
async function readMonth(body:Record<string,unknown>,api=companyRequest):Promise<MonthData>{
 const first:MonthData=await api({action:'ops.month',...body,page:0});let records=[...first.records],pendingChanges=first.pendingChanges||0,next=first.nextPage;const seen=new Set([0]),configs=first.config?[first.config]:[];
 while(next!=null){if(!Number.isInteger(next)||seen.has(next)||seen.size>2000)throw Error('分页进度异常，请重新读取本月数据');seen.add(next);const page:MonthData=await api({action:'ops.month',...body,page:next,revision:first.companyRevision});if(page.companyRevision!==first.companyRevision||page.total!==first.total)throw Error('读取期间数据已变化，请刷新后重新核对');records.push(...page.records);pendingChanges+=page.pendingChanges||0;if(page.config)configs.push(page.config);next=page.nextPage;}
 if(first.total!=null&&records.length!==first.total)throw Error('本月记录尚未读取完整，请刷新后重试');
 if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('本月分页记录重复，请刷新后重试');
 const config=first.config&&configs.length>1?{...first.config,stores:[...new Map(configs.flatMap(c=>c.stores).map(s=>[s.id,s])).values()],templates:[...new Map(configs.flatMap(c=>c.templates||[]).map(t=>[t.id,t])).values()],builtinSheets:configs.some(c=>!c.builtinSheets)?undefined:[...new Set(configs.flatMap(c=>c.builtinSheets||[]))]}:first.config;
 return{...first,records,config,pendingChanges,loadedAt:new Date().toISOString()};
}

export default function CompanyOperating({supervised=false,companyId,owner,me,revision,onBusy,onRevision,initialProject,confirmedOnly,initialReview,initialFill,initialSetup}:Props){
 const api=supervised?supervisedRequest:companyRequest;
 const today=todayShanghai(),reportDay=latestOperatingDay(),[projects,setProjects]=useState<{id:string;name:string;enabled:boolean}[]>([]),[projectId,setProjectId]=useState(''),[cutoff,setCutoff]=useState(initialReview?.date||initialFill?.date||reportDay),[view,setView]=useState<'daily'|'cumulative'|'stores'>('daily'),[dailySheet,setDailySheet]=useState<OperatingSheet>(initialReview?.sheet||initialFill?.sheet||'revenue'),[storeSheet,setStoreSheet]=useState<'meituan-stores'|'douyin-stores'>('meituan-stores'),[scope,setScope]=useState<'working'|'summary'>(initialProject?.confirmedOnly||confirmedOnly?'summary':'working'),[data,setData]=useState<MonthData|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[modal,setModal]=useState<Modal|null>(initialSetup?{kind:'setup',projectId:initialProject?.id}:null),[dirty,setDirty]=useState(false);
 const sequence=useRef(0),optionsSequence=useRef(0),working=useRef(false),revisionRef=useRef(revision),busyCallback=useRef(onBusy),revisionCallback=useRef(onRevision),mounted=useRef(true);
 busyCallback.current=onBusy;revisionCallback.current=onRevision;revisionRef.current=Math.max(revisionRef.current,revision);
 const filterBar=useRef<HTMLDivElement>(null),[showDateTools,setShowDateTools]=useState(false);
 useEffect(()=>{
  const node=filterBar.current;if(!node||typeof IntersectionObserver==='undefined')return;
  const observer=new IntersectionObserver(([entry])=>setShowDateTools(!entry.isIntersecting&&entry.boundingClientRect.bottom<=0));
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 const comparisonTrigger=useRef<HTMLButtonElement>(null);
 const[comparisonMode,setComparisonMode]=useState<'month'|'week'>('month');
 const leaderOnly=!owner&&me.roles.includes('leader')&&!me.roles.some(role=>role==='supervisor'||role==='employee'),summary=supervised||leaderOnly||scope==='summary',month=cutoff.slice(0,7);
 const savedImport=useRef<ImportReceipt|null>(null),receiptRecordPanel=useRef<HTMLDivElement>(null),focusReceiptRecord=useRef(false);
 const receiptKey=receiptStorageKey(companyId,owner?'owner':me.login,projectId);
 const [lastReceipt,setLastReceipt]=useState<{key:string;entries:ReturnType<typeof receiptLocator>;persisted:boolean}|null>(null);
 useEffect(()=>{
  const entries=projectId&&!summary?readReceiptLocator(localDraftStorage,receiptKey):null;
  setLastReceipt(entries?{key:receiptKey,entries,persisted:true}:null);
 },[receiptKey,summary]);
 const initialAction=useRef(false),configuring=modal?.kind==='setup';
 useEffect(()=>{if(!data||!projectId||initialAction.current||!initialReview||summary)return;initialAction.current=true;let live=true;const reveal=(record:OperatingRecord|undefined)=>{if(!live)return;if(!record||record.version!==initialReview.version||record.status!=='submitted'||record.reviewerLogin!==(owner?'owner':me.login)){setError('这条记录的版本、状态或确认人已变化，请回到待我确认刷新');return;}open({kind:'review',record,approve:true});};const record=data.records.find(record=>record.id===initialReview!.id);if(record||initialReview!.date.slice(0,7)===month)reveal(record);else{setBusy(true);void readMonth({companyId,projectId,month:initialReview!.date.slice(0,7)}).then(result=>reveal(result.records.find(record=>record.id===initialReview!.id))).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});}return()=>{live=false;};},[data,projectId]);
 const latestRecordDate=data?.records.filter(record=>record.sheet!=='targets'&&record.date<=today).map(record=>record.date).sort().at(-1);
 const publishRevision=(value:number)=>{if(Number.isSafeInteger(value)){revisionRef.current=Math.max(revisionRef.current,value);revisionCallback.current?.(value);}};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++sequence.current;++optionsSequence.current;busyCallback.current?.(false);};},[]);
 useEffect(()=>{busyCallback.current?.(busy||modal!==null);},[busy,modal]);
 useEffect(()=>{if(configuring)return;const seq=++optionsSequence.current;setError('');void api({action:'ops.options',companyId,scope:summary?'summary':'working'}).then(r=>{if(seq!==optionsSequence.current||!mounted.current)return;setProjects(r.projects);setProjectId(id=>resolveOperatingProject(r.projects,id,initialProject?.id).id);if(!initialSetup&&initialProject&&!r.projects.some((p:{id:string})=>p.id===initialProject.id)&&(!projectId||projectId===initialProject.id))setNotice('项目“'+initialProject.name+'”在当前口径下暂无可查看的报表。配置指标请打开“项目指标设置”。');publishRevision(r.companyRevision);if(!r.projects.length)setLoading(false);}).catch(e=>{if(seq===optionsSequence.current&&mounted.current){setError(e.message);setLoading(false);}});return()=>{++optionsSequence.current;};},[companyId,revision,summary,configuring]);
 async function load(){if(!projectId){setData(null);setLoading(false);return;}const seq=++sequence.current;setLoading(true);setError('');try{const r=await readMonth({companyId,projectId,month,...(summary?{scope:'summary'}:{})},api);if(seq===sequence.current&&mounted.current){setData(r);revisionRef.current=Math.max(revisionRef.current,r.companyRevision);}}catch(e){if(seq===sequence.current&&mounted.current){setData(null);setError((e as Error).message);}}finally{if(seq===sequence.current&&mounted.current)setLoading(false);}}
 useEffect(()=>{if(configuring)return;setData(null);void load();return()=>{++sequence.current;};},[companyId,projectId,month,summary,revision,configuring]);
 useEffect(()=>{
  const before=(event:BeforeUnloadEvent)=>{if(dirty||busy){event.preventDefault();event.returnValue='';}};
  const navigate=(event:MouseEvent)=>{const anchor=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;if(!anchor||anchor.target==='_blank'||event.ctrlKey||event.metaKey||event.shiftKey)return;if(busy){event.preventDefault();return;}if(dirty&&!window.confirm('还有未保存的内容，确定离开并放弃这些修改吗？'))event.preventDefault();};
  window.addEventListener('beforeunload',before);document.addEventListener('click',navigate,true);return()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',navigate,true);};
 },[dirty,busy]);
 function open(value:Modal){savedImport.current=null;setError('');setDirty(false);setModal(value);}
 function canLeaveForm(){return !busy&&(!dirty||window.confirm('还有内容尚未保存到云端，确定关闭此表单吗？'));}
 function leaveForm(chosen:ImportReceipt|null){
  if(!canLeaveForm())return;
  if(chosen){
   if(chosen.date.slice(0,7)!==month)setData(null);
   setCutoff(chosen.date);
   if(chosen.sheet==='meituan-stores'||chosen.sheet==='douyin-stores'){setView('stores');setStoreSheet(chosen.sheet);}
   else{setView('daily');setDailySheet(chosen.sheet);}
   focusReceiptRecord.current=true;
   setNotice('当前查看 '+chosen.date+' 的'+sheetName(chosen.sheet,chosen.record?.template)+'。');
  }
  savedImport.current=null;setDirty(false);setModal(null);setError('');
 }
 function close(){leaveForm(savedImport.current);}
 useEffect(()=>{
  if(!focusReceiptRecord.current||modal||loading||!data||!receiptRecordPanel.current)return;
  focusReceiptRecord.current=false;
  receiptRecordPanel.current.focus({preventScroll:true});
  receiptRecordPanel.current.scrollIntoView({block:'start'});
 },[modal,data,loading,cutoff,view,dailySheet,storeSheet]);
 async function submitImported(entries:ImportReceipt[]){
  if(working.current||!canLeaveForm())return;
  working.current=true;setBusy(true);setError('');
  try{
   const current=await refreshReceipt(receiptLocator(entries),month=>readMonth({companyId,projectId,month},api),owner);
   const eligible=current.filter(item=>item.record&&!item.submitIssue&&['draft','returned'].includes(item.record.status)).map(item=>item.record!);
   if(!mounted.current)return;
   if(!eligible.length){setError('所选草稿的状态、版本或填写权限已变化，请重新打开上次导入回执核对。');return;}
   const skipped=entries.length-eligible.length;
   open({kind:'batch',mode:'submit',records:eligible,title:'提交本次导入的草稿'+(skipped?' · 已略过 '+skipped+' 条状态或权限变化的记录':'')});
  }catch(e){if(mounted.current)setError('核对可提交日期失败：'+(e as Error).message);}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 async function reopenReceipt(){
  if(working.current||!lastReceipt||lastReceipt.key!==receiptKey||summary)return;
  working.current=true;setBusy(true);setError('');
  try{
   const receipts=await refreshReceipt(lastReceipt.entries,month=>readMonth({companyId,projectId,month},api),owner);
   if(mounted.current)open({kind:'receipt',receipts});
  }catch(e){if(mounted.current)setError('读取导入回执失败：'+(e as Error).message);}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 function changeMonth(next:string){if(!/^\d{4}-\d{2}$/.test(next))return;try{operatingDate(next+'-01');}catch{return;}setCutoff(next===reportDay.slice(0,7)?reportDay:next===today.slice(0,7)?today:monthEnd(next));setNotice('');}
 function changeCutoff(next:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return;try{operatingDate(next);}catch{return;}setCutoff(next);setNotice('');}
 async function run(body:Record<string,unknown>,done?:(result:any)=>void){
  if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await api({companyId,...body});if(!mounted.current)return;
   if(body.action==='ops.revenueNote')setData(current=>current?.config?{...current,config:{...current.config,revenueNote:result.note||undefined},companyRevision:result.companyRevision}:current);
   if(result.record)setData(current=>current?{...current,records:[...current.records.filter(r=>r.id!==result.record.id),result.record],companyRevision:result.companyRevision}:current);

   setDirty(false);publishRevision(result.companyRevision);if(done)done(result);else setModal(null);
   if(body.action==='ops.save')setNotice('草稿已保存。请核对完整后再提交确认。');
   else if(body.action==='ops.revenueNote')setNotice('门店总业绩说明已保存。');
   else if(body.action==='ops.withdraw')setNotice('已撤回为草稿，可修改后重新提交。');
   else if(body.action==='ops.submit')setNotice('已提交给指定确认人。确认前不能编辑。');
   else if(body.action==='ops.approve')setNotice(approvalReceipt);
   else if(body.action==='ops.return')setNotice('已退回，填写人可补充后重新提交。');
   else if(body.action==='ops.amend')setNotice('更正草稿已打开，上一次已确认版本继续保留。');
   return result;
  }catch(e){if(mounted.current)setError((e as Error).message+'；内容仍保留，请核对后重试。');}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 async function saveSourceDays(days:OperatingImportEntry[],manualEdits:boolean,previous:ImportReceipt[]=[],reason=''){
  if(working.current)throw Error('正在保存，请稍候');
  working.current=true;setBusy(true);
  try{
   const prior=lastReceipt?.key===receiptKey?lastReceipt.entries:[];
   let source:string|undefined;
   if(!previous.length&&prior.some(item=>item.unconfirmedSource)){
    source=await importSourceFingerprint(receiptKey,days);
    previous=unconfirmedImportReceipts(prior,source);
   }
   const receipts=await saveOperatingImportBatch(days,{
    login:owner?'owner':me.login,previous,reason,
    readMonth:month=>readMonth({companyId,projectId,month},api),
    save:async body=>{
     const result=await api({action:'ops.save',companyId,projectId,...body});
     revisionRef.current=Math.max(revisionRef.current,result.companyRevision);
     return result.record;
    }
   });
   if(!mounted.current)return receipts;
   if(!source&&receipts.some(item=>item.saveUnconfirmed))source=await importSourceFingerprint(receiptKey,days);
   const entries=receiptLocator(receipts,source);
   const persisted=writeReceiptLocator(localDraftStorage,receiptKey,entries);
   setLastReceipt({key:receiptKey,entries,persisted});
   await load();
   if(receipts.length&&receipts.every(item=>importDayComplete(item)||item.outcome==='skipped')){
    const completed=receipts.filter(importDayComplete).sort((a,b)=>a.date.localeCompare(b.date));
    savedImport.current=completed.at(-1)??null;setDirty(manualEdits);
   }
   return receipts;
  }finally{working.current=false;setBusy(false);}
 }
 async function prepareComparison(){if(working.current||!projectId)return;working.current=true;setBusy(true);setError('');try{const value=await loadOperatingComparison(api,{companyId,projectId,cutoff,mode:comparisonMode});if(mounted.current)open({kind:'comparison',value});}catch(e){if(mounted.current)setError('数字对比未完成：'+(e as Error).message+'。未生成新的对比结论。');}finally{working.current=false;if(mounted.current)setBusy(false);}}
 function editor(sheet:OperatingSheet,date=cutoff,record?:OperatingRecord){if(!data?.config)return;const found=record||data.records.find(r=>r.sheet===sheet&&r.date===date),template=found?.template||data.config.templates?.find(t=>t.id===sheet);open({kind:'edit',sheet,date,record:found,template,stores:found?found.rows.map(r=>({id:r.storeId,name:r.storeName})):data.config.stores,currentStores:data.config.stores});}
 async function targetEditor(targetMonth:string){if(working.current||!data?.config)return;working.current=true;setBusy(true);setError('');try{const r=await readMonth({companyId,projectId,month:targetMonth});if(!mounted.current)return;const record=r.records.find(record=>record.sheet==='targets'&&record.date===targetMonth+'-01');if(!r.permissions.revenue)throw Error('当前账号没有月目标填写权限');if(record){
   const through=targetMonth===month?cutoff:targetMonth===reportDay.slice(0,7)?reportDay:targetMonth<reportDay.slice(0,7)?monthEnd(targetMonth):null;
   open({kind:'target-record',record,records:r.records,cutoff:through});
  }else open({kind:'edit',sheet:'targets',date:targetMonth+'-01',record,stores:r.config?.stores||data.config.stores,currentStores:r.config?.stores||data.config.stores});revisionRef.current=Math.max(revisionRef.current,r.companyRevision);}catch(e){if(mounted.current)setError((e as Error).message);}finally{working.current=false;if(mounted.current)setBusy(false);}}
 const retired=(sheet:OperatingSheet)=>sheet.startsWith('tpl_')?data?.config?.templates?.find(t=>t.id===sheet)?.active===false:!!data?.config?.builtinSheets&&!data.config.builtinSheets.includes(sheet as any);
 const canWrite=(sheet:OperatingSheet,record?:OperatingRecord)=>{if(summary||!data)return false;const existing=!!record&&record.companyId===companyId&&record.projectId===projectId&&record.sheet===sheet;if(retired(sheet)&&!existing)return false;return canWriteOperatingSheet(sheet,data,owner);};
 const batchRecords=(mode:BatchMode)=>(data?.records??[]).filter(r=>{
  if(summary||r.companyId!==companyId||r.projectId!==projectId||r.sheet!==dailySheet||!r.date.startsWith(month+'-'))return false;
  if(mode==='submit')return ['draft','returned'].includes(r.status)&&canWrite(r.sheet,r);
  const login=owner?'owner':me.login;
  return r.status==='submitted'&&r.reviewerLogin===login;
 }).sort((a,b)=>a.date.localeCompare(b.date));
 async function processBatch(mode:BatchMode,records:OperatingRecord[],onReceipt:(id:string,message:string)=>void){
  if(working.current)return;
  working.current=true;setBusy(true);setError('');
  try{
   const submissionBatchId=mode==='submit'?crypto.randomUUID():undefined;
   for(const record of records){
    if(!mounted.current)break;
    try{
     const result=await api({companyId,action:mode==='submit'?'ops.submit':'ops.approve',id:record.id,version:record.version,submissionBatchId});
     revisionRef.current=Math.max(revisionRef.current,result.companyRevision);
     onReceipt(record.id,mode==='submit'?'已提交':'已确认');
    }catch(e){onReceipt(record.id,'未获成功回执：'+(e as Error).message);break;}
   }
   if(mounted.current){await load();publishRevision(revisionRef.current);}
  }finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 function actions(record:OperatingRecord|undefined,sheet:OperatingSheet,date=cutoff){const template=data?.config?.templates?.find(t=>t.id===sheet);const assigned=template?writerName(template):sheet==='revenue'||sheet==='targets'?'项目指定主管或管理员':'本项目的员工或管理员';return <div className="op-record-actions">
  {!summary&&!record&&!retired(sheet)&&!canWrite(sheet,record)&&<p className="op-note">本表由{assigned}填写。当前账号可在这里查看填报情况。</p>}
  {canWrite(sheet,record)&&(!record||['draft','returned'].includes(record.status))&&<button className="co-primary" disabled={busy} onClick={()=>editor(sheet,date,record)}><Plus size={16}/>{record?'编辑草稿':'填写'+(sheet==='targets'?'月目标':sheet.endsWith('-stores')?'累计明细':'本日数据')}</button>}
  {canWrite(sheet,record)&&record&&(record.status==='approved'||record.status==='submitted'&&record.submittedBy===(owner?'owner':me.login))&&<button className="op-button" disabled={busy} onClick={()=>editor(sheet,date,record)}><ClipboardPaste size={16}/>用原表核对 / 更新</button>}
  {canWrite(sheet,record)&&record?.status==='submitted'&&record.submittedBy===(owner?'owner':me.login)&&<button className="op-button" disabled={busy} onClick={()=>void run({action:'ops.withdraw',id:record.id,version:record.version})}>撤回修改</button>}
  {canWrite(sheet,record)&&record&&['draft','returned'].includes(record.status)&&<button className="op-button" disabled={busy||!complete(record)} title={complete(record)?'提交给指定确认人':'请先补齐全部必填字段'} onClick={()=>void run({action:'ops.submit',id:record.id,version:record.version})}>提交确认</button>}
  {canWrite(sheet,record)&&record?.status==='approved'&&<button className="op-button" disabled={busy} onClick={()=>open({kind:'amend',record})}>发起更正</button>}
  {!summary&&record?.status==='submitted'&&record.reviewerLogin===(owner?'owner':me.login)&&<><button className="co-primary" disabled={busy} onClick={()=>open({kind:'review',record,approve:true})}><Check size={16}/>核对并确认</button><button className="op-button" disabled={busy} onClick={()=>open({kind:'review',record,approve:false})}>退回补充</button></>}
  {record&&!summary&&<button className="co-text" disabled={busy} onClick={()=>void run({action:'ops.history',id:record.id},r=>open({kind:'history',record,versions:r.versions}))}><History size={15}/>历史</button>}
 </div>;}
 const configuredBuiltinSheets=data?.config?.builtinSheets||['revenue','targets','meituan','douyin','meituan-stores','douyin-stores'],builtinSheets:OperatingSheet[]=[...new Set([...configuredBuiltinSheets,...(data?.records.filter(r=>!r.sheet.startsWith('tpl_')).map(r=>r.sheet)||[])])] as OperatingSheet[],customTemplates=data?.config?.templates?.filter(t=>t.active||data.records.some(r=>r.sheet===t.id))||[];
 const availableStoreSheets=(['meituan-stores','douyin-stores'] as const).filter(s=>builtinSheets.includes(s)||builtinSheets.includes(s==='meituan-stores'?'meituan':'douyin'));
 const daySheets:OperatingSheet[]=[...(['revenue','targets','meituan','douyin'] as OperatingSheet[]).filter(s=>builtinSheets.includes(s as any)),...customTemplates.map(t=>t.id as OperatingSheet)];
 useEffect(()=>{if(data&&daySheets.length&&!daySheets.includes(dailySheet))setDailySheet(daySheets[0]);if(data&&availableStoreSheets.length&&!availableStoreSheets.includes(storeSheet))setStoreSheet(availableStoreSheets[0]);if(data&&view==='stores'&&!availableStoreSheets.length)setView('cumulative');},[data,dailySheet,storeSheet,view]);
 const dailyDate=dailySheet==='targets'?month+'-01':cutoff,dailyRecord=data?.records.find(r=>r.sheet===dailySheet&&r.date===dailyDate),storeRecord=data?.records.find(r=>r.sheet===storeSheet&&r.date===cutoff),targetRecord=data?.records.find(r=>r.sheet==='targets'&&r.date===month+'-01'),dailyTemplate=dailyRecord?.template||data?.config?.templates?.find(t=>t.id===dailySheet);
 const previousSheetDate=summary&&!dailyRecord&&dailySheet!=='targets'
  ?data?.records.filter(record=>record.sheet===dailySheet&&record.status==='approved'&&record.date<dailyDate).map(record=>record.date).sort().at(-1)
  :undefined;

 const workQueue=data?operatingWorkQueue(data.records,{companyId,projectId,cutoff,login:owner?'owner':me.login,summary,fillable:[...daySheets,...(builtinSheets.includes('targets')?['targets' as const]:[])].filter(sheet=>canWrite(sheet,data?.records.find(r=>r.sheet===sheet&&r.date===(sheet==='targets'?month+'-01':cutoff)))).map(sheet=>({sheet,date:sheet==='targets'?month+'-01':cutoff,name:sheetName(sheet,data.config?.templates?.find(t=>t.id===sheet))}))}):{fill:[],review:[]};
 useEffect(()=>{
  if(!initialFill||initialAction.current||loading||!data||!projectId)return;
  initialAction.current=true;
  const item=workQueue.fill.find(item=>item.date===initialFill.date&&item.sheet===initialFill.sheet);
  if(companyId!==initialFill.companyId||data.project.id!==initialFill.projectId||projectId!==initialFill.projectId||!item){
   setNotice('这份记录的状态或填写安排已变化，请查看当前待处理记录。');return;
  }
  editor(item.sheet,item.date,item.record);
 },[initialFill,data,loading,projectId]);
 const employeeEntry=!owner&&me.roles.includes('employee')&&!me.roles.some(role=>role==='supervisor'||role==='leader');
 const queue=!summary&&!loading&&data?.config&&(
  <OperatingWorkQueue
   key={projectId+':'+month}
   {...workQueue}
   cutoff={cutoff}
   disabled={busy||!!modal}
   entryProject={employeeEntry?data.project.name:undefined}
   onPick={(item,kind)=>{
    if(kind==='review'&&item.record)open({kind:'review',record:item.record,approve:true});
    else editor(item.sheet,item.date,item.record);
   }}
  />
 );
 const monthly=monthEnd(month)===cutoff;
 return <section className="company-operating" aria-label="公司经营数据">
  <div className="op-heading"><div className="zb-heading-copy"><SectionMark icon={BarChart3}/><div><h2>经营数据</h2><p>{supervised?'查看所辖项目已确认的日记录和累计报表。':'选模板，记一次。日记录自动生成累计报表。'}</p></div></div><div className="op-heading-tools">{(owner||me.roles.some(role=>role==='leader'||role==='supervisor'))&&<label className="op-scope op-comparison-mode"><span>对比范围</span><select aria-label="数字对比区间" value={comparisonMode} disabled={busy||loading||!!modal} onChange={e=>setComparisonMode(e.target.value as 'month'|'week')}><option value="month">上月同期</option><option value="week">本周与上周同期</option></select></label>}{(owner||me.roles.some(role=>role==='leader'||role==='supervisor'))&&<button ref={comparisonTrigger} type="button" className="op-button" disabled={busy||loading||!!modal||!projectId} onClick={()=>void prepareComparison()}><ArrowLeftRight size={16}/>数字对比（已确认）</button>}{!supervised&&!leaderOnly&&(owner||me.roles.includes('leader')||me.roles.includes('supervisor'))&&<label className="op-scope"><ShieldCheck size={16}/><select aria-label="经营数据口径" value={scope} disabled={busy||!!modal} onChange={e=>{setScope(e.target.value as typeof scope);setNotice('');}}><option value="working">工作记录（含草稿）</option><option value="summary">只看已确认</option></select></label>}{!supervised&&<button type="button" className="op-button" disabled={busy||!!modal} onClick={()=>open({kind:'setup',projectId:projectId||undefined})}><Settings2 size={16}/>项目指标设置</button>}</div></div>
  {employeeEntry&&queue}
  {!summary&&lastReceipt?.key===receiptKey&&<div className="op-last-import"><button type="button" className="op-button" disabled={busy||loading||!!modal} onClick={()=>void reopenReceipt()}><History size={16}/>查看上次导入回执</button><small>{lastReceipt.persisted?'此浏览器保留 7 天。打开时按当前权限读取最新记录。':'浏览器未能保留回执，本次页面内仍可查看。'}</small></div>}
  <ReportHistoryNav singleDay={view==='daily'} kind="operating" value={cutoff} today={today} confirmedOnly={summary} disabled={busy||loading||!!modal} onChange={value=>{changeCutoff(value);setView('cumulative');}}/>
  <div ref={filterBar} className="op-toolbar"><label>经营项目<select aria-label="经营项目" value={projectId} disabled={busy||!!modal||!projects.length} onChange={e=>{setData(null);setProjectId(e.target.value);setNotice('');}}>{!projectId&&<option value="">{projects.length?'请选择经营项目':'暂无可访问项目'}</option>}{projects.map(p=><option value={p.id} key={p.id}>{p.name}{p.enabled?'':' · 未启用'}</option>)}</select></label><label>报表月份<input aria-label="经营报表月份" type="month" value={month} disabled={busy||!!modal} onInput={e=>changeMonth(e.currentTarget.value)} onChange={e=>changeMonth(e.currentTarget.value)}/></label><label>所选日期 / 累计截止<input aria-label="经营截止日期" type="date" value={cutoff} disabled={busy||!!modal} onInput={e=>changeCutoff(e.currentTarget.value)} onChange={e=>changeCutoff(e.currentTarget.value)}/></label><button className="op-button op-refresh" disabled={loading||busy||!!modal||!projectId} onClick={()=>void load()}><RefreshCw size={16} className={loading?'spin':''}/>刷新</button></div>
  {showDateTools&&projectId&&!modal&&<aside className="op-scroll-dates" aria-label="表内切换日期">
   <button type="button" aria-label="前一天" disabled={busy||loading} onClick={()=>changeCutoff(shiftOperatingDay(cutoff,-1))}>‹</button>
   <input type="date" aria-label="表内业务日期" value={cutoff} disabled={busy||loading} onChange={e=>changeCutoff(e.currentTarget.value)}/>
   <button type="button" aria-label="后一天" disabled={busy||loading} onClick={()=>changeCutoff(shiftOperatingDay(cutoff,1))}>›</button>
   <button type="button" aria-label="刷新当前表格" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={16}/></button>
  </aside>}
  <div className="op-quick-dates"><span>经营数据次日出数</span><button disabled={busy||!!modal} className={cutoff===reportDay?'selected':''} onClick={()=>{setCutoff(reportDay);setView(current=>current==='daily'?'cumulative':current);}}>截至昨日 · {reportDay.slice(5).replace('-','/')}</button>{latestRecordDate&&latestRecordDate!==reportDay&&<button disabled={busy||!!modal} className={cutoff===latestRecordDate?'selected':''} onClick={()=>{setCutoff(latestRecordDate);setView(current=>current==='daily'?'cumulative':current);}}>最近填报 · {latestRecordDate.slice(5).replace('-','/')}</button>}<button className={monthly?'selected':''} disabled={monthEnd(month)>today||busy||!!modal} title={monthEnd(month)>today?'本月尚未结束，可按实际日期查看截至当日累计':'查看所选月份的完整月报'} onClick={()=>{setCutoff(monthEnd(month));setView(current=>current==='daily'?'cumulative':current);}}>整月汇总</button><span className="op-quick-unit">金额：元 · 可选择任意实际截止日</span></div>
  {data?.loadedAt&&<p className="op-freshness">完整读取于 {time(data.loadedAt)} · 截至 {cutoff} 有已确认版 {data.records.filter(r=>r.date<=cutoff&&r.publishedVersion>0).length} 条记录 · 点“刷新”取最新</p>}
  {summary&&!!data?.pendingChanges&&<p className="op-note" role="status">有 {data.pendingChanges} 条已确认记录正在更正。以下继续展示上次确认版，新内容通过确认后才会更新。</p>}
  {error&&<p className="co-error" role="alert">{error}</p>}{notice&&<p className="co-notice" role="status">{notice===approvalReceipt&&<Check size={16} className="sx-approved-icon" aria-hidden="true"/>}{notice}</p>}
  {!loading&&!projects.length&&<div className="op-empty"><BarChart3 size={34}/><h3>{owner?'先为公司创建经营项目':summary?'当前没有可查看的已确认项目':'当前没有分配给你的填报任务'}</h3><p>{supervised?'当前分工下的项目确认经营数据后，会出现在这里。':owner?'在“成员与项目”配置负责人和当前有效主管，再打开项目指标设置。':'可在“项目指标设置”查看可配置的项目。已分配的填写任务会在这里显示。'}</p></div>}
  {loading?<div className="op-loading" role="status"><RefreshCw size={20} className="spin"/>正在读取本月经营记录…</div>:data&&!data.config&&supervised?<p className="op-muted">此项目本月暂无已确认经营数据。</p>:data&&!data.config?<div className="op-empty"><Store size={34}/><h3>为「{data.project.name}」选择记录模板</h3><p>{data.permissions.configureOwn?'可从已有 Excel、预设或自选字段生成指标方案，提交主管核实。':'项目指标设置中可选择模板、核实方案或补充指标。'}</p><button className="co-primary" disabled={busy} onClick={()=>open({kind:'setup',projectId:projectId||undefined})}><Plus size={17}/>选择项目模板</button></div>:data?.config&&<>
   {!employeeEntry&&queue}
   <div className="op-mode-tabs" role="group" aria-label="经营数据视图">{([['daily',summary?'按日查看':'日录入',CalendarDays],['cumulative','月初累计',BarChart3],['stores','门店累计',Store]] as const).filter(([key])=>key!=='stores'||availableStoreSheets.length>0).map(([key,label,Icon])=><button key={key} disabled={busy||!!modal} aria-pressed={view===key} className={view===key?'selected':''} onClick={()=>setView(key)}><Icon size={17}/>{label}</button>)}</div>
   {cutoff>today&&<p className="op-note">所选业务日期晚于今天，请核对原表年份和日期。</p>}<div className="op-period-strip"><div><span className="op-period-tag">{view==='daily'?'单日记录':monthly?'整月月报':'月初累计'}</span>{view==='daily'?<div className="op-inline-date" role="group" aria-label="单日记录日期">
    <button type="button" aria-label="单日记录前一天" disabled={busy||loading||!!modal||cutoff==='1970-01-01'} onClick={()=>changeCutoff(shiftOperatingDay(cutoff,-1))}><ArrowLeft size={16}/></button>
    <label><CalendarDays size={15} aria-hidden="true"/><strong aria-hidden="true">{cutoff}</strong>
     <input type="date" aria-label="选择单日记录日期" value={cutoff} min="1970-01-01" max="2100-12-31" disabled={busy||loading||!!modal} onClick={e=>{try{e.currentTarget.showPicker?.();}catch{/* Embedded browsers can still use their native date control. */}}} onChange={e=>changeCutoff(e.currentTarget.value)}/>
    </label>
    <button type="button" aria-label="单日记录后一天" disabled={busy||loading||!!modal||cutoff==='2100-12-31'} onClick={()=>changeCutoff(shiftOperatingDay(cutoff,1))}><ArrowRight size={16}/></button>
   </div>:<strong>{range(cutoff)}</strong>}</div><span><ShieldCheck size={14}/>{summary?'已确认口径':'工作记录 · 含未确认内容'}</span></div>
   <p className="op-boundary">{builtinSheets.includes('revenue')?'门店总业绩说明：'+(data.config?.revenueNote||defaultRevenueNote)+' 平台分项单独列示。':'同一份日记录用于不同截止的累计报表，模板之间不合并收入。'}{view!=='daily'?'累计从当月1日开始，按你选择的实际截止日期汇总。':''}{!summary&&data.permissions.revenue&&builtinSheets.includes('revenue')&&<button className="co-text" type="button" disabled={busy||loading} onClick={()=>open({kind:'revenue-note',revision:data.companyRevision})}>编辑说明</button>}</p>
   {view==='daily'&&<>
    <div className="op-daily-template-cards" role="group" aria-label={summary?'已确认日表':'日录入模板'}>{daySheets.map(sheet=>{const template=customTemplates.find(t=>t.id===sheet),record=data.records.find(r=>r.sheet===sheet&&r.date===(sheet==='targets'?month+'-01':cutoff));return <button key={sheet} disabled={busy||!!modal} aria-pressed={dailySheet===sheet} data-status={record?.status||(retired(sheet)?'retired':'empty')} className={dailySheet===sheet?'selected':''} onClick={()=>setDailySheet(sheet)}><span>{sheetName(sheet,template)}</span><small>{template?(template.dimension==='total'?'一行总数':'按'+(data.config?.dimensionLabel||'门店')):isPlatform(sheet)?'按门店日录 → 自动总盘与累计':sheet==='targets'?'每月独立填写':'按门店日录'}</small><b>{record?stages[record.status]:summary?'无已确认记录':retired(sheet)?'已停用':'待填写'}</b></button>;})}</div>
    {!summary&&dailySheet!=='targets'&&<div className="op-record-actions">{(['submit','approve'] as const).map(mode=>{
     const records=batchRecords(mode);if(!records.length)return null;
     const label=mode==='submit'?'批量提交':'批量确认';
     return <button key={mode} className="op-button" disabled={loading||busy} onClick={()=>open({kind:'batch',mode,records,title:sheetName(dailySheet,records[0].template)+' · '+month+' · '+label})}>{label}（{records.length}）</button>;
    })}</div>}
    {daySheets.length>0?<div className="op-panel" ref={receiptRecordPanel} tabIndex={-1}><RecordHeader sheet={dailySheet} date={dailyDate} record={dailyRecord} template={dailyTemplate}/>{!summary&&retired(dailySheet)&&<p className="op-note">此模板已停用，不能新增记录；已有记录仍可由当前有权限的人更正，再交另一人确认。</p>}{dailyTemplate&&<p className="op-note">{dailyTemplate.description||'按本项目模板记录当日实际数据。'} · {summary?'本版本填写安排：':'当前填写人：'}{writerName(data?.config?.templates?.find(t=>t.id===dailySheet)||dailyTemplate)}填写</p>}{dailyRecord?<>{dailySheet==='targets'?<TargetProgress record={dailyRecord} records={data.records} cutoff={cutoff} confirmedOnly={summary}/>:<OperatingTable sheet={dailySheet} rows={dailyRecord.rows} template={dailyRecord.template}/>}{isPlatform(dailySheet)&&<Ratios sheet={dailySheet} rows={dailyRecord.rows}/ >}{dailyRecord.template&&<TemplateMetrics template={dailyRecord.template} rows={dailyRecord.rows}/>}<RecordFoot record={dailyRecord}/></>:<MissingRecord text={summary?'这一天还没有已确认的记录。':retired(dailySheet)?'模板已停用，不能新增该日记录。请选择启用模板，或切换到已有记录日期更正。':'这一天尚未填写。空白不代表发生量为0。'}/ >}{previousSheetDate&&<button type="button" className="op-button" disabled={busy||loading} onClick={()=>changeCutoff(previousSheetDate)}><CalendarDays size={16}/>查看 {previousSheetDate} 的已确认记录</button>}{actions(dailyRecord,dailySheet,dailyDate)}{dailySheet==='targets'&&canWrite('targets',dailyRecord)&&<button className="op-button" disabled={busy} onClick={()=>open({kind:'target-period'})}><CalendarDays size={16}/>填写其他月份</button>}</div>:<MissingRecord text={summary?'本月暂无已确认的日记录。':'当前未启用日录入模板，可打开项目指标设置查看。'}/>}

    {(dailySheet==='meituan'||dailySheet==='douyin')&&<PlatformPair records={data.records} start={cutoff} end={cutoff} confirmed={summary}/>}
    {dailySheet==='revenue'&&builtinSheets.includes('targets')&&<div className="op-panel op-target-panel"><div className="op-panel-title"><div><h3>{month} 门店月目标</h3><p>每月独立填写，可提前设置后续月份。</p></div>{canWrite('targets',targetRecord)&&<button className="op-button" disabled={busy} onClick={()=>open({kind:'target-period'})}><CalendarDays size={16}/>填写其他月份</button>}</div>{targetRecord?<><TargetProgress record={targetRecord} records={data.records} cutoff={cutoff} confirmedOnly={summary}/><RecordFoot record={targetRecord}/></>:<p className="op-muted">本月目标尚未填写。</p>}{actions(targetRecord,'targets',month+'-01')}</div>}
   </>}
   {view==='cumulative'&&<>{!summary&&<p className="op-note" role="status">图形只使用已确认版；下方工作记录包含未确认草稿，金额可能不同。选择“只看已确认”可统一查看口径。</p>}<React.Suspense fallback={<div className="op-panel" role="status">正在准备经营图形…</div>}><OperatingCharts key={projectId+':'+month} records={data.records} cutoff={cutoff} initialSheet={dailySheet} templates={customTemplates}/></React.Suspense>{(builtinSheets.includes('meituan')||builtinSheets.includes('douyin'))&&<PlatformPair records={data.records} start={month+'-01'} end={cutoff} confirmed={summary}/>}<div className="op-summary-grid">{(['revenue','meituan','douyin'] as OperatingSheet[]).filter(s=>builtinSheets.includes(s as any)).map(sheet=><CumulativeCard key={sheet} sheet={sheet} records={data.records} cutoff={cutoff}/>)}</div><div className="op-panel op-method"><FileClock size={20}/><div><strong>同一批日事实，自动生成累计</strong><p>只累计本月1日至所选截止日。按门店填写平台日记录后，平台总盘和门店累计自动生成；只有总数的日期不会分摊成门店明细。切换“只看已确认”可查看确认快照。</p></div></div>{builtinSheets.includes('revenue')&&<div className="op-panel"><h3>门店总业绩 · {range(cutoff)}</h3><CumulativeTable records={data.records} sheet="revenue" cutoff={cutoff}/></div>}{(['meituan','douyin'] as const).filter(s=>builtinSheets.includes(s)).map(platform=><div className="op-panel" key={platform}><h3>{platform==='meituan'?'美团':'抖音'}平台 · {range(cutoff)}</h3><CumulativeTable records={data.records} sheet={platform} cutoff={cutoff}/><Reconciliation records={data.records} platform={platform} cutoff={cutoff} onSelectDate={changeCutoff}/></div>)}{customTemplates.map(template=><div className="op-panel" key={template.id}><h3>{template.name} · {range(cutoff)}</h3><CumulativeTable records={data.records} sheet={template.id as OperatingSheet} cutoff={cutoff} template={template}/></div>)}</>}
   {view==='stores'&&<><div className="op-sheet-tabs" role="group" aria-label="平台门店累计类型">{availableStoreSheets.map(sheet=><button key={sheet} className={storeSheet===sheet?'selected':''} disabled={busy||!!modal} onClick={()=>setStoreSheet(sheet)}>{sheet==='meituan-stores'?'美团门店累计':'抖音门店累计'}</button>)}</div><div className="op-panel" ref={receiptRecordPanel} tabIndex={-1}><div className="op-panel-title"><h3>{operatingSheetNames[storeSheet]} · {range(cutoff)}</h3><span className="op-status approved">按来源累计</span></div><CumulativeTable records={data.records} sheet={storeSheet} cutoff={cutoff}/>{builtinSheets.includes(storeSheet)&&<details className="op-legacy-snapshot" open={!!storeRecord}><summary>已有平台累计表？导入 / 核对兼容快照</summary><p className="op-note">推荐按门店日录，一次生成平台总盘与门店累计。如手头只有 {range(cutoff)} 的累计表，可另存此截止日快照。完整日明细优先；不同截止快照不会相加。</p>{storeRecord&&<><RecordHeader sheet={storeSheet} date={cutoff} record={storeRecord}/><OperatingTable sheet={storeSheet} rows={storeRecord.rows} sharedAdSpend={storeRecord.sharedAdSpend}/><RecordFoot record={storeRecord}/></>}{actions(storeRecord,storeSheet)}{!summary&&(data.permissions.configure||data.permissions.configureOwn)&&<button type="button" className="op-button" disabled={busy||!!modal} onClick={()=>open({kind:'setup',projectId,stores:true})}><Store size={16}/>查看 / 配置项目门店</button>}</details>}</div><div className="op-panel"><Reconciliation records={data.records} platform={storeSheet==='meituan-stores'?'meituan':'douyin'} cutoff={cutoff} onSelectDate={changeCutoff}/></div></>}
  </>}
  {modal&&<OperatingDialog projectName={modal.kind==='edit'?(data?.project.name||projects.find(p=>p.id===projectId)?.name||projectId):undefined} returnTo={modal.kind==='comparison'?comparisonTrigger.current:undefined} title={modal.kind==='receipt'?'上次导入回执':modal.kind==='revenue-note'?'编辑门店总业绩说明':modal.kind==='batch'?modal.title:modal.kind==='edit'?sheetName(modal.sheet,modal.template)+' · '+(modal.sheet.endsWith('-stores')?range(modal.date):modal.sheet==='targets'?modal.date.slice(0,7):modal.date):modal.kind==='comparison'?'经营数字同口径对比':modal.kind==='amend'?'填写更正原因':modal.kind==='target-record'?'月目标 · '+modal.record.date.slice(0,7):modal.kind==='setup'?'项目指标设置':modal.kind==='target-period'?'选择月目标月份':modal.kind==='review'?(modal.approve?'核对并确认经营数据':'退回补充经营数据'):'经营数据版本历史'} busy={busy} error={error} onClose={close}>
   {modal.kind==='revenue-note'&&<form onSubmit={e=>{e.preventDefault();const note=String(new FormData(e.currentTarget).get('note')||'').trim();void run({action:'ops.revenueNote',projectId,revision:modal.revision,note});}}>
    <label>当前项目的业绩口径<textarea name="note" rows={3} maxLength={300} defaultValue={data?.config?.revenueNote??defaultRevenueNote} onChange={()=>setDirty(true)} disabled={busy}/></label><p className="op-muted">这段文字会显示在填报页和领导查看的报表中。清空并保存可恢复默认说明。</p><button className="co-primary" disabled={busy}>保存说明</button></form>}
   {modal.kind==='edit'&&modal.sheet==='revenue'&&<p className="op-note">门店总业绩说明：{data?.config?.revenueNote||defaultRevenueNote}</p>}
   {modal.kind==='receipt'&&<OperatingImportOutcome receipts={modal.receipts} onView={leaveForm} onSubmit={submitImported}/>}
   {modal.kind==='batch'&&<OperatingBatch mode={modal.mode} records={modal.records} busy={busy} onRun={processBatch}/>}
   {modal.kind==='comparison'&&<OperatingComparison value={modal.value} preferredSheet={dailySheet} reportRequest={supervised||owner||me.roles.includes('leader')?api:undefined}/>}
   {modal.kind==='amend'&&<AmendmentReasonForm busy={busy} onDirty={()=>setDirty(true)} onSave={reason=>void run({action:'ops.amend',id:modal.record.id,version:modal.record.version,reason},r=>editor(modal.record.sheet,modal.record.date,r.record))}/>}
   {modal.kind==='setup'&&<OperatingIndicatorSettings focusStores={modal.stores} initialId={modal.projectId} companyId={companyId} month={month} busy={busy} dirty={dirty} onDirty={setDirty} onBusy={setBusy} onSaved={(newRevision,message)=>{publishRevision(newRevision);setDirty(false);setModal(null);setNotice(message);}}/>}
   {modal.kind==='edit'&&<OperatingEditor key={modal.sheet+modal.date} value={modal} draftIdentity={{companyId,projectId,sheet:modal.sheet,date:modal.date,login:owner?'owner':me.login}} busy={busy} onDirty={()=>{savedImport.current=null;setDirty(true);}} onViewSaved={leaveForm} onSubmitImported={submitImported} onImportDays={saveSourceDays} targetImportIssue={!data?.permissions.revenue?'当前账号没有门店月目标填写权限。':!configuredBuiltinSheets.includes('targets')?'项目尚未启用门店月目标。':''} onSave={async (rows,sharedAdSpend)=>!!(await run({action:'ops.save',sharedAdSpend,projectId,sheet:modal.sheet,date:modal.date,version:modal.record?.version||0,rows}))}/>}
   {modal.kind==='target-record'&&<><RecordHeader sheet="targets" date={modal.record.date} record={modal.record}/><TargetProgress record={modal.record} records={modal.records} cutoff={modal.cutoff} confirmedOnly={summary}/><RecordFoot record={modal.record}/>{actions(modal.record,'targets',modal.record.date)}</>}
   {modal.kind==='target-period'&&<TargetPeriod month={month} busy={busy} onOpen={value=>void targetEditor(value)} onDirty={()=>setDirty(true)}/>}
   {modal.kind==='review'&&<ReviewForm record={modal.record} approve={modal.approve} busy={busy} onDirty={()=>setDirty(true)} onChoose={approve=>{setModal(current=>current?.kind==='review'?{...current,approve}:current);setError('');}} onConfirm={comment=>void run({action:modal.approve?'ops.approve':'ops.return',id:modal.record.id,version:modal.record.version,comment})}/>}
   {modal.kind==='history'&&<><p className="op-muted">每次保存、提交、确认与更正均留下版本；历史保留当时字段与行名。</p>{modal.versions.map(version=><details className="op-history" key={version.operating.version}><summary><span>V{version.operating.version} · {stages[version.operating.status]} · {actionNames[version.action]||'历史操作'}</span><small>{version.actor} · {time(version.at)}</small></summary><p className="op-muted">{sheetName(version.operating.sheet,version.operating.template)} · {actionNames[version.action]||'历史操作'} · {version.operating.date}</p><OperatingTable sheet={version.operating.sheet} rows={version.operating.rows} template={version.operating.template} sharedAdSpend={version.operating.sharedAdSpend}/>{version.operating.template&&<TemplateMetrics template={version.operating.template} rows={version.operating.rows}/ >}{version.operating.amendmentReason&&<p className="op-note"><strong>更正原因：</strong>{version.operating.amendmentReason}</p>}{version.operating.comment&&<p className="op-note">{version.operating.comment}</p>}</details>)}</>}
  </OperatingDialog>}
 </section>;
}

function RecordHeader({sheet,date,record,template}:{sheet:OperatingSheet;date:string;record?:OperatingRecord;template?:OperatingTemplate}){return <div className="op-panel-title"><div><h3>{sheetName(sheet,record?.template||template)}</h3><p>{sheet.endsWith('-stores')?range(date):sheet==='targets'?date.slice(0,7)+' 月目标':date+' 单日事实'}</p></div><span className={'op-status '+(record?.status||'empty')}>{record?stages[record.status]+' · V'+record.version:'未填报'}</span></div>;}
function RecordFoot({record}:{record:OperatingRecord}){return <div className="op-record-foot"><span>{record.updatedAt?(record.status==='approved'?'确认于 ':'更新于 ')+time(record.updatedAt):''}{record.submittedName?' · 提交 '+record.submittedName:''}{record.status==='approved'&&record.reviewerName?' · 确认人 '+record.reviewerName:''}</span>{record.status==='submitted'&&<span>等待 {record.reviewerLogin==='owner'?'管理员':record.reviewerLogin} 确认 · 提交后暂不可编辑</span>}{record.published&&record.status!=='approved'&&<span className="op-published-note">领导仍查看已确认 V{record.publishedVersion}（{time(record.published.updatedAt)}），本次更正确认后再更新。</span>}{record.amendmentReason&&<p><strong>更正原因：</strong>{record.amendmentReason}</p>}{record.comment&&<p>{record.reviewerName||'确认意见'}：{record.comment}</p>}</div>;}
function MissingRecord({text}:{text:string}){return <div className="op-missing"><FileClock size={22}/><p>{text}</p></div>;}
function shiftOperatingDay(value:string,offset:number){
 const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);
}
function OperatingBatch({mode,records,busy,onRun}:{mode:BatchMode;records:OperatingRecord[];busy:boolean;onRun:(mode:BatchMode,records:OperatingRecord[],onReceipt:(id:string,message:string)=>void)=>Promise<void>}){
 const [chosen,setChosen]=useState<string[]>([]),[receipts,setReceipts]=useState<Record<string,string>>({});
 const eligible=records.filter(r=>mode==='approve'||complete(r));
 const started=Object.keys(receipts).length>0,locked=busy||started;
 const label=mode==='submit'?'提交':'确认';
 const selected=eligible.filter(r=>chosen.includes(r.id));
 return <section className="op-batch">
  <p>{mode==='approve'?'勾选你已核对的日期。确认后，对应日期的数字将进入领导汇总。':'勾选要提交给指定确认人的日期。缺少必填数据的记录可补齐后提交。'}</p>
  <label><input type="checkbox" disabled={locked||!eligible.length} checked={eligible.length>0&&chosen.length===eligible.length} onChange={e=>setChosen(e.target.checked?eligible.map(r=>r.id):[])}/> 全选可{label}日期（{eligible.length}）</label>
  {records.map(r=>{const valid=eligible.includes(r);
   return <div key={r.id} className="op-batch-row"><label><input type="checkbox" disabled={locked||!valid} checked={chosen.includes(r.id)} onChange={e=>setChosen(prev=>e.target.checked?[...prev,r.id]:prev.filter(id=>id!==r.id))}/> {r.date}{records.some(other=>other.sheet!==r.sheet)?' · '+sheetName(r.sheet,r.template):''}</label>
    <details><summary>核对明细 · V{r.version}{r.submittedName&&mode==='approve'?' · '+r.submittedName:''}</summary><OperatingTable sheet={r.sheet} rows={r.rows} template={r.template} sharedAdSpend={r.sharedAdSpend}/></details>
    <small>{receipts[r.id]||(!valid?'必填数据未齐':started&&chosen.includes(r.id)?(busy?'等待处理':'尚未处理'):'')}</small></div>;
  })}
  <button className="co-primary" disabled={locked||!selected.length} onClick={()=>void onRun(mode,selected,(id,message)=>setReceipts(prev=>({...prev,[id]:message})))}>{busy?'正在处理…':label+'选中的 '+selected.length+' 条'}</button>
  {started&&!busy&&<p role="status">{Object.values(receipts).filter(v=>v==='已提交'||v==='已确认').length} 条已获成功回执。关闭后可查看最新状态。</p>}
 </section>;
}
function OperatingTable({sheet,rows,template,sharedAdSpend,incompleteFields=[],incompleteFieldsByStore={}}:{sharedAdSpend?:number;sheet:OperatingSheet;rows:OperatingRow[];template?:OperatingTemplate;incompleteFields?:string[];incompleteFieldsByStore?:Record<string,string[]>}){
 let fields:Field[];try{fields=operatingFields(sheet,template);}catch(e){return <p className="co-error" role="alert">无法展示当前字段：{(e as Error).message}。原始记录已保留，请重新读取后核对。</p>;}
 let total:Record<string,number|null>=Object.fromEntries(fields.map(field=>[field.key,null])),totalError='';try{total=totals(rows,fields);}catch(e){totalError=(e as Error).message;}
 type Metric=ReturnType<typeof operatingTableMetrics>[number];let metricColumns:Metric[]=[],totalMetrics:Metric[]=[],metricError='';const rowMetrics=new Map<string,Metric[]>();
 if(sharedAdSpend!==undefined)total.adSpend=sharedAdSpend;
 try{metricColumns=operatingTableMetrics(sheet,{},template);const safeValues=(values:Record<string,number|null>,gaps:string[])=>({...values,...Object.fromEntries(gaps.map(key=>[key,null]))});for(const row of rows)rowMetrics.set(row.storeId,operatingTableMetrics(sheet,safeValues(row.values,incompleteFieldsByStore[row.storeId]||[]),template));const grouped=safeValues(totals(rows,fields,true),incompleteFields);if(sharedAdSpend!==undefined)grouped.adSpend=sharedAdSpend;totalMetrics=operatingTableMetrics(sheet,grouped,template);}catch(e){metricError=(e as Error).message;}
 const columns=operatingTableColumns(sheet,fields,metricColumns,template);
 const incomplete=incompleteFields.some(k=>k!=='adSpend'||sharedAdSpend===undefined)||fields.some(f=>(f.key!=='adSpend'||sharedAdSpend===undefined)&&f.kind!=='stars'&&rows.some(r=>r.values[f.key]==null)&&(f.required||rows.some(r=>r.values[f.key]!=null)));
 return <div className="op-table-scroll" tabIndex={0} role="region" aria-label={sheetName(sheet,template)+'数据表，可横向滚动'}><table className="op-table"><thead><tr><th scope="col">{rows.length===1&&rows[0].storeId==='all'?'范围':template?'名称':'门店'}</th>{columns.map(({field:f,metric})=>f?<th scope="col" key={f.key}>{f.label}{f.kind==='money'&&<small>元</small>}</th>:<th scope="col" className="op-derived-column" key={'metric-'+metric.key}>{metric.label}<small title={metric.unitIssue}>{metric.unitIssue?'公式单位不匹配':'自动计算'}</small></th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.storeId}><th scope="row">{row.storeName}</th>{columns.map(({field:f,metric})=>f?<td key={f.key} className={row.values[f.key]==null?'op-unknown':''}>{display(row.values[f.key],f.kind)}{row.values[f.key]!=null&&incompleteFieldsByStore[row.storeId]?.includes(f.key)&&<small title="仅包含有记录的日期和范围"> 已填小计</small>}</td>:<td className="op-derived-column" key={'metric-'+metric.key}>{metricDisplay(rowMetrics.get(row.storeId)?.find(value=>value.key===metric.key))}</td>)}</tr>)}</tbody>{rows.length>1&&<tfoot><tr><th scope="row">{incomplete?'已填合计':'合计'}</th>{columns.map(({field:f,metric})=>f?<td key={f.key}>{display(total[f.key],f.kind)}</td>:<td className="op-derived-column" key={'metric-'+metric.key}>{metricDisplay(totalMetrics.find(value=>value.key===metric.key))}</td>)}</tr></tfoot>}</table>{sharedAdSpend!==undefined&&<p className="op-table-note">全平台累计消耗 {yuan(sharedAdSpend)} 元，仅计一次。门店没有独立消耗时，门店 ROI 留空。</p>}{totalError&&<p className="co-error" role="alert">{totalError}；合计暂不展示，门店原值保留。</p>}{metricError&&<p className="co-error" role="alert">指标暂无法计算：{metricError}；原始字段已保留。</p>}{incomplete&&<p className="op-table-note">— 表示未填或所需字段未齐；合计仅含已填数值，不能作为完整总数。{fields.some(f=>f.kind==='stars')?'星级不求平均。':''}</p>}{metricColumns.length>0&&<p className="op-table-note">自动计算列按各行原始字段重算；合计先加总分子与分母，再算比率，不平均门店率。</p>}</div>;
}
function TargetProgress({record,records,cutoff,confirmedOnly}:{record:OperatingRecord;records:OperatingRecord[];cutoff:string|null;confirmedOnly:boolean}){
 if(confirmedOnly&&record.status!=='approved')return <p className="op-muted">本月目标尚未确认。</p>;
 if(!cutoff)return <><OperatingTable sheet="targets" rows={record.rows}/><p className="op-muted">首个业务日出数后可查看完成率。</p></>;
 let progress:ReturnType<typeof operatingTargetProgress>;
 try{progress=operatingTargetProgress(record,records,cutoff,confirmedOnly);}
 catch(e){return <><OperatingTable sheet="targets" rows={record.rows}/><p role="alert" className="co-error">暂无法计算完成情况：{(e as Error).message}</p></>;}
 const incomplete=progress.rows.some(row=>row.reportedDays<progress.daysExpected||row.target==null);
 const today=todayShanghai(),missing=progress.missingDates.filter(day=>day<today),upcoming=progress.missingDates.filter(day=>day>=today);
 return <section aria-label="门店月目标完成情况">
  <OperatingTargetChart progress={progress} cutoff={cutoff} confirmedOnly={confirmedOnly} approvedTarget={record.status==='approved'}/>
  <p className="op-muted">截至 {cutoff}，按本月已录入的「{progress.sourceName}」计算。{confirmedOnly?'仅含已确认金额。':record.status==='approved'?'月目标已确认。':'月目标尚未确认。'}</p>
  <div className="op-table-scroll" tabIndex={0} role="region" aria-label="门店月目标完成情况数据表，可横向滚动">
   <table className="op-table"><thead><tr><th>门店</th><th>月目标<small>元</small></th><th>累计总业绩<small>元</small></th><th>完成率</th><th>业绩已录天数</th></tr></thead>
    <tbody>{progress.rows.map(row=><tr key={row.storeId}><th scope="row">{row.storeName}</th><td>{yuan(row.target)}</td><td>{yuan(row.revenue)}</td><td>{percent(row.rate)}</td><td>{row.reportedDays} / {progress.daysExpected}{row.unconfirmedDays>0&&<small> · {row.unconfirmedDays} 天未确认</small>}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">{incomplete?'已填合计':'合计'}</th><td>{yuan(progress.total.target)}</td><td>{yuan(progress.total.revenue)}</td><td>{percent(progress.total.rate)}</td><td></td></tr></tfoot>
   </table>
  </div>
  {missing.length>0&&<details className="op-missing-days"><summary>{missing.length} 天{confirmedOnly?'没有已确认业绩':'缺报业绩'}</summary><p>{missing.join('、')}</p></details>}
  {upcoming.length>0&&<p className="op-muted">待出数（次日更新）：{upcoming.join('、')}</p>}
  {progress.rows.some(r=>r.target===0||r.target==null)&&<p className="op-table-note">目标为 0 或未填的门店不计算完成率。缺少门店目标时，合计完成率留空。</p>}
 </section>;
}
function Ratios({sheet,rows,incompleteFields=[],sharedAdSpend}:{sharedAdSpend?:number;sheet:OperatingSheet;rows:OperatingRow[];incompleteFields?:string[]}){
 try{
 const values=totals(rows,operatingFields(sheet),true);incompleteFields.forEach(key=>{values[key]=null;});if(sharedAdSpend!==undefined)values.adSpend=sharedAdSpend;const r=operatingRatios(values);
 return <div className="op-ratios"><div><span>核销率</span><strong>{percent(r.verificationRate)}</strong></div><div><span>退款率</span><strong>{percent(r.refundRate)}</strong></div><div><span>核销投产</span><strong>{r.verifiedRoi==null?'—':formatOperatingDecimal(r.verifiedRoi)}</strong></div><div><span>下单投产</span><strong>{r.orderRoi==null?'—':formatOperatingDecimal(r.orderRoi)}</strong></div>{sheet==='meituan-stores'&&<div><span>有效好评率</span><strong>{percent(r.positiveRate)}</strong></div>}{sheet==='meituan'&&<div><span>总曝光</span><strong>{r.totalExposure==null?'—':r.totalExposure.toLocaleString('zh-CN')}</strong></div>}<p>先合计分子与分母，再计算比率；核销可跨期，核销率允许超过100%。所需字段在任一日期 / 行未齐，或分母为0时显示 —。</p></div>;
 }catch(e){return <p className="co-error" role="alert">暂无法计算比率或总曝光：{(e as Error).message}。原始记录已保留，请核对数值后重试。</p>;}
}
function TemplateMetrics({template,rows,incompleteFields=[]}:{template:OperatingTemplate;rows:OperatingRow[];incompleteFields?:string[]}){
 try{const values=totals(rows,template.fields,true);incompleteFields.forEach(key=>{values[key]=null;});const metrics=operatingTemplateMetrics(template,values);return metrics.length>0?<div className="op-ratios">{metrics.map(metric=><div key={metric.key}><span>{metric.label}</span><strong>{metric.value==null?'—':metric.format==='percent'?percent(metric.value):metric.format==='money'?'¥'+metric.value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):formatOperatingDecimal(metric.value)}</strong>{metric.unitIssue&&<small>{metric.unitIssue}</small>}</div>)}<p>按完整的分子与分母合计后计算；任一日期 / 行缺少所需字段，或分母为0时保留空白。</p></div>:null;
 }catch(e){return <p className="co-error" role="alert">暂无法计算模板指标：{(e as Error).message}。原始记录已保留，请重新读取后核对。</p>;}
}
function getSummary(records:OperatingRecord[],sheet:OperatingSheet,cutoff:string){try{return{value:operatingSummary(records,sheet,cutoff),error:''};}catch(e){return{value:null,error:(e as Error).message};}}
function MissingDays({missing}:{missing:string[]}){
 const today=todayShanghai(),overdue=missing.filter(d=>d<today),upcoming=missing.filter(d=>d>=today);
 return <>{overdue.length>0&&<details className="op-missing-days"><summary><TriangleAlert size={14}/>{overdue.length} 个日期缺报 · 展开核对</summary><p>{overdue.join('、')}</p></details>}{upcoming.length>0&&<p className="op-muted">待出数（次日更新）：{upcoming.join('、')}</p>}</>;
}
function PlatformPair({records,start,end,confirmed}:{records:OperatingRecord[];start:string;end:string;confirmed:boolean}){
 const [key,setKey]=useState<typeof combinedPlatformFields[number]>('verifiedAmount');
 const fields=operatingFields('meituan'),field=fields.find(f=>f.key===key)!;
 let report;
 try{report=combinedPlatformSummary(records,start,end,key);}catch(e){return <div className="op-panel"><h3>美团＋抖音</h3><p className="co-error" role="alert">{(e as Error).message}</p></div>;}
 const unit=field.kind==='money'?'元':key==='refundOrders'?'单':'张';
 return <section className="op-panel op-platform-pair" aria-label="美团和抖音合计">
  <div className="op-panel-title"><div><h3>美团＋抖音</h3><p>{start===end?end:start+' 至 '+end} · {confirmed?'已确认口径':'工作记录，含未确认内容'}</p></div>
   <label>合计指标 <select aria-label="双平台合计指标" value={key} onChange={e=>{const chosen=combinedPlatformFields.find(f=>f===e.target.value);if(chosen)setKey(chosen);}}>{combinedPlatformFields.map(k=><option key={k} value={k}>{fields.find(f=>f.key===k)!.label}</option>)}</select></label></div>
  <div className="op-pair-values">{report.parts.map(p=><div key={p.sheet}><span>{p.sheet==='meituan'?'美团':'抖音'}</span><strong>{display(p.value,field.kind)}{p.value!==null&&' '+unit}</strong><small>{p.value===null?'暂无该指标数据':(p.complete?'数据齐全':'已填小计')+' · 最近数据 '+p.latest}</small></div>)}<div><span>双平台合计 · {field.label}</span><strong>{display(report.total,field.kind)}{report.total!==null&&' '+unit}</strong><small>{report.total===null?'两边数据齐全后显示合计':'仅汇总这两个平台的同一指标'}</small></div></div>
  <p className="op-table-note">来自美团、抖音的平台日录。门店总业绩已包含平台收入，汇报时请分别查看。</p>
 </section>;
}
function CumulativeCard({sheet,records,cutoff}:{sheet:OperatingSheet;records:OperatingRecord[];cutoff:string}){
 const {value,error}=getSummary(records,sheet,cutoff);if(!value)return <div className="op-summary-card"><h3>{operatingSheetNames[sheet]}</h3><p className="co-error">{error}</p></div>;
 const key=sheet==='revenue'?'revenue':'verifiedAmount';let total:Record<string,number|null>;try{total=totals(value.rows,operatingFields(sheet));}catch(e){return <div className="op-summary-card"><h3>{operatingSheetNames[sheet]}</h3><p className="co-error" role="alert">{(e as Error).message}；原始记录已保留。</p></div>;}const count=value.rows.filter(row=>row.values[key]!=null).length;
 return <div className={'op-summary-card '+(sheet==='revenue'?'op-summary-primary':'')}><span>{sheet==='revenue'?'门店总业绩':sheet==='meituan'?'美团平台核销金额':'抖音平台核销金额'}</span><strong><small>¥</small>{yuan(total[key])}</strong><div className="op-summary-meta"><b>{value.complete?'完整累计':'已填累计'}</b><span>{value.daysReported} / {value.daysExpected} 天有记录</span></div>{!count&&<p>本期尚无已填金额</p>}{!value.complete&&<p>{value.scopeChanged?'期间填报范围有变，金额仅列已填小计。':'缺报或必填字段未齐，请先补齐再核对。'}</p>}</div>;
}
function CumulativeTable({records,sheet,cutoff,template}:{records:OperatingRecord[];sheet:OperatingSheet;cutoff:string;template?:OperatingTemplate}){
 const {value,error}=getSummary(records,sheet,cutoff);if(!value)return <p className="co-error" role="alert">{error}</p>;
 const snapshot=value.template||template;
 return <><p className="op-muted">{value.complete?'本期间必填数据完整':value.scopeChanged?'期间门店或填报范围有变，仅列已填小计':'本表为已填小计，缺报与未填字段仍待补充'} · {value.source==='snapshot'?'已提供所选范围累计快照':value.daysReported+'/'+value.daysExpected+' 天有日明细'}{value.source?' · 来源：'+(value.source==='daily'?'逐日门店明细自动累计':'同截止日手工累计快照'):''}</p><MissingDays missing={value.missingDates}/>{sheet==='meituan-stores'&&value.source==='daily'&&<p className="op-muted">新增好评按日累计；星级取所选截止日的填报值，不合计或平均。</p>}{value.rows.length?<><OperatingTable sheet={sheet} rows={value.rows} sharedAdSpend={value.sharedAdSpend} template={snapshot} incompleteFields={value.incompleteFields} incompleteFieldsByStore={value.incompleteFieldsByStore}/>{(isPlatform(sheet)||sheet.endsWith('-stores'))&&<Ratios sheet={sheet} rows={value.rows} sharedAdSpend={value.sharedAdSpend} incompleteFields={value.incompleteFields}/ >}{snapshot&&<TemplateMetrics template={snapshot} rows={value.rows} incompleteFields={value.incompleteFields}/>}</>:<MissingRecord text="本期还没有可累计的日记录。"/>}</>;
}
function Reconciliation({records,platform,cutoff,onSelectDate}:{records:OperatingRecord[];platform:'meituan'|'douyin';cutoff:string;onSelectDate:(date:string)=>void}){
 let result:ReturnType<typeof operatingReconciliation>;try{result=operatingReconciliation(records,platform,cutoff);}catch(e){return <p className="co-error">{(e as Error).message}</p>;}
 const fields=operatingFields(platform),state=result.state;
 const priorCutoff=state==='incomplete'&&result.storesSource!=='snapshot'?records.filter(r=>r.sheet===platform+'-stores'&&r.date.startsWith(cutoff.slice(0,7))&&r.date<cutoff).map(r=>r.date).sort().at(-1):undefined;
 return <section className={'op-reconciliation '+state} aria-label={(platform==='meituan'?'美团':'抖音')+'累计核对'}><div className="op-reconciliation-heading">{state==='match'?<ShieldCheck size={18}/>:<TriangleAlert size={18}/>}<div><h4>{result.storesSource==='snapshot'?'平台日累计 ↔ 已导入门店快照':'平台日累计 ↔ 自动门店累计'}</h4><p>{range(cutoff)} · {result.scopeMismatch?'两边门店不同，无法逐项对账':state==='match'?(result.storesSource==='snapshot'?'两份记录的财务字段金额一致':'同源日记录重算一致'):state==='different'?'存在差异，请分别核对原始记录':'数据未齐，暂不能确认两边一致'}</p></div></div>{priorCutoff&&<button type="button" className="op-button" onClick={()=>onSelectDate(priorCutoff)}>查看截至 {priorCutoff} 的门店累计表</button>}<MissingDays missing={result.missingDates}/>{result.differences.length>0&&<div className="op-table-scroll"><table className="op-table op-reconcile-table"><thead><tr><th>核对字段</th><th>平台日累计</th><th>门店累计</th><th>差额（门店−平台）</th></tr></thead><tbody>{result.differences.map(d=>{const field=fields.find(f=>f.key===d.key),kind=field?.kind||'count';return <tr key={d.key}><th scope="row">{d.label}</th><td>{display(d.daily,kind)}</td><td>{display(d.stores,kind)}</td><td className={d.difference?'op-difference':''}>{d.difference==null?'—':display(d.difference,kind)}</td></tr>;})}</tbody></table></div>}<p className="op-table-note">核对不会覆盖任何来源。已有同截止日累计快照时优先与快照比对；明细由日记录生成时属于同源核对。缺门店、缺日期或必填字段时显示“未齐”。</p></section>;
}

function OperatingDialog({title,children,busy,error,onClose,returnTo,projectName}:{projectName?:string;title:string;children:React.ReactNode;busy:boolean;error:string;onClose:()=>void;returnTo?:HTMLElement|null}){
 const ref=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{returnFocus.current=returnTo||document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();returnFocus.current?.focus();};},[returnTo]);
 if(typeof document==='undefined')return null;
 return createPortal(<dialog ref={ref} className="op-dialog" aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><div className="op-dialog-heading"><div>{projectName&&<small>{projectName}</small>}<h2>{title}</h2></div><button type="button" className="op-close" aria-label="关闭经营数据对话框" disabled={busy} onClick={onClose}><X size={21}/></button></div><div className="op-dialog-body">{error&&<p className="co-error" role="alert">{error}</p>}{children}</div></dialog>,document.body);
}
function TargetPeriod({month,busy,onOpen,onDirty}:{month:string;busy:boolean;onOpen:(value:string)=>void;onDirty:()=>void}){const[value,setValue]=useState(month);function change(next:string){if(!/^\d{4}-\d{2}$/.test(next))return;try{operatingDate(next+'-01');}catch{return;}setValue(next);onDirty();}return <form className="op-form" onSubmit={e=>{e.preventDefault();if(/^\d{4}-\d{2}$/.test(value))onOpen(value);}}><fieldset disabled={busy}><label>目标月份<input type="month" required aria-label="目标月份" value={value} onInput={e=>change(e.currentTarget.value)} onChange={e=>change(e.currentTarget.value)}/></label><p className="op-muted">月目标可提前填写；日事实与门店累计截止日期不能超过今天。</p><button className="co-primary">读取该月目标并填写 <ArrowRight size={16}/></button></fieldset></form>;}
function AmendmentReasonForm({busy,onDirty,onSave}:{busy:boolean;onDirty:()=>void;onSave:(reason:string)=>void}){const[reason,setReason]=useState('');return <form className="op-form" onSubmit={e=>{e.preventDefault();if(reason.trim())onSave(reason.trim());}}><fieldset disabled={busy}><p className="op-note">记录原因后再编辑。更正通过另一人确认之前，领导汇总继续保留原已确认版本。</p><label>更正原因<textarea required maxLength={1000} rows={4} value={reason} onChange={e=>{setReason(e.target.value);onDirty();}} placeholder="例如：对账发现漏记，补充哪笔业务或凭据。"/></label><button type="submit" className="co-primary" disabled={busy||!reason.trim()}>记录原因并更正</button></fieldset></form>;}
function ReviewForm({record,approve,busy,onDirty,onChoose,onConfirm}:{record:OperatingRecord;approve:boolean;busy:boolean;onDirty:()=>void;onChoose:(approve:boolean)=>void;onConfirm:(comment:string)=>void}){
 const [comment,setComment]=useState('');
 const reasonInput=useRef<HTMLTextAreaElement>(null);
 const changes=operatingReviewChanges(record);
 function chooseDecision(){
  if(approve)reasonInput.current?.focus();
  onChoose(!approve);
 }
 return <form className="op-form" onSubmit={event=>{event.preventDefault();if(approve||comment.trim())onConfirm(comment.trim());}}>
  <fieldset disabled={busy}>
   <p className="op-note">{record.projectName} · {sheetName(record.sheet,record.template)} · {record.sheet.endsWith('-stores')?range(record.date):record.date} · V{record.version}<br/>提交人：{record.submittedName||record.submittedBy}</p>
   {record.published&&<>
    <p className="op-note"><strong>更正原因</strong> {record.amendmentReason||'历史版本未记录原因'}<br/>当前汇报仍采用已确认 V{record.publishedVersion}。</p>
    {changes.length?<details className="op-review-diff" open><summary>与上次已确认 V{record.publishedVersion} 相比，{changes.length} 处数值变化</summary><div className="op-table-scroll"><table className="op-table"><thead><tr><th>门店 / 范围</th><th>字段</th><th>此前已确认</th><th>本次提交</th></tr></thead><tbody>{changes.map((change,i)=><tr key={i}><th>{change.storeName}</th><td>{change.label}</td><td>{display(change.before,change.kind)}</td><td className="op-changed-value">{display(change.after,change.kind)}</td></tr>)}</tbody></table></div></details>:<p className="op-muted">原始数值与上次确认一致。</p>}
   </>}
   <OperatingTable sheet={record.sheet} rows={record.rows} sharedAdSpend={record.sharedAdSpend} template={record.template}/>
   {record.template&&<TemplateMetrics template={record.template} rows={record.rows}/>}
   <label>{approve?'确认意见（可选）':'退回原因'}<textarea ref={reasonInput} rows={3} maxLength={1000} required={!approve} value={comment} onChange={e=>{setComment(e.target.value);onDirty();}}/></label>
   <div className="op-form-footer"><p>{approve?'确认后更新领导可见的快照。':'填写人可补充内容并重新提交。'}</p><button type="button" className="op-button" onClick={chooseDecision}>{approve?'退回补充':'返回核对确认'}</button><button className="co-primary" disabled={!approve&&!comment.trim()}>{approve?'确认并更新快照':'退回补充'}</button></div>
  </fieldset>
 </form>;
}
function OperatingEditor({value,draftIdentity,busy,onDirty:signalDirty,onViewSaved,onSubmitImported,onSave,onImportDays,targetImportIssue}:{targetImportIssue:string;onViewSaved:(item:ImportReceipt)=>void;onSubmitImported:(receipts:ImportReceipt[])=>void;onImportDays:(days:OperatingImportEntry[],manualEdits:boolean,previous?:ImportReceipt[],reason?:string)=>Promise<ImportReceipt[]>;value:EditorValue;draftIdentity:OperatingDraftIdentity;busy:boolean;onDirty:()=>void;onSave:(rows:OperatingRow[],sharedAdSpend?:number|null)=>Promise<boolean>}){
 const {sheet,date,record,stores,currentStores,template}=value,fields=operatingFields(sheet,template);
 const storeRevenue=isStoreRevenueSheet(sheet,template);
 const [initial,setInitial]=useState(()=>record?.rows||emptyRows(sheet,stores,template));
 const [importAliases,setImportAliases]=useState<ReadonlyMap<string,string>>(()=>new Map());
 const [form,setForm]=useState<Record<string,Record<string,string>>>(()=>Object.fromEntries(initial.map(row=>[row.storeId,Object.fromEntries(fields.map(f=>[f.key,inputValue(row.values[f.key],f.kind)]))]))),[active,setActive]=useState(0),[error,setError]=useState(''),[pasting,setPasting]=useState(false),[source,setSource]=useState(''),[preview,setPreview]=useState<OperatingPastePreview|null>(null);
 const [importIndex,setImportIndex]=useState(0),[importReason,setImportReason]=useState('');
 const [targetEntry,setTargetEntry]=useState<OperatingImportEntry|null>(null);
 const [importDays,setImportDays]=useState<OperatingImportEntry[]>([]),[receipt,setReceipt]=useState<ImportReceipt[]>([]);
 const [fileNote,setFileNote]=useState(''),[touched,setTouched]=useState(false),[draftNotice,setDraftNotice]=useState('');
 const draftKey=operatingDraftKey(draftIdentity),schema=JSON.stringify(fields.map(f=>[f.key,f.label,f.kind,f.required])),baseVersion=record?.version||0;
 const importOnly=record?.status==='approved'||record?.status==='submitted';
 const [pendingDraft,setPendingDraft]=useState(()=>importOnly?null:readOperatingDraft(localDraftStorage,draftKey));
 const [mergingDraft,setMergingDraft]=useState(false);
 const needsDraftChoice=!!pendingDraft&&!mergingDraft;
 const expectedDraftRows=template?.dimension==='total'?[{id:'all',name:'全项目'}]:isPlatform(sheet)&&pendingDraft?.rows.length===1&&pendingDraft.rows[0].id==='all'?[{id:'all',name:'全平台'}]:record&&record.rows[0]?.storeId!=='all'?record.rows.map(r=>({id:r.storeId,name:r.storeName})):currentStores;
 const canRestore=!!pendingDraft&&pendingDraft.baseVersion===baseVersion&&pendingDraft.schema===schema&&operatingDraftRowsMatch(pendingDraft.rows,expectedDraftRows);
 const manualEdits=useRef(false);
 function invalidateImport(){setTargetEntry(null);setPreview(null);setImportDays([]);setReceipt([]);if(fileNote){setPasting(false);setSource('');}setFileNote('');}
 function onDirty(){setTouched(true);signalDirty();}
 useEffect(()=>{if(!touched||pendingDraft)return;const timer=setTimeout(()=>{const result=writeOperatingDraft(localDraftStorage,draftKey,{baseVersion,schema,rows:initial.map(r=>({id:r.storeId,name:r.storeName})),form,source});setDraftNotice(result.ok?'已保留本机草稿，按此设备与账号区分；尚未提交云端，7天后过期。':'本机草稿未能保留：'+result.error+'。请尽快保存云端草稿。');},350);return()=>clearTimeout(timer);},[touched,pendingDraft,initial,form,source,draftKey,baseVersion,schema]);
 function restoreDraft(){if(!pendingDraft||!canRestore)return;manualEdits.current=true;setInitial(pendingDraft.rows.map(r=>({storeId:r.id,storeName:r.name,values:{}})));setForm(pendingDraft.form);setSource(pendingDraft.source);setPasting(!!pendingDraft.source);setActive(0);setPendingDraft(null);onDirty();}
 function discardDraft(){removeOperatingDraft(localDraftStorage,draftKey);setPendingDraft(null);setDraftNotice('已清除此记录的本机草稿。');}

 const rows=initial.map(row=>({...row})),required=fields.filter(f=>f.required),optional=fields.filter(f=>!f.required),canPaste=true,store=rows[active],totalMode=rows.length===1&&rows[0].storeId==='all';
 function switchPlatform(total:boolean){if(total===totalMode)return;if(!window.confirm('切换录入方式将清空当前表单输入。保存后仍是同一天同一张日表，是否继续？'))return;invalidateImport();manualEdits.current=false;const next=emptyRows(sheet,currentStores,template,total);setInitial(next);setForm(Object.fromEntries(next.map(row=>[row.storeId,Object.fromEntries(fields.map(f=>[f.key,'']))])));setActive(0);setPreview(null);setSource('');setPasting(false);onDirty();}
 function update(storeId:string,key:string,text:string){manualEdits.current=true;setForm(current=>({...current,[storeId]:{...current[storeId],[key]:text}}));setError('');onDirty();}
 function readRows(pasted?:OperatingPastePreview){return validateOperatingRows(sheet,rows.map(row=>({storeId:row.storeId,storeName:row.storeName,values:Object.fromEntries(fields.map(field=>{const imported=pasted?.rows.find(r=>r.storeId===row.storeId);try{return[field.key,imported&&pasted?.columns.includes(field.key)?imported.values[field.key]:parseOperatingInput(form[row.storeId][field.key],field.kind)];}catch(e){throw Error(row.storeName+' / '+field.label+'：'+(e as Error).message);}}))})),rows.map(row=>({id:row.storeId,name:row.storeName})),false,template);}
 async function save(pasted?:OperatingPastePreview){if(needsDraftChoice||importOnly)return;setError('');try{
  const nextRows=readRows(pasted),issue=revenueDraftIssue(sheet,pasted?.rows??nextRows,template);
  if(issue){setError(issue);return;}
  const spend=pasted?.sharedAdSpend??(nextRows.some(r=>r.values.adSpend!=null)?null:record?.sharedAdSpend);if(sheet==='douyin-stores'&&record?.sharedAdSpend!=null&&spend===null&&!window.confirm('本次改为按门店记录消耗，保存后将使用门店消耗合计。是否继续？'))return;const saved=await onSave(nextRows,sheet==='douyin-stores'?spend:undefined);if(saved)removeOperatingDraft(localDraftStorage,draftKey);}catch(e){setError((e as Error).message);}}
 function download(){setError('');try{const text=blankOperatingTsv({sheet,date,template,stores:rows.map(r=>({id:r.storeId,name:r.storeName}))}),url=URL.createObjectURL(new Blob([text],{type:'text/tab-separated-values;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download='空白填报模板-'+sheetName(sheet,template).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,55)+'-'+date+'.tsv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}}
 function input(row:OperatingRow,field:Field){return <input aria-label={row.storeName+' '+field.label} autoComplete="off" type="text" inputMode={field.kind==='count'?'numeric':'decimal'} maxLength={24} placeholder="未填" value={form[row.storeId][field.key]} onChange={e=>update(row.storeId,field.key,e.target.value)}/>;}
 function matrix(group:Field[],label:string){return group.length>0&&<section className="op-input-group"><h4>{label}</h4><div className="op-table-scroll op-editor-matrix"><table className="op-table"><thead><tr><th>范围</th>{group.map(field=><th key={field.key}>{field.label}<small>{field.kind==='money'?'元':field.kind==='stars'?'0–5，最多1位小数':'非负整数'}</small></th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.storeId}><th scope="row">{row.storeName}</th>{group.map(field=><td key={field.key}>{input(row,field)}</td>)}</tr>)}</tbody></table></div></section>;}
 return <form className="op-form op-operating-editor" onSubmit={e=>{e.preventDefault();if(!pasting&&!importDays.length)save();}}>
  {pendingDraft&&<section className="op-local-draft" aria-label="发现本机草稿">
   <strong>发现此账号在本机保存的未提交内容</strong>
   <p>保存于 {time(new Date(pendingDraft.savedAt).toISOString())}。{canRestore?'恢复后可继续填写，或清除本机草稿以使用云端内容。':mergingDraft?'请对照本机草稿填写下方表格。云端保存成功前，此处保留原本机草稿。':'云端版本、模板或分行已变化。可手动合并到当前版本，或清除本机草稿以使用云端内容。'}</p>
   {!canRestore&&<details open={mergingDraft}><summary>查看本机草稿内容</summary><textarea readOnly rows={6} aria-label="待手动合并的本机草稿" value={Object.entries(pendingDraft.form).map(([row,values])=>row+': '+Object.entries(values).map(([key,v])=>key+'='+v).join('，')).join('\n')+(pendingDraft.source?'\n原粘贴内容：\n'+pendingDraft.source:'')}/></details>}
   {needsDraftChoice&&<div>{canRestore?<button type="button" className="op-button" onClick={restoreDraft}>恢复本机草稿</button>:<button type="button" className="op-button" onClick={()=>setMergingDraft(true)}>开始手动合并</button>}<button type="button" className="co-text" onClick={discardDraft}>清除这份本机草稿</button></div>}
  </section>}
  {sheet==='douyin-stores'&&record?.sharedAdSpend!=null&&<p className="op-note">全平台累计消耗 {(record.sharedAdSpend/100).toFixed(2)} 元，按全平台计一次。</p>}
  {draftNotice&&<p className="op-muted" role="status">{draftNotice}</p>}
  <fieldset disabled={busy||needsDraftChoice}>
  <div className="op-editor-intro"><p><strong>{sheet.endsWith('-stores')?range(date):sheet==='targets'?date.slice(0,7)+' 月目标':date+' 单日事实'}</strong><br/>金额填元，最多两位小数。数量填整数。空白留作“未填”，明确没有发生时才填 0。</p><div className="op-editor-buttons"><button type="button" className="op-button" onClick={download}><Download size={16}/>下载填报模板</button>{canPaste&&!importOnly&&<button type="button" className="op-button" onClick={()=>{invalidateImport();setPasting(!pasting);setError('');}}><ClipboardPaste size={17}/>{pasting?'返回手动填写':'从 Excel 粘贴'}</button>}</div></div>
  {isPlatform(sheet)&&<div className="op-platform-mode"><div role="group" aria-label="平台日录方式"><button type="button" className={!totalMode?'selected':''} onClick={()=>switchPlatform(false)}>按门店录入 · 自动多报表</button><button type="button" className={totalMode?'selected':''} onClick={()=>switchPlatform(true)}>只有平台总数</button></div><p>{totalMode?'只保存平台总盘。无法从总数分摊门店，累计门店明细需另补。':'各门店只填一次，自动汇总平台日总数、月初累计与门店周 / 月报。'}</p></div>}
  <details className="op-import-details" open={importOnly||undefined} onChangeCapture={invalidateImport}><summary>导入表格 / 识别截图</summary><OperatingSpreadsheetImport template={template} aliasScope={{companyId:draftIdentity.companyId,projectId:draftIdentity.projectId,sheet}} aliasStores={currentStores} onAliasesLoaded={setImportAliases} onSourceChange={invalidateImport} period={{date,sheet}} meituanDate={sheet==='meituan'&&totalMode?date:undefined} purpose="data" disabled={busy} revenueContext={storeRevenue||sheet==='targets'?{date,stores:rows.map(r=>({id:r.storeId,name:r.storeName}))}:undefined} onUse={(matrix,header,storeAliases,detected,targets)=>{const dates=detected??(importOnly?[date]:undefined);setTargetEntry(null);setImportDays([]);setReceipt([]);const inferredTotal=isBrandedPlatformTotal(matrix,header,sheet);const storeOptions=inferredTotal?[{id:'all',name:'全平台'}]:rows.map(r=>({id:r.storeId,name:r.storeName}));if(dates?.length&&(sheet==='targets'||!!targets||dates.length>1||dates[0]!==date||!!record||inferredTotal&&!totalMode)){
   const sourceRows=new Map(matrix.map((row,index)=>[row,index+1]));
   const groups=dates.length>1?groupSourceRows(matrix,header,new Set(dates),date):new Map<string,unknown[][]>();const items=dates.map(d=>{const opts={sheet,date:d,template,storeAliases,stores:storeOptions};const file=prepareOperatingFileRows(groups.get(d)??matrix,header,opts,sourceRows);const p=previewOperatingPaste(file.text,opts);const complete=emptyRows(sheet,storeOptions,template,totalMode).map(r=>p.rows.find(item=>item.storeId===r.storeId)||r);return {sheet,date:d,sharedAdSpend:file.sharedAdSpend,rows:complete,columns:p.columns,storeMatches:file.storeMatches};});
   if(targets&&storeRevenue&&targets.rows.some(r=>r.target!=null)){
    const targetsByStore=new Map(targets.rows.map(r=>[r.storeId,r.target]));
    setTargetEntry({sheet:'targets',date:targets.date,columns:['target'],rows:currentStores.map(store=>({
     storeId:store.id,storeName:store.name,values:{target:targetsByStore.get(store.id)??null}
    }))});
   }
   setSource('');setFileNote('');setImportIndex(0);setImportReason('');setImportDays(items);setPreview(null);setPasting(false);signalDirty();return;
  }const result=prepareOperatingFileRows(matrix,header,{sheet,date,template,storeAliases,stores:rows.map(r=>({id:r.storeId,name:r.storeName}))});setSource(result.text);setPreview({...previewOperatingPaste(result.text,{sheet,date,template,stores:rows.map(r=>({id:r.storeId,name:r.storeName}))}),sharedAdSpend:result.sharedAdSpend});setPasting(true);setError('');setFileNote('已读取所选日期 '+date+'。'+(result.storeMatches.length?'门店对应：'+result.storeMatches.map(s=>s.source+' → '+s.target).join('、')+'。':'')+(result.skippedOtherDates?'其他日期 '+result.skippedOtherDates+' 行未采用。':'')+(result.skippedSummaryRows?'已略过 '+result.skippedSummaryRows+' 行合计。':'')+(result.skippedNotes?'已略过 '+result.skippedNotes+' 行统计说明。':'')+(result.ignoredColumns.length?'本模板未采用的列：'+result.ignoredColumns.join('、')+'。':'')+'请核对下方预览，再保存草稿。');onDirty();}}/></details>
  {importDays.length>0&&<section className="op-note" aria-label="原表日期预览"><h3>{sheet==='targets'?importDays[0].date.slice(0,7)+' 门店月目标':'按原表日期保存 · '+importDays.length+' 天'}</h3>{sheet==='targets'?<p>仅保存下方各店当月目标。已有目标会先核对差异。</p>:<p>页面所选日期 {date}。每个业务日期各存一份草稿。已有记录先比对，有差异时列出旧值和新值，供你确认更新。{importDays.some(d=>d.date>todayShanghai())?'含晚于今天的日期，请核对年份。':''}</p>}{isPlatform(sheet)&&importDays.some(d=>d.columns.includes('verifiedAmount'))&&<p>原表核销金额 · {importDays[0].date} 至 {importDays.at(-1)?.date} · {yuan(totals(importDays.flatMap(d=>d.rows),fields.filter(f=>f.key==='verifiedAmount')).verifiedAmount)} 元（已填小计）</p>}{sheet!=='targets'&&<label>查看原表日期<select aria-label="查看原表日期" value={importIndex} onChange={e=>setImportIndex(Number(e.target.value))}>{importDays.map((d,i)=><option key={d.date} value={i}>{d.date}</option>)}</select></label>}{!!importDays[importIndex].storeMatches?.length&&<p>{importDays[importIndex].storeMatches?.map(s=>s.source+' → '+s.target).join('、')}</p>}<OperatingTable sheet={sheet} template={template} rows={importDays[importIndex].rows} sharedAdSpend={importDays[importIndex].sharedAdSpend}/>
   {targetEntry&&<section aria-label="原表月目标预览">
    <h4>{targetEntry.date.slice(0,7)} 门店月目标</h4>
    <OperatingTable sheet="targets" rows={targetEntry.rows}/>
    <p>{targetImportIssue?targetImportIssue+'本次只保存日业绩。':'同一月份只保存一份月目标。空白门店保留已有目标。'}</p>
   </section>}
   <button type="button" className="co-primary" disabled={busy||receipt.length>0&&receipt.every(r=>importDayComplete(r)||r.outcome==='skipped')||receipt.some(r=>r.approved)&&!importReason.trim()} onClick={async()=>{
    setError('');
    try{
     const entries=targetEntry?[...importDays,{...targetEntry,skipReason:targetImportIssue||undefined}]:importDays;
     setReceipt(await onImportDays(entries,manualEdits.current,receipt,importReason.trim()));
    }catch(e){setError((e as Error).message);}
   }}>{receipt.some(r=>r.outcome==='review')?'确认按差异更新草稿':receipt.some(r=>r.outcome==='errors'||r.outcome==='pending')?'重新核对并继续保存':targetEntry&&!targetImportIssue?'确认保存业绩和月目标草稿':sheet==='targets'?'确认保存月目标草稿':'确认按原日期保存草稿'}</button>
   {receipt.some(r=>r.approved)&&<label>已确认数据的更正原因<input value={importReason} maxLength={1000} onChange={e=>setImportReason(e.target.value)} placeholder="例如：按美团原表修正截图误读"/></label>}
   {receipt.some(r=>r.outcome==='review')&&<p>只替换新表中有数值的字段，空白保留原值。更正已确认数据后，领导继续看上次确认版，直至本次更正通过。</p>}
   {!!receipt.length&&<OperatingImportOutcome receipts={receipt} onView={onViewSaved} onSubmit={onSubmitImported}/>}
  </section>}
  {fileNote&&<p className="op-note" role="status">{fileNote}</p>}
  {importDays.length||importOnly?null:pasting?<div className="op-paste"><label>复制表头与数据，粘贴到这里<textarea aria-label="Excel 门店表格" rows={7} spellCheck={false} value={source} placeholder={(totalMode?'范围':'门店')+'\t'+fields.map(f=>f.label).join('\t')+'\n'+(rows[0]?.storeName||'名称')+'\t…'} onChange={e=>{manualEdits.current=true;setFileNote('');setSource(e.target.value);setPreview(null);setError('');onDirty();}}/></label><p className="op-muted">首列为“门店”或“范围”，其余表头与本表字段一致。支持制表符文本，金额单位元。标题若带日期须与本期一致。请复制计算后的数值。</p><button type="button" className="op-button" disabled={!source.trim()} onClick={()=>{setError('');try{setPreview(previewOperatingPaste(source,{sheet,date,template,storeAliases:importAliases,stores:rows.map(r=>({id:r.storeId,name:r.storeName}))}));onDirty();}catch(e){setPreview(null);setError((e as Error).message);}}}><ClipboardPaste size={16}/>解析并预览</button>{preview&&<div className="op-paste-preview"><h4>保存前核对预览</h4><p><strong>{sheet.endsWith('-stores')?range(date):date}</strong> · 匹配 {preview.rows.length} 行，{preview.columns.length} 个字段</p>{preview.missingStores.length>0&&<p className="op-note">未粘贴行：{preview.missingStores.join('、')}。这些行保留表单当前内容；仍未填的字段继续留空。</p>}{!!preview.ignoredColumns?.length&&<p className="op-note">已忽略源表计算列：{preview.ignoredColumns.join('、')}。这些指标将使用本次原始字段重新计算，不保存源表公式或计算值。</p>}{!!preview.skippedSummaryRows&&<p className="op-note">已跳过 {preview.skippedSummaryRows} 行合计 / 总计；只导入实际门店或分行，避免重复累计。</p>}<OperatingTable sheet={sheet} rows={preview.rows} sharedAdSpend={preview.sharedAdSpend} template={template}/><p className="op-muted">本次只覆盖预览中的行与列。保存后仍是草稿，不会直接进入领导汇总。</p><button type="button" className="co-primary" onClick={()=>save(preview)}><Save size={17}/>确认预览并保存草稿</button></div>}</div>:<>
   {rows.length>1&&<div className="op-mobile-store-switch"><label>当前编辑门店<select aria-label="当前编辑门店" value={active} onChange={e=>setActive(Number(e.target.value))}>{rows.map((row,index)=><option value={index} key={row.storeId}>{index+1}. {row.storeName}</option>)}</select></label><div><button type="button" className="op-button" aria-label="上一家门店" disabled={active===0} onClick={()=>setActive(n=>n-1)}><ArrowLeft size={17}/></button><span>{active+1} / {rows.length}</span><button type="button" className="op-button" aria-label="下一家门店" disabled={active===rows.length-1} onClick={()=>setActive(n=>n+1)}><ArrowRight size={17}/></button></div></div>}
   {matrix(required,sheet==='targets'?'月目标':sheet==='revenue'?'门店总业绩':template?'本次汇报 · 提交前必填':'财务与券量 · 提交前必填')}{matrix(optional,template?'选填项 · 空白不自动置0':'流量 / 评价 · 可选，不填不自动置0')}
   {store&&<div className="op-mobile-fields"><h4>{store.storeName}</h4>{[required,optional].map((group,index)=>group.length>0&&<section key={index} data-optional={index===1}><p>{index===0?'提交前必填':'可选字段'}</p><div>{group.map(field=><label key={field.key}><span>{field.label}</span><small>{field.kind==='money'?'元':field.kind==='stars'?'0–5，最多1位小数':'整数'}</small>{input(store,field)}</label>)}</div></section>)}</div>}
  </>}
  {error&&<p className="co-error" role="alert">{error}</p>}
  <div className="op-form-footer"><p>{record?'当前 V'+record.version+' · ':''}{storeRevenue?'手动填写至少一家门店的业绩即可保存草稿。使用截图时，请在识别预览里核对金额后保存。':'可先保存未填完整的草稿。'}全部必填项补齐后再提交确认。{sheet==='meituan-stores'?' 好评率按新增好评 / 核销券数计算，星级不平均。':''}</p>{!importOnly&&!pasting&&!importDays.length&&<button className="co-primary" disabled={storeRevenue&&!rows.some(r=>form[r.storeId]?.revenue?.trim())}><Save size={17}/>{busy?'正在保存…':'保存草稿'}</button>}</div>
 </fieldset></form>;
}
