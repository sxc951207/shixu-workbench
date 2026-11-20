'use client';
import React,{useEffect,useId,useRef,useState}from'react';
import {ArrowRight, Undo2, CalendarDays, ChartColumn, CheckCheck, ChevronDown, ClipboardCheck, FileText, FolderKanban, ListFilter, ListRestart, RefreshCw, Settings2} from 'lucide-react';
import {approvalDescription} from '../lib/workbench/approval-display';
import {companyRequest as api} from '../cloud/company-root';
import {groupReviewSubmissions,type CompanyReviewFilter,type CompanyReviewItem,type CompanyReviewPage,type ReviewConfigurationProject}from'../lib/workbench/company-review';
import CompanyLightRibbon from './company-light-ribbon';
import DailyQueueReview from './daily-queue-review';
import SupervisorDailyRoster from './supervisor-daily-roster';
import ReviewPriorities from './review-priorities';
import'../app/company-review.css';
const labels={project:'项目进度',operating:'经营数字',daily:'员工日报',weekly:'文字周报',monthly:'文字月报'};
const taskIcons={project:FolderKanban,operating:ChartColumn,daily:FileText,weekly:FileText,monthly:FileText};
const sheets:Record<string,string>={revenue:'门店总业绩',targets:'月目标',meituan:'美团日录',douyin:'抖音日录','meituan-stores':'美团门店累计','douyin-stores':'抖音门店累计'};
function itemPeriod(item:CompanyReviewItem){return item.type==='weekly'||item.type==='monthly'?item.start+' 至 '+item.end:item.sheet?.endsWith('-stores')?item.date.slice(0,7)+'-01 至 '+item.date:item.date;}
function priorityDescription(item:CompanyReviewItem){
 const kind=item.type==='operating'?(item.name||sheets[item.sheet||'']||labels.operating):labels[item.type];
 return [item.projectName,kind,itemPeriod(item),item.submittedName||item.submittedBy].filter(Boolean).join(' · ');
}
function ConfigurationProjects({projects,disabled,onOpen}:{projects:ReviewConfigurationProject[];disabled:boolean;onOpen:(project:ReviewConfigurationProject)=>void}){
 return <section className="cr-setup" aria-label="我负责确认的项目"><h2>我负责确认的项目</h2>
  {!projects.length?<p className="co-muted">尚未分配负责确认的项目，请联系管理员核对项目人员。</p>:<div className="cr-projects">
   {projects.map(project=><article key={project.id}><div><strong>{project.name}</strong><small>{project.configured?'已配置经营模板':'尚未配置经营模板'}{project.pendingIndicatorProposal?' · 指标方案待确认':''}</small></div>
    {project.pendingIndicatorProposal
     ? <button type="button" className="co-text" disabled={disabled} aria-label={'核对 '+project.name+' 的指标方案'} onClick={()=>onOpen(project)}><ClipboardCheck size={15}/>核对指标方案</button>
     : <button type="button" className="co-text" disabled={disabled} onClick={()=>onOpen(project)}><Settings2 size={15}/>{project.configured?'配置模板':'开始配置模板'}</button>}
   </article>)}
  </div>}
 </section>;
}
export function SupervisorProjectSetup({companyId,revision,disabled,onOpen}:{companyId:string;revision:number;disabled:boolean;onOpen:(project:ReviewConfigurationProject)=>void}){
 const [projects,setProjects]=useState<ReviewConfigurationProject[]|null>(null);
 const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let live=true;
  setProjects(null);
  setError('');
  void api({action:'review.projects',companyId})
   .then(result=>{if(live)setProjects(result.projects);})
   .catch(cause=>{if(live)setError(cause instanceof Error&&cause.message?cause.message:'未能读取负责确认的项目');});
  return()=>{live=false;};
 },[companyId,revision,attempt]);
 if(error)return <div className="cr-setup">
  <p className="co-error" role="alert">项目配置入口读取失败：{error}</p>
  <button type="button" className="co-text" disabled={disabled} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={15} aria-hidden="true"/>重新读取项目</button>
 </div>;
 return projects?<ConfigurationProjects projects={projects} disabled={disabled} onOpen={onOpen}/>:<p className="co-muted" role="status">正在读取负责确认的项目…</p>;
}
export default function CompanyReviewQueue({companyId,revision,disabled,showConfiguration,allowRoster=showConfiguration,onRevision,onPick,onConfigure}:{companyId:string;revision:number;disabled:boolean;showConfiguration:boolean;allowRoster?:boolean;onRevision?:(n:number)=>void;onPick:(item:CompanyReviewItem)=>void;onConfigure:(project:ReviewConfigurationProject)=>void}){
 const[filter,setFilter]=useState<CompanyReviewFilter>({type:'all',projectId:'',month:''}),[projects,setProjects]=useState<ReviewConfigurationProject[]|null>(null),[projectError,setProjectError]=useState(''),[items,setItems]=useState<CompanyReviewItem[]>([]),[page,setPage]=useState<CompanyReviewPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');const sequence=useRef(0),mounted=useRef(true);
 const [filtersOpen,setFiltersOpen]=useState(false),[refreshKey,setRefreshKey]=useState(0);
 const [daily,setDaily]=useState<CompanyReviewItem|null>(null),[roster,setRoster]=useState(false),[name,setName]=useState(''),[notice,setNotice]=useState<{name:string;returned:boolean;next?:string}|null>(null);
 const [rosterRevision,setRosterRevision]=useState(0);
 const [dueOnly,setDueOnly]=useState(false);
 const openedRevision=useRef(revision),listRevision=daily?openedRevision.current:revision;
 const lastReviewRevision=useRef(0),listY=useRef<number|null>(null),restorePosition=useRef(false);
 useEffect(()=>{if(daily||loading||!restorePosition.current||listY.current===null)return;const y=listY.current;const frame=requestAnimationFrame(()=>{window.scrollTo(0,y);restorePosition.current=false;listY.current=null;});return()=>cancelAnimationFrame(frame);},[daily,loading,items]);
 function closeReview(){restorePosition.current=true;setDaily(null);if(lastReviewRevision.current){onRevision?.(lastReviewRevision.current);lastReviewRevision.current=0;setRefreshKey(n=>n+1);}}
 const dailyRows=items.filter(item=>item.type==='daily');
 const nextDaily=daily?dailyRows[dailyRows.findIndex(row=>row.id===daily.id)+1]:undefined;
 const hasNext=!!daily&&!roster&&dailyRows.some(row=>row.id===daily.id)&&!!nextDaily;
 function openItem(item:CompanyReviewItem){if(item.type==='daily'){openedRevision.current=revision;listY.current=window.scrollY;setDaily(item);setNotice(null);}else onPick(item);}
 function finish(revision:number,advance:boolean,returned:boolean,next?:string){
  setItems(rows=>rows.filter(row=>row.id!==daily?.id));setRosterRevision(revision);lastReviewRevision.current=revision;
  setNotice({name:daily?.submittedName||daily?.submittedBy||'员工',returned,next});
  if(advance&&hasNext){setDaily(nextDaily!);return;}
  closeReview();
 }
 const filterPanelId=useId(),projectCompany=useRef(''),lastListKey=useRef('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++sequence.current;};},[]);
 useEffect(()=>{let live=true;if(projectCompany.current!==companyId){setProjects(null);projectCompany.current=companyId;}setProjectError('');void api({action:'review.projects',companyId}).then(result=>{if(live)setProjects(result.projects);}).catch(e=>{if(live){setProjects([]);setProjectError(e.message);}});return()=>{live=false;};},[companyId,listRevision,refreshKey]);
 async function read(append=false){const seq=++sequence.current;setLoading(true);setError('');const listKey=JSON.stringify([companyId,filter]);if(!append&&listKey!==lastListKey.current){setItems([]);setPage(null);lastListKey.current=listKey;}try{const result:CompanyReviewPage=await api({action:'review.list',companyId,...filter,...(append&&page?.nextCursor?{cursor:page.nextCursor,revision:page.companyRevision}:{})});if(!mounted.current||seq!==sequence.current)return;setItems(previous=>append?[...new Map([...previous,...result.items].map(item=>[item.type+':'+item.id,item])).values()]:result.items);setPage(result);}catch(e){if(mounted.current&&seq===sequence.current)setError((e as Error).message);}finally{if(mounted.current&&seq===sequence.current)setLoading(false);}}
 useEffect(()=>{void read();return()=>{++sequence.current;};},[companyId,listRevision,filter.type,filter.projectId,filter.month,filter.search,refreshKey]);
 const groups=[{title:'项目进度',types:['project']},{title:'经营数字',types:['operating']},{title:'文字汇报',types:['daily','weekly','monthly']}],complete=!!page&&!page.nextCursor;
 const selectedProject=projects?.find(project=>project.id===filter.projectId);
 const pendingProjects=filter.type==='all'&&!filter.month
  ? (projects||[]).filter(project=>project.pendingIndicatorProposal&&(!filter.projectId||project.id===filter.projectId))
  : [];
 const resultCount=items.length+pendingProjects.length;
 const projectListReady=projects!==null&&!projectError;
 const filterSummary=[
  filter.type==='all'?'':labels[filter.type],
  filter.projectId?(selectedProject?.name||'已选项目'):'',
  filter.month,filter.search,
 ].filter(Boolean).join(' · ')||'全部';
 return <><section className="cr-queue" aria-label="待确认事项">
  <header className="cr-inbox-head"><CompanyLightRibbon/>
   <div><h1>待我确认</h1><p>{roster?'按日查看团队提交情况':filterSummary==='全部'?'全部已授权项目':filterSummary}</p></div>
   {!roster&&<div className="cr-inbox-total" role="status"><span>{complete?'待处理':'已读待处理'}</span><strong key={resultCount}>{page&&projectListReady&&!error&&!loading?resultCount:'—'}</strong></div>}
  </header>
  {allowRoster&&!roster&&filterSummary==='全部'&&<ReviewPriorities companyId={companyId} revision={listRevision} refreshKey={refreshKey} items={items} complete={complete} ready={!!page&&!error&&!loading} failed={!!error} disabled={disabled||loading} describe={priorityDescription} onPick={openItem} onRoster={()=>{setDueOnly(true);setRoster(true);}}/>}
  <div className="cr-toolbar">
   {allowRoster&&<div className="cr-modes"><button type="button" aria-pressed={!roster} onClick={()=>setRoster(false)}>待我处理</button><button type="button" aria-pressed={roster} onClick={()=>{if(!roster){setDueOnly(false);setRoster(true);}}}>按天看团队日报</button></div>}
   <button type="button" className="co-text" aria-label="刷新待确认" disabled={disabled||loading||projects===null} onClick={()=>setRefreshKey(n=>n+1)}>
    <RefreshCw size={15} aria-hidden="true"/>刷新
   </button>
  </div>
  {notice&&<p role="status" className="cr-receipt" data-returned={notice.returned}>{notice.returned?<Undo2 size={16} aria-hidden="true"/>:<CheckCheck size={16} className="sx-approved-icon" aria-hidden="true"/>}{notice.name}的日报{notice.returned?'已退回补充':notice.next?'本步已确认。'+notice.next:'已确认'}。</p>}
  {roster?<SupervisorDailyRoster initialDueOnly={dueOnly} companyId={companyId} revision={Math.max(revision,rosterRevision,0)+refreshKey} onRevision={onRevision} onPick={openItem}/>:<>
  <button type="button" className="cr-filter-toggle" aria-expanded={filtersOpen} aria-controls={filterPanelId} onClick={()=>setFiltersOpen(open=>!open)}>
   <ListFilter size={16} aria-hidden="true"/><strong>筛选待审</strong>
   <span>{filterSummary}</span><ChevronDown size={16} aria-hidden="true"/>
  </button>
  <div id={filterPanelId} className="cr-filter-panel" data-expanded={filtersOpen}>
   <div className="cr-filters">
    <label>类型
     <select aria-label="待确认类型" disabled={disabled||loading} value={filter.type} onChange={e=>setFilter(old=>({...old,type:e.target.value as CompanyReviewFilter['type'],search:e.target.value==='daily'?name.trim():''}))}>
      <option value="all">全部类型</option>
      {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select>
    </label>
    <label>项目
     <select aria-label="待确认项目" disabled={disabled||loading||!projectListReady} value={filter.projectId} onChange={e=>setFilter(old=>({...old,projectId:e.target.value}))}>
      <option value="">全部已授权项目</option>
      {projects?.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
     </select>
    </label>
    <label>月份
     <input type="month" aria-label="待确认月份" value={filter.month} disabled={disabled||loading} onChange={e=>setFilter(old=>({...old,month:e.target.value}))}/>
    </label>
    {filter.type==='daily'&&<form className="cr-person-search" onSubmit={e=>{e.preventDefault();setFilter(old=>({...old,search:name.trim()}));}}><label>提交人<input type="search" value={name} maxLength={80} placeholder="姓名或登录名" onChange={e=>{setName(e.target.value);if(!e.target.value)setFilter(old=>({...old,search:''}));}}/></label><button className="co-text">查找</button></form>}
    {filter.month&&<button type="button" className="co-text" disabled={disabled||loading} onClick={()=>setFilter(old=>({...old,month:''}))}>不限月份</button>}
   </div>
   <details className="cr-period-note"><summary>筛选口径</summary><p>项目进度按提交月，经营数字按业务月，文字周月报按周期开始月。月份留空可查全部期间。</p></details>
  </div>
  {projectError&&<p className="co-error" role="alert">项目和待确认指标方案读取失败：{projectError}</p>}{error&&<p className="co-error" role="alert">{error}。已读取列表可能有变化，请刷新后重新核对。</p>}
  {(loading||projects===null)&&<p className="co-muted" role="status">{page?'正在继续查找待确认记录…':'正在读取待确认记录…'}</p>}
  {page&&projectListReady&&!error&&<p className="cr-count" role="status" data-complete={complete}>
   {complete?<CheckCheck size={15} aria-hidden="true"/>:<ListRestart size={15} aria-hidden="true"/>}
   <span>{complete?'当前筛选范围已读取完整':'尚有期间或记录未读取'}</span>
  </p>}
  <div className="cr-groups">
   {pendingProjects.length>0&&<section>
    <h3>指标方案<small>{pendingProjects.length} 条待确认</small></h3>
    <div className="cr-items">{pendingProjects.map(project=><button key={project.id} type="button" disabled={disabled||loading} aria-label={'核对 '+project.name+' 的指标方案'} onClick={()=>onConfigure(project)}>
     <span className="cr-kind-icon" aria-hidden="true"><ClipboardCheck size={19}/></span>
     <span className="cr-item-body"><strong>{project.name}</strong><span className="cr-item-kind">填报指标方案</span></span>
     <span className="cr-open">核对<ArrowRight size={16} aria-hidden="true"/></span>
    </button>)}</div>
   </section>}
   {groups.map(group=>{
   const rows=items.filter(item=>group.types.includes(item.type));
   if(!rows.length)return null;
   return <section key={group.title}>
    <h3>{group.title}<small>{rows.length} 条已读取</small></h3>
    <div className="cr-items">{groupReviewSubmissions(rows).map(submissionGroup=>{
     const item=submissionGroup.items[0];
     const sheetName=item.type==='operating'?(item.name||sheets[item.sheet||'']||item.sheet):undefined;
     if(submissionGroup.batch)return <section key={submissionGroup.key} className="cr-operating-batch" aria-label={item.projectName+' '+sheetName+' 同批提交'}>
      <header><strong>{item.projectName} · {sheetName}</strong><small>同批提交 · {item.submittedBy} · 当前已读取 {submissionGroup.items.length} 天待核对</small></header>
      <div className="cr-batch-dates">{submissionGroup.items.map(day=><button key={day.id} type="button" disabled={disabled||loading}
       aria-label={'核对 '+day.projectName+' '+sheetName+' '+day.date+(day.amendment?' 更正':'')} onClick={()=>openItem(day)}>
       <span>{day.date}</span>{day.approvalFlow&&<small>{approvalDescription(day,'submitted')}</small>}{day.amendment&&<small>更正</small>}<ArrowRight size={14} aria-hidden="true"/>
      </button>)}</div>
     </section>;
     const description=[labels[item.type],sheetName].filter(Boolean).join(' · ');
     const submission=item.amendment?'更正待核':'首次待核';
     const period=itemPeriod(item);
     const Icon=taskIcons[item.type];
     return <button key={item.type+item.id} data-kind={item.type} type="button" disabled={disabled||loading}
      aria-label={['核对 '+item.projectName,item.submittedName,submission,description,period].filter(Boolean).join(' · ')} onClick={()=>openItem(item)}>
      <span className="cr-kind-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.7}/></span>
      <span className="cr-item-body"><span className="cr-item-title"><strong>{item.type==='daily'?(item.submittedName||item.submittedBy):item.projectName}</strong><b className="cr-submission" data-amendment={!!item.amendment}>{submission}</b></span><span className="cr-item-kind">{item.type==='daily'?item.projectName+' · '+description:description}</span>{item.approvalFlow&&<span className="cr-item-kind">{approvalDescription(item,'submitted')}</span>}{item.excerpt&&<span className="cr-excerpt">{item.excerpt}</span>}
       <small><CalendarDays size={13} aria-hidden="true"/>{period}{item.type==='project'?' 提交':''}{item.type!=='daily'||item.submittedName!==item.submittedBy?' · '+item.submittedBy:''}</small></span>
      <span className="cr-open">核对<ArrowRight size={16} aria-hidden="true"/></span>
     </button>;
    })}</div>
   </section>;
  })}</div>
  {!loading&&!error&&projectListReady&&page&&!resultCount&&<div className="cr-empty-actions"><p className="co-muted">{complete?(filterSummary==='全部'?'目前没有待你确认的事项。':'当前筛选下没有待审事项。'):'当前已读取部分没有待确认事项；还有往期未读取。'}</p>
    {complete&&(filterSummary!=='全部'?<button type="button" className="co-text" disabled={disabled||loading} onClick={()=>{setName('');setFilter({type:'all',projectId:'',month:''});}}>清除筛选，查看全部待审</button>:allowRoster&&<button type="button" className="co-text" disabled={disabled||loading} onClick={()=>{setDueOnly(false);setRoster(true);}}>查看团队日报提交情况<ArrowRight size={15}/></button>)}</div>}
  {page?.nextCursor&&<button className="co-primary cr-more" disabled={disabled||loading} onClick={()=>void read(true)}>继续查找待确认记录（含往期）</button>}
 </>}
 {daily&&<DailyQueueReview key={daily.id} companyId={companyId} item={daily} hasNext={hasNext} onDone={finish} onClose={closeReview}/>}
 </section>{showConfiguration&&projects&&!projectError&&<ConfigurationProjects projects={projects} disabled={disabled||loading} onOpen={onConfigure}/>}</>;
}
