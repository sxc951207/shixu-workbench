'use client';
import React,{useRef,useState}from'react';
import{ShieldCheck,TriangleAlert,ArrowLeftRight}from'lucide-react';
import type{PreparedOperatingComparison,ComparisonColumn,ComparisonCell,ComparisonFormat,ComparisonSheet}from'../lib/workbench/operating-comparison';
import {formatOperatingMoney} from '../lib/workbench/operating-paste';
import {formatOperatingDecimal as number,formatOperatingPercent} from '../lib/workbench/operating-display';
import {comparisonReasonPeriod,loadOperatingComparisonReason,type ComparisonReason} from '../lib/workbench/operating-comparison-reader';
import'../app/operating-comparison.css';

function display(value:number|null,format:ComparisonFormat){
 if(value===null)return '—';
 if(format==='moneyCents')return formatOperatingMoney(value)+' 元';
 if(format==='money')return number(value)+' 元';
 if(format==='percent')return formatOperatingPercent(value);
 if(format==='ratio')return number(value)+' 倍';
 if(format==='stars')return number(value,1)+' 星';
 return number(value,0);
}
function difference(cell:ComparisonCell,column:ComparisonColumn){
 if(cell.difference===null)return '—';
 if(cell.difference===0)return '持平';
 const change=cell.difference,absolute=Math.abs(change),direction=change>0?'上升 ':'下降 ';
 if(cell.roundedDifference!==undefined){
  const magnitude=cell.roundedDifference==='0.00'?'不足 0.01':cell.roundedDifference;
  const unit=column.format==='percent'?'个百分点':column.format==='money'?'元':'倍';
  return direction+magnitude+' '+unit;
 }
 if(column.format==='percent'){
  const points=formatOperatingPercent(absolute).slice(0,-1);
  return direction+(points==='0.00'?'不足 0.01':points)+' 个百分点';
 }
 if(column.format==='stars')return direction+number(absolute,1)+' 分';
 return direction+display(absolute,column.format);
}
function growth(cell:ComparisonCell,column:ComparisonColumn){
 if(cell.difference===null)return '—';
 if(column.format==='percent')return '按百分点比较';
 if(column.format==='stars')return '按截止日星级比较';
 if(cell.changeRatio===null)return cell.changeNote||'—';
 if(cell.changeRatio===0)return '变化率 0.00%';
 const formatted=cell.roundedChangePercent??formatOperatingPercent(Math.abs(cell.changeRatio));
 return (cell.changeRatio>0?'增幅 ':'降幅 ')+(formatted==='0.00%'?'不足 0.01%':formatted);
}
function valueLabel(complete:boolean,value:number|null){return complete?'完整值':value===null?'无可用值':'已填小计';}
function definitionLabel(label:string|null,definition:string|null){return label?label+(definition?' · '+definition:''):'该期无此字段';}
function defaultColumn(sheet:ComparisonSheet){return sheet.columns.find(c=>c.key==='revenue')||sheet.columns.find(c=>c.key==='verifiedAmount')||sheet.columns.find(c=>c.format==='moneyCents')||sheet.columns[0];}
function correctionMonths(value:PreparedOperatingComparison):string{
 const months=new Set<string>();
 for(const period of [value.periods.current,value.periods.previous]){
  for(let month=period.start.slice(0,7);month<=period.end.slice(0,7);){months.add(month);const [year,index]=month.split('-').map(Number);month=new Date(Date.UTC(year,index,1)).toISOString().slice(0,7);}
 }
 return [...months].sort().join('、');
}
type ReportRequest=(body:any)=>Promise<any>;
function ChangeReason({value,request}:{value:PreparedOperatingComparison;request:ReportRequest}){
 const [open,setOpen]=useState(false),[result,setResult]=useState<ComparisonReason|null|undefined>(),[error,setError]=useState('');
 const pending=useRef(false),period=comparisonReasonPeriod(value.periods);
 if(!period)return null;
 async function read(){
  if(pending.current)return;
  pending.current=true;setError('');setOpen(true);
  try{setResult(await loadOperatingComparisonReason(request,value));}
  catch(e){setError(e instanceof Error?e.message:'暂时无法读取说明');}
  finally{pending.current=false;}
 }
 return <div className="oc-coverage">
  <button className="op-button" type="button" aria-expanded={open} onClick={()=>open?setOpen(false):result!==undefined?setOpen(true):void read()}>{open?'收起项目变化原因':'查看员工填写的变化原因'}</button>
  {open&&<section aria-label="本期项目变化原因" aria-live="polite"><h3>{period.kind==='weekly'?'项目周报':'项目月报'} · 经营变化原因</h3><p>{value.projectName} · {period.start} 至 {period.end}</p>
   {error?<><p>项目说明未能读取。{error}</p><button type="button" className="op-button" onClick={()=>void read()}>重新读取说明</button></>:result===undefined?<p>正在读取已确认的项目报表…</p>:result===null?<p>本期暂无已确认的项目变化原因。</p>:<><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.text}</p><p>已确认 V{result.version} · {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(result.confirmedAt))}</p></>}
  </section>}
 </div>;
}
export default function OperatingComparison({value,preferredSheet,reportRequest}:{value:PreparedOperatingComparison;preferredSheet?:string;reportRequest?:ReportRequest}){
 const[sheetId,setSheetId]=useState(preferredSheet||'revenue'),[columnKey,setColumnKey]=useState('');
 const sheet=value.sheets.find(s=>s.sheet===sheetId)||value.sheets.find(s=>s.sheet==='revenue')||value.sheets[0];
 const range=(p:{start:string;end:string})=>p.start+' — '+p.end;
 if(!sheet)return <section className="oc-comparison"><h3>两期暂无可比较的已确认经营数据</h3><p>{value.periods.mode==='week'?'本周周一至截止日':'本期'}：{range(value.periods.current)}；{value.periods.mode==='week'?'上周同星期范围':'上期'}：{range(value.periods.previous)}。</p><p>请先录入历史数据并由另一人确认，再打开数字对比。{value.periods.mode==='week'?'周比较只合计逐日事实，月初累计快照不作为周发生额。':''}月目标不作为经营发生额参与比较。</p></section>;
 const column=sheet.columns.find(c=>c.key===columnKey)||defaultColumn(sheet),cell=sheet.total.cells.find(c=>c.key===column.key)!;
 const changedDefinition=column.currentLabel!==column.previousLabel||column.currentDefinition!==column.previousDefinition;
 const rows=[...sheet.rows].sort((a,b)=>{const ca=a.cells.find(c=>c.key===column.key)!,cb=b.cells.find(c=>c.key===column.key)!;return(ca.difference===null?1:0)-(cb.difference===null?1:0)||Math.abs(cb.difference||0)-Math.abs(ca.difference||0)||a.name.localeCompare(b.name,'zh-CN');});
 return <section className="oc-comparison" aria-label="已确认经营数字对比"><div className="oc-scope"><span><ShieldCheck size={17}/>只比较已确认快照</span><strong>{value.projectName}</strong></div>
  <div className="oc-periods"><div><small>{value.periods.mode==='week'?'上周同星期范围':'上期'}</small><strong>{range(value.periods.previous)}</strong><p>{sheet.previousCoverage.source==='手工累计快照'?'已确认整段累计快照':sheet.previousCoverage.source+' · '+sheet.previousCoverage.reported+'/'+sheet.previousCoverage.expected+' 天有记录'}</p></div><ArrowLeftRight size={20}/><div><small>{value.periods.mode==='week'?'本周周一至截止日':'本期'}</small><strong>{range(value.periods.current)}</strong><p>{sheet.currentCoverage.source==='手工累计快照'?'已确认整段累计快照':sheet.currentCoverage.source+' · '+sheet.currentCoverage.reported+'/'+sheet.currentCoverage.expected+' 天有记录'}</p></div></div>
  <p className="oc-method">{!value.periods.comparable?'区间无法对齐，仅展示数值，不计算涨跌。':value.periods.mode==='week'?'本周周一至截止日，对比上周周一至相同星期；只合计逐日事实，月初累计快照不作为周发生额。':value.periods.mode==='full-month'?'完整月份对比，两个月自然天数可能不同。':'月初至同日累计对比。'}总业绩与平台数据分别比较，不相加。</p>
  {(value.sheets.length>1||sheet.columns.length>1)&&<div className="oc-filters"><label>对比报表<select aria-label="对比报表" value={sheet.sheet} onChange={e=>{setSheetId(e.target.value);setColumnKey('');}}>{value.sheets.map(s=><option key={s.sheet} value={s.sheet}>{s.name}{value.sheets.filter(v=>v.name===s.name).length>1?' · '+s.sheet:''}</option>)}</select></label><label>对比指标<select aria-label="对比指标" value={column.key} onChange={e=>setColumnKey(e.target.value)}>{sheet.columns.map(c=><option key={c.key} value={c.key}>{c.label}{c.currentLabel===null?' · 仅上期':c.previousLabel===null?' · 仅本期':''}{c.key.startsWith('metric:')?' · 自动计算':''}</option>)}</select></label></div>}
  {changedDefinition?<div className="oc-definition"><p>上期指标 · {definitionLabel(column.previousLabel,column.previousDefinition)}</p><p>本期指标 · {definitionLabel(column.currentLabel,column.currentDefinition)}</p></div>:column.definition&&<p className="oc-definition">{column.label} · {column.definition}</p>}
  <div className="oc-numbers" aria-label="整体对比"><div><span>上期{valueLabel(cell.previousComplete,cell.previous)}</span><strong>{display(cell.previous,cell.previousFormat)}</strong></div><div><span>本期{valueLabel(cell.currentComplete,cell.current)}</span><strong>{display(cell.current,cell.currentFormat)}</strong></div><div className={cell.difference===null?'oc-unavailable':'oc-difference'}><span>{value.periods.mode==='week'?'较上周同期':'较上期'}</span><strong>{cell.difference===null?'暂不计算':difference(cell,column)}</strong><small>{growth(cell,column)}</small></div></div>
  {reportRequest&&<ChangeReason key={[value.companyId,value.projectId,value.periods.mode,value.periods.current.end,value.revision].join('/')} value={value} request={reportRequest}/>}
  {cell.reasons.length>0&&<div className="oc-reasons" role="status"><TriangleAlert size={19}/><div><strong>暂不据此判断涨跌</strong>{cell.reasons.map(reason=><p key={reason}>{reason}</p>)}</div></div>}
  {sheet.notes.map(note=><p className="oc-note" key={note}>{note}</p>)}
  <details className="oc-coverage"><summary>核对两期缺报日期</summary><p>上期：{sheet.previousCoverage.source==='手工累计快照'?'采用整段累计快照，不据此判断逐日填报是否完整。':sheet.previousCoverage.missingDates.join('、')||'没有整日缺报；仍须核对字段完整性。'}</p><p>本期：{sheet.currentCoverage.source==='手工累计快照'?'采用整段累计快照，不据此判断逐日填报是否完整。':sheet.currentCoverage.missingDates.join('、')||'没有整日缺报；仍须核对字段完整性。'}</p></details>
  <h3>门店 / 渠道差异</h3>{rows.length?<><p className="oc-method">按固定编号配对，已可比较的差额按绝对值排序。改名仍保留上期名称；新门店不按上期0计算。</p><div className="oc-table-scroll" role="region" aria-label="经营数字门店差异，可横向滚动" tabIndex={0}><table><thead><tr><th>门店 / 范围</th><th>上期</th><th>本期</th><th>较上期变化</th><th>变化 / 说明</th></tr></thead><tbody>{rows.map(row=>{const c=row.cells.find(c=>c.key===column.key)!;return <tr key={row.id}><th scope="row">{row.name}{row.previousName&&row.previousName!==row.name&&<small>上期：{row.previousName}</small>}</th><td>{display(c.previous,c.previousFormat)}{!c.previousComplete&&c.previous!==null&&<small>已填小计</small>}</td><td>{display(c.current,c.currentFormat)}{!c.currentComplete&&c.current!==null&&<small>已填小计</small>}</td><td>{difference(c,column)}</td><td>{c.reasons.length?<span className="oc-row-reason">{c.reasons.join('；')}</span>:growth(c,column)}</td></tr>;})}</tbody></table></div></>:<p className="oc-note">这张表只有项目 / 平台总数，不能反推门店。平台有逐日门店明细时，可选择对应“门店累计”对比。</p>}
  <footer className="oc-footer">读取于 {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(value.preparedAt))} · 本次对比保持不变。{value.pendingChanges>0?'本次读取涉及的完整月份（'+correctionMonths(value)+'）共有 '+value.pendingChanges+' 条记录正在更正，可能包含对比日期范围外的记录；对比继续采用旧确认版。':''}<br/>变化率以上期为基数。金额按分合计，比率用合计后的分子除以分母。</footer>
 </section>;
}
