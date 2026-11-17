'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeftRight,CheckCheck,X} from 'lucide-react';
import type {PreparedReportComparison,ReportComparisonPair} from '../lib/workbench/report-comparison';
import {reportPeriodLabel} from '../lib/workbench/report-period';
import '../app/report-comparison.css';

const fields={achievement:'本期成果',changeReason:'经营变化原因',risk:'风险与阻碍',next:'下期计划',help:'需要协调'} as const;
const time=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export default function ReportComparison({companyName,value,preparedAt,returnFocus,onClose}:{companyName:string;value:PreparedReportComparison;preparedAt:string;returnFocus:HTMLElement|null;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),title=useId(),description=useId();
 const[selected,setSelected]=useState('');const pairs=selected?value.pairs.filter(p=>p.projectId===selected):value.pairs;
 const both=pairs.filter(p=>p.current&&p.previous).length,currentOnly=pairs.filter(p=>p.current&&!p.previous).length,previousOnly=pairs.filter(p=>!p.current&&p.previous).length;
 useEffect(()=>{
  const previous=returnFocus||document.activeElement as HTMLElement|null,overflow=document.body.style.overflow,scrollY=window.scrollY,element=dialog.current;
  document.body.style.overflow='hidden';element?.showModal();close.current?.focus({preventScroll:true});
  return()=>{element?.close();document.body.style.overflow=overflow;previous?.focus({preventScroll:true});window.scrollTo(0,scrollY);};
 },[]);
 return createPortal(<dialog ref={dialog} className="rc-dialog" aria-labelledby={title} aria-describedby={description} onCancel={e=>{e.preventDefault();onClose();}}>
  <header className="rc-header"><div><span className="rc-kicker"><ArrowLeftRight size={16}/>已确认快照对比</span><h2 id={title}>{companyName} · {value.period.kind==='weekly'?'周报':'月报'}对比</h2></div><button ref={close} className="rc-close" aria-label="关闭报表对比" onClick={onClose}><X size={21}/></button></header>
  <div className="rc-body">
   <div className="rc-periods"><div><span>上期</span><strong>{reportPeriodLabel(value.previousPeriod)}</strong></div><div><span>本期</span><strong>{reportPeriodLabel(value.period)}</strong></div></div>
   <p id={description} className="rc-description">按项目配对，展示两期已确认内容。缺少报表时不计算进度变化。</p>
   {value.pairs.length>1&&<label className="rc-filter">在对比中筛选项目<select aria-label="筛选两期对比项目" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">全部已读取项目</option>{value.pairs.map(p=><option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>}<div className="rc-summary" aria-label="对比完整性" aria-live="polite"><span>{pairs.length} 个项目{selected?' / 共读取 '+value.pairs.length+' 个':''}</span><span>两期齐全 {both}</span><span>仅本期 {currentOnly}</span><span>仅上期 {previousOnly}</span></div>
   {!value.pairs.length?<div className="rc-empty"><CheckCheck size={30}/><h3>两期均无已确认报表</h3><p>当前选择的项目与周期暂无可对比内容，主管确认后再查看。</p></div>:<div className="rc-projects">{pairs.map(pair=><ComparisonProject key={pair.projectId} pair={pair}/>)}</div>}
   <p className="rc-note">“与上期相同”仅表示风险全文在整理空白后相同，不判断风险是否解决。</p>
  </div>
  <footer className="rc-footer"><span>读取于 {time(preparedAt)} · 本次对比期间保持不变</span><button onClick={onClose}>关闭对比</button></footer>
 </dialog>,document.body);
}
function ComparisonProject({pair}:{pair:ReportComparisonPair}){
 const{current,previous}=pair;
 return <article className="rc-project"><div className="rc-project-heading"><div><h3>{pair.projectName}</h3><p className={current&&previous?'rc-complete':'rc-partial'}>{current&&previous?'两期均有已确认报表':current?'上期尚无已确认报表':'本期尚无已确认报表'}</p></div><strong className="rc-delta">{pair.progressDelta===null?'进度暂无法比较':(pair.progressDelta>0?'+':'')+pair.progressDelta+' 个百分点'}<small>本期较上期</small></strong></div>
  <div className="rc-progress-pair">{[[previous,'上期'],[current,'本期']].map(([snapshot,label])=>{
   const report=snapshot as typeof current;return <div className="rc-progress-cell" key={String(label)}><span>{String(label)}项目进度</span><strong>{report?report.progress+'%':'尚无已确认报表'}</strong>{report&&<><div className="rc-progress-bar"><i style={{width:report.progress+'%'}}/></div><small>{report.projectName} · V{report.version} · 确认人 {report.reviewerName||'主管'}</small></>}</div>;
  })}</div>
  {Object.entries(fields).filter(([field])=>field!=='changeReason').map(([field,label])=><section className="rc-field" key={field}><div className="rc-field-heading"><h4>{label}</h4>{field==='risk'&&pair.riskUnchanged&&<span>与上期相同</span>}</div><div className="rc-field-pair"><div><span>上期</span><p className={!previous?'rc-missing':''}>{previous?(previous[field as keyof typeof fields]||'未填写'):'尚无已确认报表'}</p></div><div><span>本期</span><p className={!current?'rc-missing':''}>{current?(current[field as keyof typeof fields]||'未填写'):'尚无已确认报表'}</p></div></div></section>)}
  {(previous?.changeReason||current?.changeReason)&&<details className="co-report-reason"><summary>查看两期经营变化原因</summary><div className="rc-field-pair">{[[previous,'上期'],[current,'本期']].map(([snapshot,label])=>{
   const report=snapshot as typeof current;
   return <div key={String(label)}><span>{String(label)}</span><p>{report?(report.changeReason||'未填写'):'尚无已确认报表'}</p></div>;
  })}</div></details>}
 </article>;
}
