import React from 'react';
import type {operatingTargetProgress} from '../lib/workbench/operating-data';
import {formatOperatingPercent as pct} from '../lib/workbench/operating-display';
import {formatOperatingMoney as money} from '../lib/workbench/operating-paste';
import '../app/operating-target-chart.css';

type Props={progress:ReturnType<typeof operatingTargetProgress>;cutoff:string;confirmedOnly:boolean;approvedTarget:boolean};

export default function OperatingTargetChart({progress,cutoff,confirmedOnly,approvedTarget}:Props){
 const {total,daysExpected}=progress;
 const calendarDays=new Date(Date.UTC(Number(cutoff.slice(0,4)),Number(cutoff.slice(5,7)),0)).getUTCDate();
 const elapsed=Number(cutoff.slice(8))/calendarDays;
 const rows=[...progress.rows].sort((a,b)=>(b.rate??-1)-(a.rate??-1));
 const maximum=Math.max(1,...rows.map(row=>row.rate??0));
 const hasGaps=rows.some(row=>row.reportedDays<daysExpected||row.target==null);
 const hasPending=!approvedTarget||rows.some(row=>row.unconfirmedDays>0);
 return <figure className="op-goal-chart" aria-label="门店月目标完成率图">
  <figcaption><div><p>{cutoff.slice(0,7)}　·　截至 {cutoff.slice(5)}</p><h3>门店目标完成率</h3></div>
   <div className="op-goal-total"><span>{hasGaps?'已填合计完成率':'总体完成率'}</span><strong>{total.rate===null?'—':pct(total.rate)}</strong></div>
  </figcaption>
  <p className="op-goal-amounts">累计业绩 <b>{money(total.revenue)}</b> 元　/　月目标 <b>{money(total.target)}</b> 元</p>
  <div className="op-goal-key"><span>竖线为截至当天的时间进度 {pct(elapsed)}</span><span>{confirmedOnly?'已确认数据':hasPending?'工作数据 · 含未确认项':'已确认数据'}{hasGaps?' · 部分数据未齐':''}</span></div>
  <ol>{rows.map(row=><li key={row.storeId}>
   <span className="op-goal-name">{row.storeName}</span>
   <span className="op-goal-track" aria-hidden="true">
    {row.rate!==null&&<i style={{width:(row.rate/maximum*100)+'%'}} data-achieved={row.rate>=1}/>}
    <em style={{left:(elapsed/maximum*100)+'%'}}/>
   </span>
   <strong className="op-goal-rate">{row.rate===null?'—':pct(row.rate)}</strong>
   <span className="op-goal-facts">{row.rate===null?(row.target==null?'目标未填':row.target===0?'目标为 0':'暂无业绩'):row.reportedDays<daysExpected?'已录 '+row.reportedDays+'/'+daysExpected+' 天':''}</span>
  </li>)}</ol>
 </figure>;
}
