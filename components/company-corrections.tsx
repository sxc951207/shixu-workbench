'use client';
import React,{useCallback,useEffect,useState} from 'react';
import {ChevronDown,History,RefreshCw} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {CorrectionItem} from '../cloud/company/corrections';
import CompanyDayOverview,{type MeetingViewProps} from './company-day-overview';
import '../app/company-corrections.css';

type Props={companyId:string;revision:number;request?:(body:any)=>Promise<any>;onRevision?:(revision:number|null)=>void};
const confirmedTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'});
export default function CompanyCorrections(props:Props){return <CorrectionFeed key={props.companyId} {...props}/>;}

export function CompanySummaryTools({companyId,revision,children,request,...meeting}:MeetingViewProps&{companyId:string;revision:number;children:React.ReactNode;request?:Props['request']}){
 const [observed,setObserved]=useState<number|null>(revision);
 const onRevision=useCallback((next:number|null)=>setObserved(previous=>next===null?null:Math.max(previous??0,next)),[]);
 return <div className="co-brief-tools">
  <CompanyDayOverview {...meeting} request={request} companyId={companyId} revision={Math.max(revision,observed??0)} paused={observed===null}/>
  {children}
  <CompanyCorrections request={request} companyId={companyId} revision={revision} onRevision={onRevision}/>
 </div>;
}

function CorrectionFeed({companyId,revision,request=companyRequest,onRevision}:Props){
 const [items,setItems]=useState<CorrectionItem[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true,sequence=0,timer:ReturnType<typeof setTimeout>|undefined;
  async function read(){
   const id=++sequence;
   try{
    const response=await request({action:'corrections.recent',companyId});
    if(!active||id!==sequence)return;
    if(response.companyId!==companyId||!Number.isSafeInteger(response.companyRevision)||!Array.isArray(response.items)||response.items.length>12||response.items.some((item:CorrectionItem)=>item.companyId!==companyId))throw Error('更正动态范围无法核对');
    if(response.companyRevision<revision)throw Error('更正动态版本已过期，请重试');
    onRevision?.(response.companyRevision);setItems(response.items);setError('');
   }catch(e){if(active&&id===sequence){onRevision?.(null);setItems(null);setError(e instanceof Error?e.message:'暂时无法读取');}}
  }
  function refreshOnReturn(){
   if(document.visibilityState==='hidden')return;
   clearTimeout(timer);timer=setTimeout(()=>void read(),120);
  }
  void read();document.addEventListener('visibilitychange',refreshOnReturn);window.addEventListener('focus',refreshOnReturn);
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',refreshOnReturn);window.removeEventListener('focus',refreshOnReturn);};
 },[companyId,revision,request,retry,onRevision]);
 if(items?.length===0&&!error)return null;
 return <section className="co-corrections" aria-label="近期已生效更正">
  <div className="co-corrections-head"><History size={19} aria-hidden="true"/><h2>近期已生效更正</h2>{items&&items.length>0&&<small>最近 {items.length} 条</small>}</div>
  {error?<p role="status">动态未能读取。{error} <button type="button" className="co-text" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={14}/>重试</button></p>:items===null?<p role="status">正在读取已确认的更正…</p>:<ul>{items.map(item=><li key={item.id}><details>
   <summary><span><strong>{item.projectName}</strong> · {item.title}</span><span className="co-corrections-meta"><time dateTime={item.confirmedAt}>{confirmedTime.format(new Date(item.confirmedAt))}</time><span>已生效 V{item.version}</span><ChevronDown size={15} aria-hidden="true"/></span></summary>
   <div className="co-corrections-detail">
    <p>业务期间　{item.start===item.end?item.start:item.start+' 至 '+item.end}</p>
    <p>确认版本　V{item.previousVersion} → V{item.version}</p>
    <p>{item.changedFields.length?'变更字段　'+item.changedFields.join('、'):'本次重新确认保留了原有业务字段值。'}</p>
    {item.reason&&<p>更正原因　{item.reason}</p>}
   </div>
  </details></li>)}</ul>}
 </section>;
}
