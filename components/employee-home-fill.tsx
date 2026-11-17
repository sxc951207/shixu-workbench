'use client';
import React,{useEffect,useState} from 'react';
import {ArrowRight,ClipboardList,RefreshCw} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {OperatingHomeResult} from '../lib/workbench/operating-work-queue';
import '../app/employee-home-fill.css';

export default function EmployeeHomeFill({companyId}:{companyId:string}){
 const [data,setData]=useState<OperatingHomeResult|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let latest=0;
  function load(){
   const token=++latest;
   setError('');setData(null);
   void companyRequest({action:'ops.nextFill',companyId}).then((value:OperatingHomeResult)=>{
    if(token===latest)setData(value);
   }).catch(cause=>{if(token===latest)setError(cause.message||'连接未确认');});
  }
  const resume=(event:PageTransitionEvent)=>{if(event.persisted)load();};
  load();window.addEventListener('focus',load);window.addEventListener('pageshow',resume);
  return()=>{++latest;window.removeEventListener('focus',load);window.removeEventListener('pageshow',resume);};
 },[companyId,retry]);
 const item=data?.item;
 const link=item?'/workbench/?'+new URLSearchParams({space:'company',tab:'operating',fill:'1',company:companyId,project:item.projectId,day:item.date,sheet:item.sheet}):'';
 return <section className="panel employee-home-fill" aria-label="我的经营填报">
  <div className="employee-fill-copy"><ClipboardList aria-hidden="true" size={22}/><div>
   <h2>{item?'优先填报':'我的经营填报'}</h2>
   {item?<><strong>{item.name}</strong><p>{item.projectName} · 业务日期 {item.date} · {item.status==='returned'?'已退回':item.status==='draft'?'草稿':'尚未填写'}</p></>
    :<p role="status">{error?'暂时无法读取填报安排。'+error:data?'当前暂无待你填写的经营记录。':'正在读取填报安排…'}</p>}
   {data&&<details className="employee-fill-range"><summary>查找哪些记录</summary><p>先看 {data.since} 至 {data.day} 退回的记录，再看草稿。日表新填报按 {data.day}，月目标按该月。</p></details>}
  </div></div>
  {item?<a className="primary" href={link}>{item.status==='returned'?'补充这份记录':item.status==='draft'?'继续填写':'开始填写'}<ArrowRight size={16}/></a>
   :error?<button className="text-button" type="button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={14}/>重新读取</button>:null}
 </section>;
}
