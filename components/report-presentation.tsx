'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Building2,CheckCheck,Grid2X2,Maximize2,Minimize2,Moon,Sun,X} from 'lucide-react';
import type {ReportSnapshot} from '../cloud/company/model';
import type {ReportPeriod} from '../lib/workbench/report-period';
import {reportPeriodLabel} from '../lib/workbench/report-period';
import {buildPresentationSlides} from '../lib/workbench/presentation';
import {createPresentationFullscreen} from '../lib/workbench/presentation-fullscreen';
import '../app/presentation.css';

const fields={achievement:'本期成果',changeReason:'经营变化原因',risk:'风险与阻碍',next:'下期计划',help:'需要协调'};
const time=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export default function ReportPresentation({companyName,reports,period,preparedAt,returnFocus,onClose}:{companyName:string;reports:ReportSnapshot[];period:ReportPeriod;preparedAt:string;returnFocus:HTMLElement|null;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),stage=useRef<HTMLDivElement>(null),fullscreenSession=useRef<ReturnType<typeof createPresentationFullscreen>|null>(null),mounted=useRef(false);
 const [includeReason,setIncludeReason]=useState(false);
 const slides=useMemo(()=>buildPresentationSlides(reports,includeReason),[reports,includeReason]);
 const [page,setPage]=useState(0),[dark,setDark]=useState(false),[full,setFull]=useState({active:false,owned:false}),[fullBusy,setFullBusy]=useState(false),[hint,setHint]=useState('');
 const slide=slides[page],overviewPages=Math.ceil(reports.length/6);
 useEffect(()=>{
  const previous=returnFocus||document.activeElement as HTMLElement|null,overflow=document.body.style.overflow,scrollY=window.scrollY;
  mounted.current=true;const session=createPresentationFullscreen(document,document.documentElement);fullscreenSession.current=session;
  document.body.style.overflow='hidden';dialog.current?.showModal();stage.current?.focus({preventScroll:true});
  const update=()=>{session.sync();setFull({active:!!document.fullscreenElement,owned:session.owns});};
  document.addEventListener('fullscreenchange',update);update();
  return()=>{mounted.current=false;document.removeEventListener('fullscreenchange',update);session.dispose();dialog.current?.close();document.body.style.overflow=overflow;previous?.focus({preventScroll:true});window.scrollTo(0,scrollY);};
 },[]);
 useEffect(()=>{const root=stage.current;root?.querySelector('.ps-body')?.scrollTo(0,0);if(root&&!root.contains(document.activeElement))root.focus({preventScroll:true});},[page]);
 const go=(n:number)=>setPage(Math.max(0,Math.min(slides.length-1,n)));
 const overview=()=>{if(slide.type==='detail')go(slides.findIndex(s=>s.type==='overview'&&s.reports.some(r=>r.id===slide.report.id)));else go(0);};
 async function fullscreen(){
  if(fullBusy||full.active&&!full.owned)return;setHint('');setFullBusy(true);const session=fullscreenSession.current;
  try{if(document.fullscreenElement)await session?.exit();else await session?.enter();if(mounted.current)setFull({active:!!document.fullscreenElement,owned:!!session?.owns});}
  catch{if(mounted.current)setHint('未切换全屏，可继续使用窗口演示；Esc 可退出全屏');}
  finally{if(mounted.current)setFullBusy(false);}
 }
 function keys(e:React.KeyboardEvent){
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();go(page+1);}
  else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(page-1);}
  else if(e.key==='Home'){e.preventDefault();go(0);}
  else if(e.key==='End'){e.preventDefault();go(slides.length-1);}
  else if(e.key===' '&&!(e.target as HTMLElement).closest('button')){e.preventDefault();go(page+1);}
 }
 if(!slide)return null;
 return createPortal(<dialog ref={dialog} className={'ps-dialog '+(dark?'ps-dark':'ps-light')} aria-label="项目报表投屏演示" onKeyDown={keys} onCancel={e=>{e.preventDefault();onClose();}}>
  <div className="ps-stage" ref={stage} tabIndex={-1}>
   <header className="ps-header"><div className="ps-brand"><Building2 size={28}/><span>拾序 <small>项目汇报</small></span></div><div className="ps-context"><span title={companyName}>{companyName}</span><strong>{period.kind==='weekly'?'项目周报':'项目月报'}<i/> {reportPeriodLabel(period)}</strong></div><span className="ps-verified"><CheckCheck size={18}/>已确认快照</span></header>
   <main className="ps-body" aria-live="polite" aria-atomic="true" key={page}>
    {slide.type==='overview'?<div className="ps-overview"><div className="ps-title-row"><div><h1>项目进展总览</h1><p className="ps-subtitle">{reports.length} 个项目已确认 <span>·</span> 选择项目，展开汇报</p></div><div className="ps-overview-number">{String(page+1).padStart(2,'0')}<small>/ {String(overviewPages).padStart(2,'0')} 总览</small></div></div><div className="ps-projects">{slide.reports.map(r=><button className="ps-project" key={r.id} aria-label={'演示项目：'+r.projectName} onClick={()=>go(slides.findIndex(s=>s.type==='detail'&&s.report.id===r.id))}><div className="ps-tile-top"><span>确认版 V{r.version}</span><CheckCheck size={20}/></div><h2 title={r.projectName}>{r.projectName}</h2><div className="ps-tile-progress"><strong>{r.progress}<small>%</small></strong><ArrowRight size={23}/></div><div className="ps-bar"><i style={{width:r.progress+'%'}}/></div></button>)}</div></div>:
    <div className="ps-detail"><aside className="ps-project-hero"><h1 className={slide.report.projectName.length>24?'ps-long-name':''}>{slide.report.projectName}</h1><div className="ps-ring" style={{'--ps-progress':slide.report.progress}as React.CSSProperties}><div><strong>{slide.report.progress}<small>%</small></strong><span>本期项目进度</span></div></div><p className="ps-confirmed">确认人 {slide.report.reviewerName||'主管'}<br/>V{slide.report.version} · {time(slide.report.updatedAt)}</p></aside><section className={'ps-content ps-field-'+slide.field}><div className="ps-content-heading"><h2>{fields[slide.field]}</h2>{slide.parts>1&&<span>{slide.part} / {slide.parts} 续页</span>}</div><p className="ps-copy">{slide.text}</p><div className="ps-field-tabs">{Object.entries(fields).filter(([key])=>key!=='changeReason'||includeReason&&slide.report.changeReason).map(([key,name])=><span className={key===slide.field?'current':''} key={key}>{name}</span>)}</div></section></div>}
   </main>
   <footer className="ps-footer"><div className="ps-tools">{reports.some(r=>r.changeReason?.trim())&&<button className="ps-reason-toggle" type="button" aria-pressed={includeReason} onClick={()=>{setIncludeReason(v=>!v);setPage(0);}}>{includeReason?'隐藏变化原因':'加入变化原因'}</button>}<button onClick={overview} aria-label="返回项目总览"><Grid2X2 size={18}/><span>总览</span></button><button aria-label={dark?'切换到明亮投影':'切换到深蓝大屏'} onClick={()=>setDark(v=>!v)}>{dark?<Sun size={18}/>:<Moon size={18}/>}<span>{dark?'明亮投影':'深蓝大屏'}</span></button><button aria-label={full.active?'退出全屏':'进入全屏'} aria-disabled={fullBusy||full.active&&!full.owned} aria-busy={fullBusy} onClick={()=>void fullscreen()}>{full.active?<Minimize2 size={18}/>:<Maximize2 size={18}/>}<span>{full.active?'已全屏':'全屏'}</span></button></div><div className="ps-navigation"><button aria-label="上一张演示" disabled={page===0} onClick={()=>go(page-1)}><ArrowLeft size={22}/></button><span aria-label="演示页码"><strong>{page+1}</strong> / {slides.length}</span><button aria-label="下一张演示" disabled={page===slides.length-1} onClick={()=>go(page+1)}><ArrowRight size={22}/></button></div><button className="ps-exit" aria-label="退出投屏演示" onClick={onClose}><X size={18}/><span>退出演示</span></button></footer>
   <div className="ps-bottom"><span role="status">{hint||'← → / 翻页笔切换 · Esc 退出全屏或演示'}</span><span>快照读取于 {time(preparedAt)} · 演示期间保持不变</span></div>
  </div>
 </dialog>,document.body);
}
