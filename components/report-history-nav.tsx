'use client';
import React from'react';
import{ArrowLeft,ArrowRight,CalendarDays,History,ShieldCheck,TableProperties,FileText}from'lucide-react';
import{reportHistoryNavigation,type HistoryKind}from'../lib/workbench/report-history';
import'../app/report-history.css';

export function MeetingEntry({disabled,onNumbers,onReports}:{disabled:boolean;onNumbers:()=>void;onReports:()=>void}){
 return <section className="meeting-history-entry" aria-label="会议查阅"><div><h2 className="co-history-title"><History size={19} aria-hidden="true"/>会议查阅</h2></div><div className="meeting-history-actions"><button type="button" disabled={disabled} onClick={onNumbers}><TableProperties size={19}/><strong>查历史经营数据</strong><small>单日、月初累计与门店明细</small></button><button type="button" disabled={disabled} onClick={onReports}><FileText size={19}/><strong>查历史周月报</strong><small>上一期、两期对比与投屏</small></button></div></section>;
}
export default function ReportHistoryNav({kind,value,today,confirmedOnly,disabled,onChange,singleDay=false}:{singleDay?:boolean;kind:HistoryKind;value:string;today:string;confirmedOnly:boolean;disabled:boolean;onChange:(value:string)=>void}){
 let nav;try{nav=reportHistoryNavigation(kind,value,today);}catch{return <p className="co-muted">请选择有效日期后查看历史报表。</p>;}
 const unit=kind==='daily'?'天':kind==='weekly'?'周':'月';
 return <section className="report-history-nav" aria-label="历史报表回看"><div className="report-history-heading"><h3><History size={18}/>历史回看</h3><span><ShieldCheck size={14}/>{confirmedOnly?'已确认数据':'工作记录 · 含未确认内容'}</span></div><div className="report-history-period" role="status" aria-live="polite"><span>{nav.future?'未来期间':nav.history?'历史期间':'当前期间'}</span><strong>{kind==='operating'&&singleDay?value:nav.label}</strong>{kind==='operating'&&<b>{singleDay?'单日记录':'月初累计'}</b>}</div><div className="report-history-buttons"><div role="group" aria-label="相邻周期"><button type="button" disabled={disabled||!nav.previous} onClick={()=>nav.previous&&onChange(nav.previous)}><ArrowLeft size={16}/>{kind==='operating'?'上个月':'上一'+unit}</button><button type="button" disabled={disabled||!nav.next} onClick={()=>nav.next&&onChange(nav.next)}>{kind==='operating'?'下个月':'下一'+unit}<ArrowRight size={16}/></button></div><div role="group" aria-label="常用历史日期">{nav.shortcuts.map(shortcut=><button type="button" key={shortcut.label} disabled={disabled} onClick={()=>onChange(shortcut.value)}><CalendarDays size={15}/>{shortcut.label}</button>)}</div></div><p>{nav.caption}</p></section>;
}
