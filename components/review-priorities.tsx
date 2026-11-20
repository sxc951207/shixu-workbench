'use client';
import React,{useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {CompanyReviewItem} from '../lib/workbench/company-review';
import type {DailyRoster,DailyRosterRow} from '../lib/workbench/daily-roster';
import {todayShanghai} from '../lib/workbench/domain';
import {reportWaitingDays} from '../lib/workbench/report-comparison';
import {reviewPriorities} from '../lib/workbench/review-priorities';

type Props={
 companyId:string; revision:number; refreshKey:number; items:CompanyReviewItem[]; complete:boolean; ready:boolean; failed:boolean; disabled:boolean;
 describe:(item:CompanyReviewItem)=>string; onPick:(item:CompanyReviewItem)=>void; onRoster:()=>void;
};

export default function ReviewPriorities({companyId,revision,refreshKey,items,complete,ready,failed,disabled,describe,onPick,onRoster}:Props){
 const date=todayShanghai();
 const [due,setDue]=useState<DailyRosterRow[]|null>(null),[rosterError,setRosterError]=useState('');
 const [selected,setSelected]=useState('');
 useEffect(()=>{
  let active=true;
  setDue(null);setRosterError('');
  void companyRequest({action:'report.dailyRoster',companyId,periodDate:date}).then((roster:DailyRoster)=>{
   if(active)setDue(roster.rows.filter(row=>row.assigned&&row.status==='due'));
  }).catch(e=>{if(active)setRosterError(e.message);});
  return()=>{active=false;};
 },[companyId,date,revision,refreshKey]);
 const {oldest,amendments,missingTime}=reviewPriorities(items);
 const change=amendments.find(row=>row.id===selected)||amendments[0];
 const wait=oldest?reportWaitingDays(oldest.submittedAt):null;
 const primary=ready?(change?'change':oldest?'oldest':'roster'):null;
 const unavailable=failed?'待审记录读取失败，请刷新。':'正在读取待审记录…';
 const partial=ready&&!complete;
 if(ready&&complete&&!failed&&!rosterError&&due?.length===0&&items.length===0){
  return <p className="co-muted cr-priorities-empty" role="status">今日没有未交日报，待审队列已清空。</p>;
 }
 return <section className="cr-priorities" aria-label="主管优先处理">
  <section><div><h2>今日应交未交</h2>
   <p>{rosterError?'日报名单读取失败：'+rosterError:due===null?'正在读取今日名单…':due.length
    ?due.slice(0,2).map(row=>row.name+'（'+row.projectName+'）').join('、')+(due.length>2?' 等，共 '+due.length+' 份':'')
    :'今日没有应交未交的日报。'}</p></div>
   {due&&due.length>0&&<button type="button" className={primary==='roster'?'co-primary':'co-text'} disabled={disabled} onClick={onRoster}>查看未交名单<ArrowRight size={14}/></button>}
  </section>
  <section><div><h2>有更正的提交{partial&&<small>已读范围</small>}</h2>
   {!ready||!change?<p>{!ready?unavailable:partial?'已读记录中暂无更正。':'暂无更正待核。'}</p>:amendments.length>1
    ?<select aria-label="选择更正待核的提交" value={change.id} onChange={event=>setSelected(event.target.value)}>{amendments.map(item=><option key={item.type+item.id} value={item.id}>{describe(item)}</option>)}</select>
    :<p>{describe(change)}</p>}</div>
   {ready&&change&&<button type="button" className="co-primary" disabled={disabled} onClick={()=>onPick(change)}>{change.type==='operating'?'看改前改后':'查看更正详情'}<ArrowRight size={14}/></button>}
  </section>
  <section><div><h2>等待最久的提交{partial&&<small>已读范围</small>}</h2>
   <p>{!ready?unavailable:oldest?(wait===0?'今天提交':'已等 '+wait+' 天')+' · '+describe(oldest):items.length?'提交时间待补记。':partial?'已读范围内暂无待审提交。':'暂无待审提交。'}</p>
   {ready&&oldest&&missingTime&&<small>仅比较已记录提交时间的事项。</small>}</div>
   {ready&&oldest&&<button type="button" className={primary==='oldest'?'co-primary':'co-text'} disabled={disabled} onClick={()=>onPick(oldest)}>去审核<ArrowRight size={14}/></button>}
  </section>
 </section>;
}
