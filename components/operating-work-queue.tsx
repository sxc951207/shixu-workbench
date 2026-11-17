'use client';
import React,{useState}from'react';
import{ArrowRight,ClipboardCheck}from'lucide-react';
import type{OperatingWorkItem}from'../lib/workbench/operating-work-queue';
export default function OperatingWorkQueue({fill,review,cutoff,disabled,entryProject,onPick}:{fill:OperatingWorkItem[];review:OperatingWorkItem[];cutoff:string;disabled:boolean;entryProject?:string;onPick:(item:OperatingWorkItem,kind:'fill'|'review')=>void}){
 const[chosen,setChosen]=useState<'fill'|'review'>('review'),[page,setPage]=useState(0);
 if(!fill.length&&!review.length)return null;
 const kind=chosen==='review'&&review.length||!fill.length?'review':'fill',items=kind==='review'?review:fill,current=Math.min(page,Math.max(0,Math.ceil(items.length/6)-1));
 return <details className="op-work-queue" data-entry={entryProject?true:undefined} open={review.length>0||!!entryProject}><summary><ClipboardCheck size={18}/><strong>本项目待处理{entryProject&&<small className="op-work-project">{entryProject}</small>}</strong><span>待填报 {fill.length} · 待我确认 {review.length}</span></summary>{!entryProject&&<p className="op-muted">填报看所选日期 {cutoff}（月目标按本月）；确认看 {cutoff.slice(0,7)} 全月。只含当前权限内记录。</p>}
  {(!entryProject||review.length>0)&&<div className="op-work-tabs" role="group" aria-label="经营待处理类型">{(['fill','review']as const).map(key=><button key={key} type="button" disabled={disabled||!(key==='fill'?fill:review).length} aria-pressed={kind===key} onClick={()=>{setChosen(key);setPage(0);}}>{key==='fill'?'待我填报':'待我确认'} {(key==='fill'?fill:review).length}</button>)}</div>}
  <div className="op-work-items">{items.slice(current*6,current*6+6).map(item=><button key={item.key} type="button" data-status={item.status} disabled={disabled} onClick={()=>onPick(item,kind)}><span><strong>{item.name}</strong><small>{item.date} · {item.status==='missing'?'尚未填写':item.status==='returned'?'退回待补充':item.status==='draft'?'草稿待处理':'提交待核对'}</small></span><span className="op-work-action">{kind==='review'?'核对':item.status==='missing'?'填写':'继续'}<ArrowRight size={16}/></span></button>)}</div>
  {items.length>6&&<div className="co-pagination"><button type="button" disabled={disabled||current===0} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1}/{Math.ceil(items.length/6)} · 共{items.length}份</span><button type="button" disabled={disabled||(current+1)*6>=items.length} onClick={()=>setPage(current+1)}>下一页</button></div>}
 </details>;
}
