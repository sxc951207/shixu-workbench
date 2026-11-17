'use client';
import React,{useEffect,useId,useState} from 'react';
import {CalendarDays,RefreshCw,ArrowRight} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import {addDays} from '../lib/workbench/productivity';
import {todayShanghai} from '../lib/workbench/domain';
import {defaultRevenueNote,isStoreRevenueSheet,operatingFields} from '../lib/workbench/operating-data';
import {formatOperatingInput} from '../lib/workbench/operating-paste';
import {operatingFieldDefinition} from '../lib/workbench/operating-field-dictionary';
import {companyDayRevenueSummary,companyPeriodRevenueSummary,loadCompanyDayOverview,meetingPeriod,type CompanyDayOverviewData,type CompanyDayProject,type CompanyDayRequest,type MeetingMode} from '../lib/workbench/company-day-overview';
import type {OperatingField,OperatingRecord} from '../cloud/company/operating-model';
import '../app/company-day-overview.css';

export type MeetingViewContext={
 mode:MeetingMode;custom:string;projects:Record<string,boolean>;drillDates:Record<string,string>;sheets:Record<string,boolean>;
};
export type MeetingViewProps={viewCache?:Map<string,MeetingViewContext>;viewKey?:string};
type Props=MeetingViewProps&{companyId:string;revision:number;paused?:boolean;request?:CompanyDayRequest};
const primaryModes=[['yesterday','昨天'],['lastWeek','上周'],['lastMonth','上月']] as const;
const otherModes=[['today','今天'],['lastWeekDay','上周同日'],['thisWeek','本周（截至昨天）'],['thisMonth','本月（截至昨天）'],['custom','自选日期']] as const;
const periodText=(start:string,end:string)=>start===end?start:start+' 至 '+end;
type LoadState={key:string;request:CompanyDayRequest;busy:boolean;data:CompanyDayOverviewData|null;error:string};
const sheetNames:Record<string,string>={revenue:'门店总业绩',meituan:'美团平台日录',douyin:'抖音平台日录'};
const revenueField=operatingFields('revenue')[0];
const confirmationTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'});
const unit=(field:OperatingField)=>field.kind==='money'?'元':field.kind==='stars'?'星':'数量';
function display(value:number|null|undefined,field:OperatingField){
 if(value==null)return'—';
 if(field.kind==='money'){const [yuan,cents]=formatOperatingInput(value,'money').split('.');return BigInt(yuan).toLocaleString('zh-CN')+'.'+cents;}
 return value.toLocaleString('zh-CN',{minimumFractionDigits:field.kind==='stars'?1:0,maximumFractionDigits:field.kind==='stars'?1:0});
}

function RecentBusinessDay({companyId,before,revision,request,onFound}:{
 companyId:string;before:string;revision:number;request:CompanyDayRequest;
 onFound:(date:string,project?:string)=>void;
}){
 const [searching,setSearching]=useState(false),[message,setMessage]=useState('');
 const onFoundRef=React.useRef(onFound);
 React.useLayoutEffect(()=>{onFoundRef.current=onFound;},[onFound]);
 useEffect(()=>{
  if(!searching)return;
  let active=true;
  const start=[addDays(before,-30),'1970-01-01'].sort()[1],end=addDays(before,-1);
  async function find(){
   try{
    const data=await loadCompanyDayOverview(request,{companyId,start,date:end,minimumRevision:revision});
    if(!active)return;
    let latest='';
    for(const project of data.projects)for(const record of project.records)if(record.date>latest)latest=record.date;
    if(latest){
     const matching=data.projects.filter(project=>project.records.some(record=>record.date===latest));
     onFoundRef.current(latest,matching.length===1?matching[0].id:undefined);
    }else setMessage(start+' 至 '+end+' 没有已确认的经营日表，可在「更多日期」选择更早的日期。');
   }catch(cause){if(active)setMessage('查找失败。'+(cause instanceof Error?cause.message:'请稍后重试。'));}
   finally{if(active)setSearching(false);}
  }
  void find();
  return ()=>{active=false;};
 },[searching,companyId,before,revision,request]);
 if(before<='1970-01-01')return null;
 return <div className="co-day-find"><button type="button" className="co-primary" disabled={searching} onClick={()=>{setMessage('');setSearching(true);}}>
  {searching?'正在查找…':'查找最近有数据的一天'}<ArrowRight size={16} aria-hidden="true"/></button>
  <small role="status">{message||'在所选时段之前的 30 天内查找已确认日表'}</small></div>;
}

export default function CompanyDayOverview(props:Props){return <CompanyDayOverviewContent key={props.viewKey??props.companyId} {...props}/>;}

