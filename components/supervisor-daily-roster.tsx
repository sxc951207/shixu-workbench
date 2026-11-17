'use client';
import React,{useEffect,useRef,useState} from 'react';
import {todayShanghai} from '../lib/workbench/domain';
import {companyRequest} from '../cloud/company-root';
import type {CompanyReviewItem} from '../lib/workbench/company-review';
import type {DailyRoster,RosterStatus} from '../lib/workbench/daily-roster';
import '../app/supervisor-daily-roster.css';

const groups:{key:RosterStatus;label:string}[]=[
 {key:'submitted',label:'待核日报'},{key:'due',label:'应交未提交'},
 {key:'returned',label:'已退回'},{key:'approved',label:'已确认'},
];

export default function SupervisorDailyRoster({companyId,revision,onPick,onRevision,initialDueOnly=false}:{companyId:string;revision:number;onPick:(item:CompanyReviewItem)=>void;onRevision?:(value:number)=>void;initialDueOnly?:boolean}){
 const [dueOnly,setDueOnly]=useState(initialDueOnly);
 const [date,setDate]=useState(()=>todayShanghai()),[projectId,setProject]=useState(''),[login,setLogin]=useState('');
 const [projectFilter,setProjectFilter]=useState(''),[search,setSearch]=useState('');
 const [roster,setRoster]=useState<DailyRoster|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[reload,setReload]=useState(0);
 const lock=useRef(false);
 useEffect(()=>{
  let live=true;
  setLoading(true);setError('');setRoster(null);
  void companyRequest({action:'report.dailyRoster',companyId,periodDate:date}).then((result:DailyRoster)=>{
   if(live){setRoster(result);setProject(current=>result.projects.some(p=>p.id===current)?current:result.projects[0]?.id||'');}
  }).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[companyId,date,revision,reload]);
 const project=roster?.projects.find(p=>p.id===projectId);
 const available=project?.employees.filter(e=>!roster?.rows.some(r=>r.projectId===project.id&&r.login===e.login&&r.assigned))||[];
 const selected=available.some(e=>e.login===login)?login:available[0]?.login||'';
 async function change(id:string,employee:string,assigned:boolean){
  if(lock.current||!roster||roster.date!==date)return;
  lock.current=true;setSaving(true);setError('');
  try{
   const result=await companyRequest({action:'report.dailySchedule',companyId,periodDate:date,projectId:id,login:employee,assigned,revision:roster.companyRevision});
   onRevision?.(result.companyRevision);
   setRoster(null);setReload(n=>n+1);
  }catch(e){setError((e as Error).message);}
  finally{lock.current=false;setSaving(false);}
 }
 const filter=roster?.projects.some(p=>p.id===projectFilter)?projectFilter:'';
 const query=search.trim().toLocaleLowerCase();
 const rows=(roster?.date===date?roster.rows:[]).filter(r=>(!filter||r.projectId===filter)&&(!query||[r.name,r.login].some(value=>value.toLocaleLowerCase().includes(query))));
 return <section className="co-daily-roster" aria-label="按天查看员工日报">
  <header><h2>员工日报名单</h2><label>业务日期<input type="date" value={date} disabled={saving} onChange={e=>{if(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))setDate(e.target.value);}}/></label></header>
  {error&&<p className="co-error" role="alert">{error} <button type="button" className="co-text" disabled={saving} onClick={()=>setReload(n=>n+1)}>刷新名单</button></p>}
  {loading&&<p role="status">正在读取日报名单…</p>}
  {roster&&roster.date===date&&<>
   <div className="co-roster-filters">
    <label>名单项目<select aria-label="筛选名单项目" value={filter} onChange={e=>setProjectFilter(e.target.value)}><option value="">全部项目</option>{roster.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>查找员工<input type="search" aria-label="搜索员工姓名或账号" placeholder="姓名或登录名" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   </div>
   <p className="co-roster-counts">{groups.map(({key,label})=><span key={key}>{label} {rows.filter(r=>r.status===key).length}</span>)}</p>
   <label className="co-roster-due-only"><input type="checkbox" checked={dueOnly} onChange={event=>setDueOnly(event.target.checked)}/>只看应交未提交</label>
   {groups.filter(group=>!dueOnly||group.key==='due').map(({key,label})=>{
    const members=rows.filter(r=>r.status===key);
    return members.length>0&&<section key={key}><h3>{label}</h3><ul>{members.map(r=><li key={r.projectId+':'+r.login}>
     <span><strong>{r.name}</strong> · {r.projectName}<small>{r.login}</small></span>
     <div>{r.review&&<button type="button" className="co-primary" disabled={saving} onClick={()=>onPick(r.review!)}>核对日报</button>}
     {r.assigned&&<button type="button" className="co-text" disabled={saving} aria-label={'取消 '+r.name+' 在 '+r.projectName+' 的应交安排'} onClick={()=>void change(r.projectId,r.login,false)}>取消应交</button>}</div>
    </li>)}</ul></section>;
   })}
   {dueOnly&&!rows.some(row=>row.status==='due')?<p>当前名单没有应交未提交的日报。</p>:!rows.length&&<p>{filter||query?'没有符合筛选的员工。':'这天还没有已提交的日报或应交安排。'}</p>}
   {roster.projects.length>0&&<details><summary>安排当天应交员工</summary><div className="co-roster-assignment">
    <label>项目<select value={projectId} disabled={saving} onChange={e=>{setProject(e.target.value);setLogin('');}}>{roster.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>项目员工<select value={selected} disabled={saving||!available.length} onChange={e=>setLogin(e.target.value)}>{available.length?available.map(e=><option key={e.login} value={e.login}>{e.name}（{e.login}）</option>):<option value="">当前没有可安排的员工</option>}</select></label>
    <button type="button" className="co-primary" disabled={saving||!selected||!project} onClick={()=>void change(projectId,selected,true)}>安排应交</button>
   </div></details>}
  </>}
 </section>;
}
