'use client';
import React,{useState} from 'react';
import {FileUp} from 'lucide-react';
import OperatingSpreadsheetImport from './operating-spreadsheet-import';
import type {OperatingStore} from '../cloud/company/operating-model';
import {inspectUpload,destinationSignature,type Destination,type UploadSource} from '../lib/workbench/operating-upload-route';
import {inferOperatingTemplate,inferScreenshotTemplate} from '../lib/workbench/operating-template-inference';

import {dailyReportSections} from '../lib/workbench/operating-row-layout';

export type UploadCandidate={result:ReturnType<typeof inferOperatingTemplate>;source:UploadSource;name:string};
type Pending={sheet:string;source:UploadSource};
const volatile=new Map<string,Pending[]>();
function pending(key:string):Pending[]{
 if(volatile.has(key))return volatile.get(key)!;
 try{const raw=sessionStorage.getItem(key);if(raw){const items=JSON.parse(raw);if(Array.isArray(items))return items.filter(p=>typeof p?.sheet==='string'&&Array.isArray(p.source?.rows)&&Array.isArray(p.source.rows[p.source.header]));}}catch{}
 return [];
}
export function keepUpload(key:string,sheet:string,source:UploadSource){
 source={...source,rows:source.rows.map(row=>row.map(cell=>cell instanceof Date?cell.toISOString().slice(0,10):cell))};
 const items=[...pending(key).filter(p=>p.sheet!==sheet||p.source.name!==source.name||p.source.tab!==source.tab||JSON.stringify(p.source.rows)!==JSON.stringify(source.rows)),{sheet,source}];
 return writePending(key,items);
}
function writePending(key:string,items:Pending[]){
 volatile.set(key,items);
 try{sessionStorage.setItem(key,JSON.stringify(items, (k,v)=>k==='file'?undefined:v));return true;}catch{try{sessionStorage.removeItem(key);}catch{}return false;}
}
type Props={storageKey:string;options:Destination[];stores:OperatingStore[];date:string;canCreate:boolean;disabled:boolean;onUse:(destination:Destination,source:UploadSource)=>void;onCreate:(candidate:UploadCandidate)=>void};
export default function OperatingProjectUpload({storageKey,options,stores,date,canCreate,disabled,onUse,onCreate}:Props){
 const [sections,setSections]=useState<{source:UploadSource;parts:ReturnType<typeof dailyReportSections>}|null>(null);
 const [periodChoice,setPeriodChoice]=useState<'daily'|'period'|null>(null);
 const [source,setSource]=useState<UploadSource|null>(null),[error,setError]=useState(''),[note,setNote]=useState(''),[open,setOpen]=useState(false),[counter,setCounter]=useState(0);
 let match:ReturnType<typeof inspectUpload>|undefined,issue='';
 if(source)try{match=inspectUpload(source,options,stores,date);}catch(e){issue=(e as Error).message;}
 function memory(signature:string){return storageKey+':mapping:'+signature;}
 function recall(m:NonNullable<typeof match>){
  if(!m.identity)return {};
  try{
   const raw=localStorage.getItem(memory(m.identity));if(!raw)return {};
   const saved=JSON.parse(raw);
   const destination=m.candidates.find(o=>destinationSignature(o)===saved.destination);
   return saved.signature===m.signature&&destination?{destination}:{changed:true};
  }catch{return {};}
 }
 function inspect(file:UploadSource){
  const parts=dailyReportSections(file.rows);
  setSections(parts.length?{source:file,parts}:null);
  setSource(null);setNote('');setError('');
  if(!parts.length)matchSource(file);
 }
 function matchSource(file:UploadSource){
  const m=inspectUpload(file,options,stores,date);setSource(file);setPeriodChoice(null);setError('');setNote('');
  const previous=recall(m);
  if(previous.changed){setNote('这次的表头、范围或模板定义有变化，请重新核对归属。');return;}
  const destination=previous.destination||m.automatic;
  if(destination){setNote('已匹配「'+destination.name+'」。如果归属不对，可关闭预览后在这里改选。');onUse(destination,m.source);}
 }
 function use(d:Destination){
  if(!match)return;
  try{if(match.identity)localStorage.setItem(memory(match.identity),JSON.stringify({signature:match.signature,destination:destinationSignature(d)}));}catch{}
  setError('');onUse(d,match.source);
 }
 function create(){
  if(!match)return;
  try{const s=match.source;const result=(s.image?inferScreenshotTemplate:inferOperatingTemplate)(s.rows,s.header);
   const raw=s.tab||s.name;const name=result.suggestedName||(/^(?:粘贴的截图|codex-clipboard-|sheet\d*\b)/i.test(raw)?result.analysis.fields.slice(0,2).map(f=>f.label).join('与')+'报表':raw);onCreate({result,source:s,name:name.replace(/\.[a-z0-9]+$/i,'').slice(0,60)});setError('');
  }catch(e){setError((e as Error).message);}
 }
 const periodTable=(d:Destination)=>d.sheet.endsWith('-stores')||d.sheet==='targets';
 const askPeriod=!!match&&!match.horizontal&&!match.dated&&match.candidates.some(periodTable)&&match.candidates.some(d=>!periodTable(d));
 const choices=match?.candidates.filter(d=>!askPeriod||periodChoice!==null&&periodTable(d)===(periodChoice==='period'))||[];
 const saved=pending(storageKey);
 return <section className="op-panel" aria-label="按项目上传报表">
  <button type="button" className="op-button" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><FileUp size={16}/>上传报表{saved.length?' · '+saved.length+' 份已保留':''}</button>
  {open&&<><p className="op-muted">上传 Excel 或截图，按这份报表的表头和单位查找项目里的对应表。</p>
   <OperatingSpreadsheetImport referenceDate={date} disabled={disabled} onInspect={inspect} onSourceChange={()=>{setSections(null);setSource(null);setError('');setNote('');}} onUse={()=>{}}/>
   {sections&&<section aria-label="选择原表中的数据区域"><h4>原表里有 {sections.parts.length} 张明细表，请选要导入的一张</h4>
    {sections.parts.map(part=><button type="button" className="op-button" key={part.start} onClick={()=>{
     const s=sections.source;setSource(null);setError('');setNote('');
     try{matchSource({...s,file:undefined,rows:s.rows.slice(part.start,part.end),header:part.header-part.start,tab:(s.tab||s.name)+' · '+part.title});}catch(e){setError((e as Error).message);}
    }}>第 {part.start+1}–{part.end} 行 · {part.title}</button>)}</section>}
   {note&&<p role="status">{note}</p>}
   {match&&<div className="op-template-designer"><strong>{match.horizontal?'这份门店表要录入哪项数据？':askPeriod&&!periodChoice?'表里的金额对应一天，还是一段时间的累计？':match.candidates.length?'这份数据属于哪张表？':'项目里还没有匹配的表'}</strong>
    <p className="op-muted">{match.source.tab||match.source.name} · {match.source.rows[match.source.header]?.filter(v=>String(v??'').trim()).slice(0,8).join(' / ')}</p>
    {askPeriod&&<div role="group" aria-label="原表的统计时间"><button type="button" className="op-button" aria-pressed={periodChoice==='daily'} onClick={()=>setPeriodChoice('daily')}>一天的数</button> <button type="button" className="op-button" aria-pressed={periodChoice==='period'} onClick={()=>setPeriodChoice('period')}>截至某天的累计</button></div>}
    {match.cumulativeOnly&&!choices.length&&<p>原表标了期间累计，当前项目没有对应的累计表。可先预览字段，逐日填报需要原始日明细。</p>}
    {choices.map(d=><button type="button" className="op-button" key={d.sheet} disabled={disabled} onClick={()=>use(d)}>{d.name}</button>)}
    {canCreate&&<button type="button" className="op-button" disabled={disabled} onClick={create}>用这份表建立新模板</button>}
    {!match.candidates.length&&!canCreate&&<p>请项目负责人核对指标配置和你的填报范围。</p>}</div>}
   {(issue||error)&&<p role="alert" className="co-error">{issue||error}</p>}
   {!!saved.length&&<section aria-label="本页保留的原表"><h4>本页保留的原表</h4>{saved.map((p,i)=>{const option=options.find(o=>o.sheet===p.sheet);return <div key={p.sheet+':'+i}><strong>{p.source.tab||p.source.name}</strong> {option?<button type="button" className="op-button" onClick={()=>{try{const m=inspectUpload(p.source,options,stores,date);if(m.cumulativeOnly&&!periodTable(option)){setError('这份原表是期间累计，需要对应的累计表或逐日明细。');return;}onUse(option,m.source);}catch(e){setError((e as Error).message);}}}>继续填报 · {option.name}</button>:<small>等待模板启用或填报授权</small>} <button type="button" className="co-text" onClick={()=>{writePending(storageKey,saved.filter((_,j)=>j!==i));setCounter(counter+1);}}>移除本页副本</button></div>;})}</section>}
  </>}
 </section>;
}
