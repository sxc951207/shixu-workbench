import React,{useState} from 'react';
import type {OperatingField} from '../cloud/company/operating-model';
import {formatOperatingMoney} from '../lib/workbench/operating-paste';

export type AmountChangeResult={total:number|null;rows:{date:string;first:boolean;before:number|null;after:number|null;delta:number|null}[]};
const money=(n:number|null,signed=false)=>n===null?'未齐':(n<0?'−':signed&&n>0?'+':'')+formatOperatingMoney(Math.abs(n));
export default function ConfirmedAmountChange({fields,initial,load}:{fields:OperatingField[];initial:string;load:(field:string)=>Promise<AmountChangeResult>}){
 const [open,setOpen]=useState(false),[field,setField]=useState(initial),[state,setState]=useState<{data?:AmountChangeResult;error?:string}>({});
 const request=React.useRef(0);
 async function read(key:string){
  const ticket=++request.current;
  setState({});
  try{const data=await load(key);if(!Array.isArray(data.rows))throw Error('服务尚未返回批次明细。');if(ticket===request.current)setState({data});}
  catch(e){if(ticket===request.current)setState({error:(e as Error).message});}
 }
 return <section aria-label="累计变化明细"><button type="button" className="co-text" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void read(field);}}>{open?'收起累计变化':'查看累计变化'}</button>
  {open&&<div>{fields.length>1&&<label>金额指标<select value={field} onChange={e=>{setField(e.target.value);void read(e.target.value);}}>{fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>}
  {state.error?<p role="alert">{state.error} <button type="button" className="co-text" onClick={()=>void read(field)}>重试</button></p>:!state.data?<p role="status">正在核对已确认版本…</p>:state.data.rows.length?<><strong>最近确认批次 · {fields.find(f=>f.key===field)?.label}变化 {money(state.data.total,true)} 元</strong>
   <p className="op-muted">按当前截止日，列出该批次仍计入累计的业务日期。更正按前后两次确认的差额计算。</p>
   <div className="op-table-scroll"><table className="op-table"><thead><tr><th>业务日期</th><th>本次确认（元）</th><th>对累计的影响（元）</th></tr></thead><tbody>{state.data.rows.map(r=><tr key={r.date}><th>{r.date}</th><td>{money(r.after)}</td><td>{money(r.delta,true)} · {r.first?'首次计入':'此前 '+money(r.before)}</td></tr>)}</tbody></table></div></>:<p>截至所选日期暂无已确认金额。</p>}</div>}
 </section>;
}