function CompanyDayOverviewContent({companyId,revision,paused=false,request=companyRequest,viewCache,viewKey=companyId}:Props){
 const today=todayShanghai(),heading=useId();
 const [view,setView]=useState<MeetingViewContext>(()=>viewCache?.get(viewKey)??{mode:'yesterday',custom:meetingPeriod('yesterday',today)!.end,projects:{},drillDates:{},sheets:{}});
 const [state,setState]=useState<LoadState|null>(null),[retry,setRetry]=useState(0);
 const selected=meetingPeriod(view.mode,today,view.custom),start=selected?.start,end=selected?.end;
 const key=JSON.stringify([companyId,start,end,revision,retry]),current=state?.key===key&&state.request===request?state:null;
 const busy=!paused&&!!selected&&(!current||current.busy),data=paused?null:current?.data;
 const rangeMode=['lastWeek','thisWeek','lastMonth','thisMonth'].includes(view.mode);
 useEffect(()=>{viewCache?.set(viewKey,view);},[viewCache,viewKey,view]);
 useEffect(()=>{
  if(paused||!start||!end)return;
  let active=true;
  setState({key,request,busy:true,data:null,error:''});
  loadCompanyDayOverview(request,{companyId,date:end,...(start!==end?{start}:{}),minimumRevision:revision}).then(
   data=>{if(active)setState({key,request,busy:false,data,error:''});},
   cause=>{if(active)setState({key,request,busy:false,data:null,error:cause instanceof Error?cause.message:'数据未完整读取，请重试'});}
  );
  return()=>{active=false;};
 },[key,request,companyId,revision,paused,start,end]);
 function choose(mode:MeetingMode){setView(previous=>({...previous,mode}));}
 const results=data?.projects.filter(project=>project.records.length).length??0;
 return <section className="co-day-overview" aria-labelledby={heading} aria-busy={busy}>
  <div className="co-day-heading"><h2 id={heading}><CalendarDays size={20} aria-hidden="true"/>各项目经营数据</h2></div>
  <div className="co-day-controls">
   <div className="co-day-shortcuts" role="group" aria-label="会议常用时段">{primaryModes.map(([mode,label])=><button type="button" key={mode} aria-pressed={view.mode===mode} onClick={()=>choose(mode)}>{label}</button>)}</div>
   <select className="co-day-more" aria-label="其他业务时段" value={otherModes.some(([mode])=>mode===view.mode)?view.mode:''} onChange={event=>choose(event.target.value as MeetingMode)}><option value="" disabled>更多日期</option>{otherModes.map(([mode,label])=><option key={mode} value={mode}>{label}</option>)}</select>
   {view.mode==='custom'&&<label>业务日期<input type="date" min="1970-01-01" max={today} value={view.custom} onChange={event=>{const custom=event.currentTarget.value;setView(previous=>({...previous,custom}));}}/></label>}
  </div>
  {selected&&<p className="co-day-result-heading" role="status"><strong>{periodText(selected.start,selected.end)}</strong>{data&&results>0&&<> · {results}/{data.projects.length} 个项目有已确认日表</>}</p>}
  {paused?<p className="co-day-status" role="status">暂时无法核对公司版本。请在更正动态中重试。</p>:!selected?<p className="co-day-status" role="status">{view.mode==='custom'?'请选择今天或更早的有效日期。':'本期刚开始，截至昨天还没有本期业务日。'}</p>:busy?<p className="co-day-status" role="status">正在读取各项目的已确认记录…</p>:current?.error&&<div className="co-day-error" role="alert"><p>{current.error}</p><button type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={14}/>重新读取</button></div>}
  {data&&selected&&<div className="co-day-results">
   {!data.projects.length&&<p className="co-day-status">当前公司没有可查看的项目。</p>}
   {!!data.projects.length&&results===0&&<div className="co-day-next-action">
    <strong>{data.projects.length===1?data.projects[0].name+' · ':''}这段时间暂无已确认的经营日表</strong>
    {data.projects.some(project=>project.enabled)?<RecentBusinessDay key={key} request={request} companyId={companyId} before={selected.start} revision={revision}
      onFound={(custom,project)=>setView(previous=>({...previous,mode:'custom',custom,projects:project?{[project]:true}:{}}))}/>:<p>当前可查看的项目尚未配置经营填报。</p>}
   </div>}
   {results>0&&data.projects.map(project=>{
    if(!project.records.length)return <div className="co-day-project co-day-project-empty" key={project.id}><strong>{project.name}</strong><span>{project.enabled?'所选时段无已确认记录':'未配置经营填报'}</span></div>;
    const open=!!view.projects[project.id];
    const dates=[...new Set(project.records.map(record=>record.date))].sort().reverse();
    const day=dates.includes(view.drillDates[project.id])?view.drillDates[project.id]:dates[0];
    return <details className="co-day-project" key={project.id} open={open} onToggle={event=>{
     if(event.target!==event.currentTarget)return;
     const next=event.currentTarget.open;
     setView(previous=>!!previous.projects[project.id]===next?previous:{...previous,projects:{...previous.projects,[project.id]:next}});
    }}>
     <summary><div className="co-day-project-title"><strong>{project.name}</strong><span>{dates.length} 天有记录 · {project.records.length} 张日表</span></div>
      <ProjectRevenue project={project} period={selected} rangeMode={rangeMode}/><span className="co-day-expand">{open?'收起明细':'查看经营明细'}{!open&&<ArrowRight size={14} aria-hidden="true"/>}</span></summary>
     {open&&<div className="co-day-project-body">
      {rangeMode&&<label className="co-day-drill">查看已确认日表<select className="co-day-drill-date" value={day} onChange={event=>{const value=event.target.value;setView(previous=>({...previous,drillDates:{...previous.drillDates,[project.id]:value}}));}}>{dates.map(date=><option key={date}>{date}</option>)}</select></label>}
      {project.records.some(record=>isStoreRevenueSheet(record.sheet,record.template)&&record.date===day)&&<p className="co-muted">项目业绩口径：{project.revenueNote||defaultRevenueNote}</p>}
      {project.records.filter(record=>record.date===day).map(record=><DailyTable key={record.id} record={record} open={view.sheets[record.id]??isStoreRevenueSheet(record.sheet,record.template)} onToggle={next=>setView(previous=>(previous.sheets[record.id]??isStoreRevenueSheet(record.sheet,record.template))===next?previous:{...previous,sheets:{...previous.sheets,[record.id]:next}})}/>)}
      {!!project.pendingChanges&&<p className="co-day-method">{project.pendingPeriod==='day'?'当天':project.pendingPeriod==='range'?'所选时段':'所查月份'}有 {project.pendingChanges} 条记录正在更正，展示上次确认版。</p>}
     </div>}
    </details>;
   })}
  </div>}
  <details className="co-day-definition"><summary>统计口径与缺报说明</summary><p className="co-day-method">总业绩只加总所选业务日已确认的门店总业绩。缺报或部分金额未填时显示已填小计。平台日表单列，月目标与累计快照可在数据报表查看。“—”表示未提供，0 表示确认金额为零。</p></details>
 </section>;
}

