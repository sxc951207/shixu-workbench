'use client';
import React,{useEffect,useState} from 'react';
import {requestRecords} from '../lib/workbench/client';
import {companyRequest} from '../cloud/company-root';
import type {PeriodReport} from '../cloud/company/model';
import type {ReportDraftForm} from '../lib/workbench/report-local-draft';
import {briefFields,briefSections,describePoint,fieldTitles,taskCandidates,type BriefSource,type BriefField} from '../lib/workbench/report-brief';
type SourceChoice={field:BriefField;text:string;sources:BriefSource[];label?:string};
type Props={owner:boolean;report:PeriodReport;login:string;form:ReportDraftForm;change:(form:ReportDraftForm)=>void;disabled:boolean};
export default function ReportBriefPicker({owner,report,login,form,change,disabled}:Props){
 const daily=report.kind==='daily',sourceName=report.kind==='weekly'?'日报':'周报';
 const [choices,setChoices]=useState<SourceChoice[]>([]),[selected,setSelected]=useState<number[]>([]);
 const [sources,setSources]=useState<BriefSource[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[undo,setUndo]=useState<{before:ReportDraftForm;after:ReportDraftForm}|null>(null);
 const [showAll,setShowAll]=useState(false);
 const active=React.useRef(0);
 useEffect(()=>()=>{active.current++},[]);
 async function read(){
  const seq=++active.current;setLoading(true);setError('');setNotice('');
  try{
   let rows:SourceChoice[]=[],documents:BriefSource[]=[],defaults:number[]=[];
   if(daily){
    const {records}=owner?await requestRecords():await companyRequest({companyId:report.companyId,action:'workspace.records',login});
    rows=taskCandidates(records,report.start).map(task=>({field:task.done?'achievement':'next',text:task.title,sources:[],label:(task.routineId?'每日必做 · ':'')+(task.done?'已办':'待办')}));
   }else{
    let revision:number|undefined,total:number;
    do{
     const page=await companyRequest({action:report.kind==='weekly'?'report.dailySources':'report.weeklySources',companyId:report.companyId,id:report.id,offset:documents.length,revision});
     if(revision!==undefined&&page.companyRevision!==revision||!Array.isArray(page.sources)||!page.sources.length&&page.total>documents.length)throw Error('来源已变化，请重新生成。');
     revision=page.companyRevision;total=page.total;documents.push(...page.sources);
    }while(documents.length<total);
    const grouped=briefSections(documents,report.start,report.end);
    for(const field of briefFields)grouped[field].forEach((point,index)=>{
     if(index<(field==='achievement'?3:2))defaults.push(rows.length);
     rows.push({field,...point,text:describePoint(field,point,report.kind==='weekly'?'weekly':'monthly')});
    });
   }
   if(seq===active.current){setChoices(rows);setSources(documents);setSelected(defaults);setShowAll(false);setOpen(true);}
  }catch(e){if(seq===active.current)setError((e as Error).message);}
  finally{if(seq===active.current)setLoading(false);}
 }
 function apply(){
  const next={...form};
  for(const field of briefFields){
   const original=form[field].trim();
   const lines=new Set(original.split('\n').map(s=>s.trim()));
   const additions=choices.filter((c,i)=>c.field===field&&selected.includes(i)).map(c=>c.text);
   for(const line of additions)lines.add(line);
   if(additions.length)next[field]=[...lines].filter(Boolean).join('\n');
   if(next[field].length>(field==='achievement'?8000:4000)){setError('所选内容超过栏位长度，请减少勾选。');return;}
  }
  setUndo({before:form,after:next});change(next);setOpen(false);setNotice('已带入草稿，可直接编辑。');
 }
 return <section className="co-report-reference" aria-label={daily?'从我的事项填写':'汇总建议稿'}>
  <button type="button" className="co-text" disabled={disabled||loading} onClick={()=>void read()}>{loading?'正在整理…':daily?'选用待办、已办和每日必做':'从已确认'+sourceName+'生成建议稿'}</button>
  {error&&<p className="co-error" role="alert">{error}</p>}{notice&&<p role="status">{notice} {undo&&form===undo.after&&<button type="button" className="co-text" onClick={()=>{change(undo.before);setUndo(null);setNotice('已撤销带入。');}}>撤销</button>}</p>}
  {open&&<><p className="co-muted">{daily?'仅你可见。按事项日期与更新时间推荐，状态取当前记录。核对后，勾选要写进日报的事项。':'本期 '+sources.length+' 份已确认'+sourceName+'，可调整建议要点。跨月周报单独列为参考。'}</p>
   {briefFields.map(field=>{const all=choices.map((c,i)=>({c,i})).filter(({c})=>c.field===field);
    const items=daily||showAll?all:all.slice(0,field==='achievement'?3:2);return items.length>0&&<fieldset key={field}><legend>{fieldTitles[field]}</legend>{items.map(({c,i})=><div key={i}><label style={{display:'flex',alignItems:'baseline',gap:8}}><input style={{width:'auto'}} type="checkbox" checked={selected.includes(i)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,i]:prev.filter(v=>v!==i))}/>{c.label&&c.label+' · '}{c.text}</label>{c.sources.length>0&&<details><summary>查看 {c.sources.length} 份来源</summary>{c.sources.map(s=><p key={s.id}>{s.start} · {s.author} · V{s.version}<br/>{s[field]}</p>)}</details>}</div>)}</fieldset>;})}
   {!daily&&choices.length>0&&<button type="button" className="co-text" onClick={()=>setShowAll(!showAll)}>{showAll?'收起备选要点':'查看全部备选要点'}</button>}
   {sources.filter(s=>s.start<report.start||s.end>report.end).map(s=><details key={s.id}><summary>跨月周报 · {s.start} 至 {s.end} · 仅供核对</summary>{briefFields.map(f=>s[f]&&<p key={f}>{fieldTitles[f]} · {s[f]}</p>)}</details>)}
   {!choices.length&&<p>{daily?'这个日期没有匹配的事项，可以直接写日报。':'没有可以带入的本期要点，可以继续手写。'}</p>}
   <div className="co-card-actions"><button type="button" className="co-primary" onClick={apply} disabled={!selected.length||disabled}>采用所选 {selected.length} 项</button><button type="button" className="co-text" onClick={()=>setOpen(false)}>继续手写</button></div>
  </>}
 </section>;
}
