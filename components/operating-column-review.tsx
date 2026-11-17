'use client';
import React,{useEffect,useRef,useState} from 'react';
import {companyRequest} from '../cloud/company-root';
import type {OperatingSheet} from '../cloud/company/operating-model';
import {applyColumnRules,identifyColumns,type ColumnRules} from '../lib/workbench/operating-column-map';

export type ColumnTask={matrix:unknown[][];header:number;info:NonNullable<ReturnType<typeof identifyColumns>>;confirmed:boolean;dates?:string[]};
export default function OperatingColumnReview({task,scope,disabled,onPreview,onInvalidate}:{task:ColumnTask;scope:{companyId:string;projectId:string;sheet:OperatingSheet};disabled:boolean;onPreview:(matrix:unknown[][])=>void;onInvalidate:()=>void}){
 const [rules,setRules]=useState<ColumnRules>({}),[version,setVersion]=useState(0),[busy,setBusy]=useState(true),[used,setUsed]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const generation=useRef(0),previewRef=useRef(onPreview);previewRef.current=onPreview;
 const {info,matrix,header}=task;
 const payload={...scope,signature:info.signature};
 useEffect(()=>{
  const id=++generation.current;setBusy(true);setUsed(false);setRules({});setError('');
  void companyRequest({...payload,action:'ops.columnRules.read'}).then(state=>{
   if(id!==generation.current)return;
   setVersion(state.version);const saved:ColumnRules=Object.fromEntries(state.rules);setRules(saved);
   if(info.candidates.every(s=>Object.hasOwn(saved,s))){
    previewRef.current(applyColumnRules(matrix,header,info,saved));setUsed(true);
   }
  }).catch(e=>{if(id===generation.current)setError(e.message);}).finally(()=>{if(id===generation.current)setBusy(false);});
  return()=>{generation.current++;};
 },[task,scope.companyId,scope.projectId,scope.sheet,reload]);
 async function confirm(){
  const id=generation.current;setError('');
  try{
   const mapped=applyColumnRules(matrix,header,info,rules);setBusy(true);
   const state=await companyRequest({...payload,action:'ops.columnRules.save',version,rules:info.candidates.map(s=>[s,rules[s]])});
   if(id!==generation.current)return;setVersion(state.version);previewRef.current(mapped);setUsed(true);
  }catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current)setBusy(false);}
 }
 if(used)return <p className="op-note">已沿用本项目的列对应。 <button type="button" className="op-button" disabled={disabled} onClick={()=>{onInvalidate();setUsed(false);}}>调整列对应</button></p>;
 return <section className="op-template-designer" aria-label="原表列对应"><h4>核对原表里的指标</h4><p>已匹配的列会直接读取。下列名称请确认一次，同项目再导入这种表时会自动沿用。</p>
 {info.candidates.map(s=><label key={s}>{s}<select disabled={busy||disabled} value={Object.hasOwn(rules,s)?rules[s]:'?'} onChange={e=>setRules({...rules,[s]:e.target.value})}><option value="?" disabled>选择项目指标</option><option value="">跳过此列</option>{info.available.map(f=><option key={f.key} value={f.key}>{f.label}（{f.kind==='money'?'元':f.kind==='stars'?'星':'数量'}）</option>)}</select></label>)}
 <button type="button" className="op-button" disabled={busy||disabled||info.candidates.some(s=>!Object.hasOwn(rules,s))} onClick={()=>void confirm()}>记住对应并预览</button>
 {error&&<p className="co-error" role="alert">{error} <button type="button" disabled={busy||disabled} onClick={()=>setReload(n=>n+1)}>重新读取</button></p>}</section>;
}