function ProjectRevenue({project,period,rangeMode}:{project:CompanyDayProject;period:{start:string;end:string};rangeMode:boolean}){
 const summary=companyPeriodRevenueSummary(project.records,period);
 if(!summary.reportedDays)return <div className="co-day-revenue"><small>总业绩</small><strong>—</strong><small>{summary.sourceIssue||'无已确认总业绩'}</small></div>;
 const daily=rangeMode?null:companyDayRevenueSummary(project.records);
 const reason=daily?.reason||(summary.overflow?'金额合计超出安全范围':summary.unknownRows?summary.unknownRows+' 行未提供金额':'');
 return <div className="co-day-revenue"><small>{summary.complete?'总业绩合计':summary.amount!==null?'总业绩 · 已填小计':'总业绩'}</small><strong>{summary.amount===null?'—':display(summary.amount,revenueField)+' 元'}</strong>{rangeMode&&<small>业绩已报 {summary.reportedDays}/{summary.expectedDays} 天</small>}{summary.scopeChanged&&<small>期间门店范围有变化</small>}{reason&&<small>{reason}</small>}</div>;
}

function DailyTable({record,open,onToggle}:{record:OperatingRecord;open:boolean;onToggle:(open:boolean)=>void}){
 const fields=operatingFields(record.sheet,record.template),name=record.template?.name||sheetNames[record.sheet]||'自定义日记录';
 return <details className="co-day-sheet" open={open} onToggle={event=>onToggle(event.currentTarget.open)}>
  <summary><strong>{name}</strong><span>已确认 · V{record.version}</span></summary>
  <p className="co-day-method">{record.reviewerName&&<>确认人 {record.reviewerName} · </>}确认于 <time dateTime={record.updatedAt}>{confirmationTime.format(new Date(record.updatedAt))}</time></p>
  {record.template?.description&&<p className="co-day-method">{record.template.description}</p>}
  <div className="co-day-table-scroll" role="region" aria-label={record.projectName+' '+name+' '+record.date+'单日明细'} tabIndex={0}>
   <table><caption><span>{record.date} · {name} · 单日事实</span></caption><thead><tr><th scope="col">门店 / 明细项</th>{fields.map(field=><th scope="col" key={field.key} title={field.definition||operatingFieldDefinition(field)}>{field.label}<small>（{unit(field)}）</small></th>)}</tr></thead>
    <tbody>{record.rows.map(row=><tr key={row.storeId}><th scope="row">{row.storeName}</th>{fields.map(field=><td key={field.key}>{display(row.values[field.key],field)}</td>)}</tr>)}</tbody>
   </table>
  </div>
 </details>;
}
