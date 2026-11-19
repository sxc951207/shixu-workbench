import React from 'react';
import type {OperatingChart,OperatingChartPoint} from '../lib/workbench/operating-chart';
import {formatOperatingMoney} from '../lib/workbench/operating-paste';

export default function OperatingWeekdayPattern({chart}:{chart:OperatingChart}){
 const metric=chart.metric;
 if(chart.purpose!=='time'||chart.source!=='daily'||!metric||metric.key.startsWith('metric:')||!['money','count'].includes(metric.format))return null;
 const groups:[OperatingChartPoint[],OperatingChartPoint[]]=[[],[]];
 const expected=[0,0];
 for(const point of chart.points){
  const weekday=new Date(point.id+'T00:00:00Z').getUTCDay();
  const i=weekday===6||weekday===0?0:1;
  expected[i]++;
  if(point.value!==null)groups[i].push(point);
 }
 if(groups.some(days=>days.length<2))return null;
 const means=groups.map(days=>{
  const sum=days.reduce((n,point)=>n+BigInt(metric.format==='money'?point.rawCents!:point.value!),BigInt(0));
  const count=BigInt(days.length),scale=metric.format==='money'?BigInt(1):BigInt(100);
  return (sum*scale*BigInt(2)+count)/(BigInt(2)*count);
 });
 const labels=['周六、周日','周一至周五'];
 const text=(n:bigint)=>metric.format==='money'?formatOperatingMoney(Number(n))+' 元':(n/BigInt(100)).toLocaleString('zh-CN')+'.'+(n%BigInt(100)).toString().padStart(2,'0')+' '+metric.unit;
 const max=Number(means[0]>means[1]?means[0]:means[1]);
 return <details className="och-details"><summary>{metric.label} · 周末与周中日均对比</summary><div className="op-readout-grid">{groups.map((days,i)=><article key={labels[i]}><span>{labels[i]}日均</span><strong>{text(means[i])}</strong><meter aria-label={labels[i]+'日均相对值'} min={0} max={max||1} value={Number(means[i])}/><small>已确认 {days.length} / {expected[i]} 天</small></article>)}</div><small>按自然星期分组，仅对有完整指标的日期求平均，已确认的零值计入。</small></details>;
}
