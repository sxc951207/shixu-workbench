'use client';
import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {PeriodReport} from '../cloud/company/model';
import type {CompanyReviewItem} from '../lib/workbench/company-review';

export default function DailyQueueReview({companyId,item,hasNext,onDone,onClose}:{
 companyId:string;item:CompanyReviewItem;hasNext:boolean;
 onDone:(revision:number,advance:boolean,returned:boolean)=>void;onClose:()=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null),writing=useRef(false);
 const [report,setReport]=useState<PeriodReport|null>(null),[error,setError]=useState(''),[returning,setReturning]=useState(false);
 const [busy,setBusy]=useState(false),[comment,setComment]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{
  let active=true;
  void companyRequest({action:'report.list',companyId,scope:'review',kind:'daily',projectId:item.projectId,periodDate:item.date,reviewId:item.id}).then(result=>{
   if(!active)return;
   const current:PeriodReport|undefined=result.reports.find((row:PeriodReport)=>row.id===item.id);
   if(!current||current.version!==item.version||current.status!=='submitted')throw Error('这份日报已变化，请返回待审列表刷新。');
   setReport(current);
  }).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[companyId,item.id,item.projectId,item.date,item.version]);
 async function decide(advance:boolean){
  if(writing.current||!report||returning&&!comment.trim())return;
  writing.current=true;setBusy(true);setError('');
  try{
   const result=await companyRequest({action:returning?'report.return':'report.approve',companyId,id:report.id,version:report.version,comment:comment.trim()});
   onDone(result.companyRevision,advance,returning);
  }catch(e){setError((e as Error).message);}
  finally{writing.current=false;setBusy(false);}
 }
 return <dialog ref={dialog} className="co-modal cr-daily-modal" aria-label="核对员工日报" onCancel={e=>{e.preventDefault();if(!writing.current)onClose();}}>
  <div className="co-modal-heading"><h2>{item.submittedName||item.submittedBy}的日报</h2><button className="co-icon" disabled={busy} aria-label="返回待审列表" onClick={onClose}><X size={19}/></button></div>
  <p className="co-muted">{item.projectName} · {item.date} · 提交版 V{item.version}</p>
  {error&&<p role="alert" className="co-error">{error}</p>}
  {!report&&!error&&<p role="status">正在读取提交内容…</p>}
  {report&&<><div className="cr-daily-content">{[['本日成果',report.achievement],['风险与阻碍',report.risk],['下一步',report.next],['需要协调',report.help],['变化原因',report.changeReason]].filter(([,value])=>value).map(([name,value])=><section key={name}><h3>{name}</h3><p>{value}</p></section>)}</div>
   <fieldset disabled={busy}><label>{returning?'退回原因':'确认意见（可选）'}<textarea rows={2} maxLength={1000} value={comment} onChange={e=>setComment(e.target.value)}/></label>
   <div className="co-card-actions" aria-busy={busy}><button className="co-text" onClick={()=>{setReturning(!returning);setComment('');}}>{returning?'返回核对确认':'退回补充'}</button>
   <button className={hasNext?'co-text':'co-primary'} disabled={returning&&!comment.trim()} onClick={()=>void decide(false)}>{busy?'正在处理…':returning?'退回并返回列表':'确认并返回列表'}</button>
   {hasNext&&<button className="co-primary" disabled={returning&&!comment.trim()} onClick={()=>void decide(true)}>{busy?'正在处理…':returning?'退回并看下一份':'确认并看下一份'}</button>}</div></fieldset></>}
 </dialog>;
}
