'use client';
import React,{useId,useMemo,useState} from 'react';
import {ArrowLeftRight,ChevronDown} from 'lucide-react';
import OperatingComparison from './operating-comparison';
import {weeklyComparisonExample} from '../lib/workbench/operating-week-example';
import '../app/operating-week-example.css';

export default function OperatingWeekExample(){
 const [open,setOpen]=useState(false),[missing,setMissing]=useState(false);
 const panel=useId(),value=useMemo(()=>open?weeklyComparisonExample(missing):null,[open,missing]);
 return <section className="otp-week" aria-label="独立周对比样例">
  <button type="button" className="otp-week-toggle" aria-controls={panel} aria-expanded={open} onClick={()=>setOpen(!open)}>
   <span className="otp-week-mark"><ArrowLeftRight size={20}/></span>
   <span className="otp-week-name"><strong>独立周对比样例</strong><small>查看两周总业绩、差额与变化率</small></span>
   <span className="otp-week-action">{open?'收起周对比':'打开周对比'}<ChevronDown size={16}/></span>
  </button>
  <div id={panel} hidden={!open}>{value&&<div className="otp-week-detail">
   <div className="otp-week-scenarios" role="group" aria-label="周对比填报情形">
    <button type="button" aria-pressed={!missing} onClick={()=>setMissing(false)}>两周数据完整</button>
    <button type="button" aria-pressed={missing} onClick={()=>setMissing(true)}>模拟缺报一天</button>
   </div>
   <OperatingComparison value={value}/>
  </div>}</div>
 </section>;
}
