import React,{useEffect,useState} from 'react';
import {previewImportDays,sourceDateGaps,type PreviewDay} from '../lib/workbench/operating-day-preview';
import type {ImportMonth,OperatingImportEntry} from '../lib/workbench/operating-reimport';

export default function OperatingDayPreview({entries,readMonth}:{entries:OperatingImportEntry[];readMonth:(month:string)=>Promise<ImportMonth>}){
 const [attempt,setAttempt]=useState(0);
 const [result,setResult]=useState<{entries:OperatingImportEntry[];days?:PreviewDay[];error?:string}>();
 useEffect(()=>{
  let current=true;
  setResult(undefined);
  previewImportDays(entries,readMonth).then(days=>{if(current)setResult({entries,days});},e=>{if(current)setResult({entries,error:e instanceof Error?e.message:'读取失败'});});
  return()=>{current=false;};
 },[entries,readMonth,attempt]);
 const active=result?.entries===entries?result:undefined;
 if(active?.error)return <div role="alert">未能核对已有日期：{active.error} <button type="button" className="co-text" onClick={()=>setAttempt(n=>n+1)}>重新比对</button></div>;
 if(!active?.days)return <p role="status">正在按原表日期核对已有记录…</p>;
 const days=active.days,added=days.filter(d=>d.kind==='new'),changed=days.filter(d=>d.kind==='changed'),same=days.filter(d=>d.kind==='same'),check=days.filter(d=>d.kind==='check');
 const gaps=sourceDateGaps(days.map(d=>d.date));
 return <section aria-label="按日期比对结果">
  <p role="status"><strong>新增 {added.length} 天 · 有变动 {changed.length} 天 · 相同 {same.length} 天{check.length>0&&' · 需核对 '+check.length+' 天'}</strong></p>
  {added.length>0&&<details><summary>查看新增日期</summary><p>{added.map(d=>d.date).join('、')}</p></details>}
  {(changed.length>0||check.length>0)&&<div>{added.length>0&&<p>新增日期可以先存草稿并提交。历史差异单独核对后更新。</p>}
   {[...changed,...check].map(d=><details key={d.date}><summary>{d.date} · {d.kind==='changed'?d.details.length+' 项差异':'需核对'}</summary><ul>{d.details.map((s,i)=><li key={i}>{s}</li>)}</ul></details>)}</div>}
  {gaps.length>0&&<details><summary>所选日期之间有空档</summary><p>{gaps.join('、')}。本次未导入这些日期，已有数据保留。</p></details>}
 </section>;
}
