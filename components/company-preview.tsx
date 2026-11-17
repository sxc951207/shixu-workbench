'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowRight,ArrowLeftRight,ArrowUpRight,BellRing,Building2,CalendarDays,CalendarRange,Check,CheckCheck,ChevronRight,ClipboardList,Clock3,FileText,Flag,LayoutDashboard,LockKeyhole,MonitorPlay,ShieldCheck,Users} from 'lucide-react';
import ReportPresentation from './report-presentation';
import {CompanyThemeToggle} from './company-appearance';
import ReportComparison from './report-comparison';
import type {ReportSnapshot,Stage} from '../cloud/company/model';
import type {WorkItem} from '../cloud/company/work-model';
import {todayShanghai} from '../lib/workbench/domain';
import {reportPeriod,reportPeriodLabel,type ReportKind} from '../lib/workbench/report-period';
import {buildReportComparison,comparisonPeriods,type PreparedReportComparison} from '../lib/workbench/report-comparison';
import {itemState,timelineBounds,timelinePosition} from '../lib/workbench/project-delivery';
import '../app/company-preview.css';

const ownSpace='/workbench/?space=company',companyName='示例协作空间 · 演示数据';
const tabs=[{id:'overview',label:'项目总览',icon:LayoutDashboard},{id:'delivery',label:'推进与督办',icon:Flag},{id:'reports',label:'周月报表',icon:FileText}] as const;
type Tab=typeof tabs[number]['id'];
type PreviewProject={id:string;name:string;owner:string;initial:string;status:Stage;progress:number;version:number;achievement:string;risk:string;next:string;help:string;items:WorkItem[]};
const stageNames:Record<Stage,string>={approved:'已确认',submitted:'待主管确认',draft:'协作草稿',returned:'已退回'};
const itemNames={done:'已完成',overdue:'已逾期',soon:'三天内到期',open:'进行中'};
function dayFrom(today:string,offset:number){const date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
const shortDate=(date:string)=>Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日';
function demoProjects(today:string,at:string):PreviewProject[]{
 const item=(id:string,title:string,assignee:string,start:number,due:number,done=false,decision=false,notes=''):WorkItem=>({id,kind:decision?'decision':'milestone',title,notes,assignee,start:dayFrom(today,start),due:dayFrom(today,due),status:done?'done':'open',meetingDate:decision?dayFrom(today,Math.min(start,0)):null,createdAt:at,updatedAt:at,completedAt:done?at:null});
 return [
  {id:'preview-space',name:'新空间启用计划',owner:'示例成员甲',initial:'甲',status:'approved',progress:68,version:8,achievement:'完成空间动线与设备方案联审，首批物料已到位。现场检查清单已逐项交接给责任人。',risk:'定制灯具的到货日期仍待供应方确认。',next:'完成设备联调与现场验收，整理启用前最后一轮检查清单。',help:'请协调供应方在联调前确认灯具到货安排。',items:[item('space-plan','空间方案联审','示例成员甲',-10,-7,true,false,'动线、设备清单与施工安排已完成共同确认。'),item('space-supply','确认定制灯具到货安排','示例成员甲',-5,-1,false,true,'会议决定：由项目负责人对接供应方，给出明确到货日期。'),item('space-check','设备联调与现场验收','示例成员乙',0,3,false,false,'对照检查清单逐项验收，并记录需要补充的事项。')]},
  {id:'preview-service',name:'客户服务流程升级',owner:'示例成员乙',initial:'乙',status:'submitted',progress:42,version:5,achievement:'完成首轮服务流程梳理，试用团队已反馈三项改进建议。更新后的处理规范已提交主管确认。',risk:'部分跨部门需求的响应时限尚未统一。',next:'主管确认后开展小范围试用，收集一周反馈再调整。',help:'需要相关团队确认统一的响应时限。',items:[item('service-map','梳理服务处理流程','示例成员乙',-8,-3,true,false,'覆盖需求接收、分派、处理与回访四个步骤。'),item('service-rule','确认跨部门响应时限','示例成员丙',-2,2,false,true,'例会决定：收集各团队意见后形成一页式处理规范。'),item('service-trial','开展首轮小范围试用','示例成员乙',3,7,false,false,'先在示例团队内试用，记录反馈后再扩展。')]},
  {id:'preview-knowledge',name:'团队知识库整理',owner:'示例成员丙',initial:'丙',status:'draft',progress:0,version:1,achievement:'已列出首批待整理资料目录，正在补充责任分工与完成标准。',risk:'部分历史资料仍需确认有效版本。',next:'确定资料分类和负责人，先完成一份交接文档示例。',help:'请各团队提供当前有效的操作规范目录。',items:[item('knowledge-scope','确定资料目录与完成标准','示例成员丙',0,4,false,false,'先明确要留下什么、由谁维护，以及如何判断整理完成。'),item('knowledge-sample','完成首份交接文档示例','示例成员丙',4,9,false,true,'启动会决定：以实际操作流程为例，试写一份可接手的文档。')]}
 ];
}
function reportFor(project:PreviewProject,kind:ReportKind,periodDate:string,at:string,previous=false):ReportSnapshot{
 const period=reportPeriod(kind,periodDate),progress=previous?(project.id==='preview-space'?(kind==='weekly'?52:45):30):project.progress;
 return{id:'preview-report-'+project.id+'-'+kind+'-'+period.start,companyId:'preview-company',projectId:project.id,projectName:project.name,...period,status:'approved',version:previous?4:6,publishedVersion:previous?4:6,submittedBy:'preview-'+project.id,submittedName:project.owner+'（示例）',submittedAt:at,ownerLogin:'preview-'+project.owner,reviewerLogin:'preview-reviewer',progress,achievement:previous?'已完成前期梳理与首轮讨论，关键事项已分配责任人，进入下一阶段落实。':project.achievement,risk:project.risk,next:previous?'继续落实已分配事项，按节点复核完成情况。':project.next,help:previous?'请协调相关团队提供后续安排所需资料。':project.help,sourceVersions:[],createdAt:at,updatedAt:at,comment:'示例主管确认',reviewerName:'示例主管'};
}
export default function CompanyPreview(){
 const [clock]=useState(()=>new Date()),[tab,setTab]=useState<Tab>('overview'),[projectId,setProjectId]=useState(''),[deliveryView,setDeliveryView]=useState<'items'|'decisions'|'timeline'>('items'),[kind,setKind]=useState<ReportKind>('weekly'),[presentation,setPresentation]=useState<{reports:ReportSnapshot[];period:ReturnType<typeof reportPeriod>;at:string}|null>(null),[comparison,setComparison]=useState<(PreparedReportComparison&{at:string})|null>(null);
 const today=todayShanghai(clock),at=clock.toISOString(),projects=useMemo(()=>demoProjects(today,at),[today,at]),tabRefs=useRef<(HTMLButtonElement|null)[]>([]),comparisonTrigger=useRef<HTMLButtonElement>(null),presentationTrigger=useRef<HTMLButtonElement>(null),id=useId();
 const panel=useRef<HTMLElement>(null),scrollRequested=useRef(false);
 useEffect(()=>{document.title='拾序 · 只读示例预览';},[]);
 useEffect(()=>{if(scrollRequested.current){scrollRequested.current=false;panel.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});panel.current?.focus({preventScroll:true});}},[tab,projectId]);
 const items=projects.flatMap(p=>p.items),overdue=items.filter(i=>itemState(i,today)==='overdue'),soon=items.filter(i=>itemState(i,today)==='soon'),visible=projectId?projects.filter(p=>p.id===projectId):projects,period=reportPeriod(kind,today),periods=comparisonPeriods(kind,today);
 const approved=visible.filter(p=>p.status==='approved').map(p=>reportFor(p,kind,today,at)),previous=visible.filter(p=>p.status!=='draft').map(p=>reportFor(p,kind,periods.previousPeriod.start,at,true));
 function navigate(next:Tab,selected=''){scrollRequested.current=true;setProjectId(selected);setTab(next);}
 function tabKeys(event:React.KeyboardEvent,index:number){const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next<0)return;event.preventDefault();setTab(tabs[next].id);tabRefs.current[next]?.focus();}
 function compare(){setComparison({period,previousPeriod:periods.previousPeriod,pairs:buildReportComparison(approved,previous),revision:0,at:new Date().toISOString()});}
 return <div className="company-preview"><div className="cp-wrap">
  <header className="cp-topbar">
   <a href={ownSpace} className="cp-brand" aria-label="拾序，返回我的公司空间"><img src="/workbench/favicon.svg" alt="" width="38" height="38"/><strong>拾序<small>公司工作台</small></strong></a>
   <div className="cp-topbar-actions"><CompanyThemeToggle/><a className="cp-return" href={ownSpace}>我的公司空间<ArrowUpRight size={15}/></a></div>
  </header>
  <main>
   <section className="cp-ledger-head" aria-labelledby={id+'-title'}>
    <div className="cp-ledger-title">
     <p className="cp-ledger-context" role="note"><ShieldCheck size={15}/> 只读演示<span aria-hidden="true">/</span>示例数据</p>
     <h1 id={id+'-title'}>项目协作总览</h1>
     <time dateTime={today}><CalendarDays size={15}/>{today}</time>
    </div>
    <div className="cp-distribution" aria-label="项目确认分布">
     <p>项目确认分布</p>
     <div className="cp-distribution-bar" aria-hidden="true">{projects.map(p=><i key={p.id} className={p.status}/>)}</div>
     <div className="cp-distribution-legend">
      {(['approved','submitted','draft','returned'] as const).map(status=>{
       const count=projects.filter(p=>p.status===status).length;
       return count>0&&<span key={status}><i className={status}/>{stageNames[status]} <b>{count}</b></span>;
      })}
     </div>
    </div>
   </section>
   <div className="cp-section-nav"><div className="cp-tabs" role="tablist" aria-label="公司演示内容">{tabs.map(({id:tabId,label,icon:Icon},index)=><button key={tabId} ref={element=>{tabRefs.current[index]=element;}} id={id+'-tab-'+tabId} role="tab" aria-selected={tab===tabId} aria-controls={id+'-panel'} tabIndex={tab===tabId?0:-1} className={tab===tabId?'active':''} onKeyDown={e=>tabKeys(e,index)} onClick={()=>setTab(tabId)}><Icon size={17}/>{label}</button>)}</div><a className="cp-plain cp-data-link" href="/workbench/?space=company&preview=templates"><FileText size={16}/>体验经营填报与累计<ArrowUpRight size={14}/></a></div>
   <section role="tabpanel" id={id+'-panel'} aria-labelledby={id+'-tab-'+tab} className="cp-panel" data-view={tab} ref={panel} tabIndex={0}>
   {tab==='overview'?<>
    <div className="cp-operating-strip">
     <div><span>跟进项目</span><strong>{projects.length}</strong><small>个</small></div>
     <div><span>待主管确认</span><strong>{projects.filter(p=>p.status==='submitted').length}</strong><small>个项目</small></div>
     <div><span>三天内到期</span><strong>{soon.length}</strong><small>项</small></div>
     <div className="cp-needs-attention"><span>已逾期</span><strong>{overdue.length}</strong><small>项</small></div>
    </div>
    {overdue.length>0&&<div className="cp-attention-line"><Flag size={16}/><p><strong>优先跟进</strong> {overdue[0].title} <span>· {overdue[0].assignee} · {shortDate(overdue[0].due)}到期</span></p><button className="cp-plain" onClick={()=>navigate('delivery',projects.find(p=>p.items.some(i=>i.id===overdue[0].id))?.id)}>查看事项<ArrowRight size={15}/></button></div>}
    <div className="cp-register-title"><h2>项目进度</h2><span>{projects.length} 个项目</span></div>
    <table className="cp-register"><thead><tr><th scope="col">项目 / 本期成果</th><th scope="col">进度</th><th scope="col">确认状态</th><th scope="col">负责人</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
     <tbody>{projects.map(p=><tr key={p.id}>
      <th scope="row"><strong>{p.name}</strong><p>{p.achievement}</p></th>
      <td className="cp-register-progress"><strong>{p.progress}<small>%</small></strong><div className="cp-progress" aria-hidden="true"><i style={{width:p.progress+'%'}}/></div></td>
      <td className="cp-register-stage"><span className={'cp-stage '+p.status}><span/>{stageNames[p.status]}</span><small>V{p.version}</small></td>
      <td className="cp-register-owner"><span>{p.owner}</span></td>
      <td className="cp-register-action"><button className="cp-plain" onClick={()=>navigate('delivery',p.id)} aria-label={'查看推进：'+p.name}>查看推进<ArrowRight size={15}/></button></td>
     </tr>)}</tbody>
    </table>
    <div className="cp-snapshot-note"><ShieldCheck size={20}/><div><strong>领导汇总只展示已确认成果</strong><p>新的草稿或更正仍在核实时，汇总保留上一份确认版。</p></div><button className="cp-plain" onClick={()=>navigate('reports')}>看看周月报表<ArrowRight size={16}/></button></div>
   </>:tab==='delivery'?<>
    <div className="cp-section-heading"><div><h2>推进事项与截止日期</h2></div><a className="cp-secondary" href={ownSpace}>进入我的空间后填写<ArrowUpRight size={15}/></a></div>
    <div className="cp-controls"><div className="cp-view-buttons" role="group" aria-label="演示推进视图">{([{key:'items',label:'节点清单',icon:ClipboardList},{key:'decisions',label:'会议决议',icon:Users},{key:'timeline',label:'时间轴',icon:CalendarRange}] as const).map(({key,label,icon:Icon})=><button key={key} aria-pressed={deliveryView===key} className={deliveryView===key?'active':''} onClick={()=>setDeliveryView(key)}><Icon size={16}/>{label}</button>)}</div><label>项目<select value={projectId} aria-label="筛选演示项目" onChange={e=>setProjectId(e.target.value)}><option value="">全部示例项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <p className="cp-inline-note"><LockKeyhole size={14}/>示例中的完成状态和站内提醒仅供查看。实际填写、确认和提醒在自己的空间中进行。</p>
    <div className="cp-delivery-projects">{visible.map(p=>{const listed=p.items.filter(i=>deliveryView!=='decisions'||i.kind==='decision');return <article className="cp-delivery-card" key={p.id}><div className="cp-delivery-heading"><div><span className={'cp-stage '+p.status}><span/>{stageNames[p.status]}</span><h3>{p.name}</h3><p>{p.owner} 负责 · {p.items.filter(i=>i.status==='done').length}/{p.items.length} 事项完成</p></div><span className="cp-version">项目 V{p.version}</span></div>{p.status==='submitted'&&<div className="cp-waiting"><Clock3 size={17}/><span>进展已提交，等待示例主管确认。</span><span className="cp-notification"><BellRing size={14}/>站内提醒示例</span></div>}{deliveryView==='timeline'?<PreviewTimeline items={listed} today={today}/>:<div className="cp-items">{listed.map(i=>{const state=itemState(i,today);return <div className={'cp-item '+state} key={i.id}><span className="cp-item-check" aria-label={state==='done'?'已完成':'尚未完成'}>{state==='done'?<Check size={16}/>:<span/>}</span><div><div className="cp-item-title"><span className="cp-kind">{i.kind==='decision'?'会议决议':'关键节点'}</span><h4>{i.title}</h4><span className={'cp-item-state '+state}>{itemNames[state]}</span></div><p>{i.assignee} 负责 · {shortDate(i.start)} — {shortDate(i.due)}{i.meetingDate?' · 会议 '+shortDate(i.meetingDate):''}</p><div className="cp-item-notes">{i.notes}</div>{state==='overdue'&&<small className="cp-item-reminder"><BellRing size={13}/>示例主管已留下站内跟进提醒</small>}</div></div>;})}</div>}</article>;})}</div>
   </>:<>
    <div className="cp-section-heading"><div><h2>项目周报与月报</h2></div><span className="cp-readonly"><CheckCheck size={15}/>仅已确认内容进入演示</span></div>
    <div className="cp-controls cp-report-controls"><div className="cp-view-buttons" role="group" aria-label="演示报表类型"><button aria-pressed={kind==='weekly'} className={kind==='weekly'?'active':''} onClick={()=>setKind('weekly')}>项目周报</button><button aria-pressed={kind==='monthly'} className={kind==='monthly'?'active':''} onClick={()=>setKind('monthly')}>项目月报</button></div><label>项目<select aria-label="筛选演示报表项目" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">全部示例项目</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="cp-report-actions"><button ref={comparisonTrigger} className="cp-secondary" onClick={compare}><ArrowLeftRight size={16}/>两期对比</button><button ref={presentationTrigger} className="cp-primary" disabled={!approved.length} onClick={()=>setPresentation({reports:approved,period,at:new Date().toISOString()})}><MonitorPlay size={17}/>投屏演示</button></div></div>
    <div className="cp-report-period"><span><CalendarDays size={16}/><strong>{reportPeriodLabel(period)}</strong></span><span>{approved.length} 份已确认 · {visible.filter(p=>p.status==='submitted').length} 份待确认</span></div>
    <p className="cp-inline-note"><ShieldCheck size={15}/>对比中缺少的一期会明确标注，不当作0%。投屏只展示已确认的示例报表。</p>
    <div className="cp-report-grid">{visible.map(p=><article className="cp-report-card" key={p.id}><div className="cp-project-top"><span className={'cp-stage '+p.status}><span/>{stageNames[p.status]}</span><FileText size={19}/></div><h3>{p.name}</h3><p className="cp-report-type">{kind==='weekly'?'项目周报':'项目月报'} · {p.status==='approved'?'示例确认快照':p.status==='submitted'?'等待主管确认':'示例草稿'}</p><div className="cp-report-progress"><span>本期进度</span><strong>{p.progress}<small>%</small></strong></div><div className="cp-progress"><i style={{width:p.progress+'%'}}/></div><section><h4>本期成果</h4><p>{p.achievement}</p></section><details><summary>展开风险、计划与协调<ChevronRight size={16}/></summary>{[['风险与阻碍',p.risk],['下期计划',p.next],['需要协调',p.help]].map(([label,text])=><section key={label}><h4>{label}</h4><p>{text}</p></section>)}</details><div className="cp-report-card-foot">{p.status==='approved'?<><CheckCheck size={15}/><span>已进入两期对比与投屏</span></>:<><Clock3 size={15}/><span>{p.status==='submitted'?'确认后进入汇总':'填写并提交后，等待主管确认'}</span></>}</div></article>)}</div>
    {!approved.length&&<div className="cp-no-approved"><MonitorPlay size={20}/><p>{previous.length?'当前项目暂无本期已确认报表，可在两期对比中查看上期内容，或选择全部示例项目体验投屏。':'当前项目两期都暂无已确认报表。选择全部示例项目，即可体验有确认内容的对比和投屏。'}</p><button className="cp-plain" onClick={()=>setProjectId('')}>查看全部示例项目<ArrowRight size={15}/></button></div>}
   </>}
   </section>
  </main>
  <footer className="cp-footer"><span><Building2 size={15}/>拾序 · 公司工作台</span><span>演示数据 · 只读 · 不保存</span></footer>
 </div>{presentation&&<ReportPresentation companyName={companyName} reports={presentation.reports} period={presentation.period} preparedAt={presentation.at} returnFocus={presentationTrigger.current} onClose={()=>setPresentation(null)}/>} {comparison&&<ReportComparison companyName={companyName} value={comparison} preparedAt={comparison.at} returnFocus={comparisonTrigger.current} onClose={()=>setComparison(null)}/>}</div>;
}
function PreviewTimeline({items,today}:{items:WorkItem[];today:string}){
 const bounds=timelineBounds(items,today),todayPosition=(Date.parse(today+'T00:00:00Z')-Date.parse(bounds.start+'T00:00:00Z'))/86400000/bounds.days*100;
 return <div className="cp-timeline-scroll" tabIndex={0} aria-label="示例项目时间轴，可横向滚动"><div className="cp-timeline"><div className="cp-timeline-heading"><span>事项 / 责任人</span><div><span>{bounds.start}</span><span>{bounds.days} 天</span><span>{bounds.end}</span></div></div>{[...items].sort((a,b)=>a.start.localeCompare(b.start)).map(i=>{const position=timelinePosition(i,bounds),state=itemState(i,today);return <div className="cp-timeline-row" key={i.id}><div><strong>{i.title}</strong><small>{i.assignee} · {shortDate(i.start)} → {shortDate(i.due)}</small></div><div className="cp-timeline-track">{todayPosition>=0&&todayPosition<=100&&<i className="cp-today-line" style={{left:todayPosition+'%'}} title={'今天 '+today}/>}<span className={'cp-timeline-bar '+state} style={{left:position.left+'%',width:position.width+'%'}}><span>{itemNames[state]}</span></span></div></div>;})}<p className="cp-timeline-legend"><span/>竖线表示今天 · 起止日期按实际天数排列</p></div></div>;
}
