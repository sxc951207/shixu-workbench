'use client';
import React,{useEffect,useRef,useState}from'react';
import ReportBriefPicker from './report-brief-picker';
import{Link2}from'lucide-react';
import{companyRequest as api}from'../cloud/company-root';
import{reportPeriodLabel}from'../lib/workbench/report-period';
import{readReportDraft,writeReportDraft,removeReportDraft,type ReportDraftForm,type ReportDraftIdentity}from'../lib/workbench/report-local-draft';
import type{PeriodReport}from'../cloud/company/model';

const storage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value),removeItem:(key:string)=>window.localStorage.removeItem(key)};
const dates=(value:string|number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
type Props={owner?:boolean;companyId:string;login:string;report:PeriodReport;busy:boolean;onBusy:(b:boolean)=>void;onSave:(v:any)=>Promise<boolean>;onDirty:()=>void;discardDraftRef:React.MutableRefObject<(()=>void)|null>};

export default function ProjectReportEditor({owner=false,companyId,login,report,busy,onBusy,onSave,onDirty,discardDraftRef}:Props){
 const identity=useRef<ReportDraftIdentity>({companyId,login,reportId:report.id,projectId:report.projectId,kind:report.kind,start:report.start,end:report.end}).current;
 const[form,setForm]=useState<ReportDraftForm>({progress:report.progress===null?'':String(report.progress),achievement:report.achievement,risk:report.risk,next:report.next,help:report.help,changeReason:report.changeReason??'',sourceVersions:report.sourceVersions});
 const[pending,setPending]=useState(()=>readReportDraft(storage,identity)),[savedAt,setSavedAt]=useState(0),[localError,setLocalError]=useState(''),[saving,setSaving]=useState(false);
 const formRef=useRef(form),pendingRef=useRef(pending),touched=useRef(false),suppressed=useRef(false),mounted=useRef(false),savingRef=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const[sources,setSources]=useState<any[]|null>(null),[cursor,setCursor]=useState<number|undefined>(),[pin,setPin]=useState<number|undefined>(),[sourceError,setSourceError]=useState('');
 function cancelTimer(){if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}}
 function persist(notify=true){
  if(!touched.current||suppressed.current||pendingRef.current)return;
  const now=Date.now(),result=writeReportDraft(storage,identity,report.version,formRef.current,now);
  if(notify&&mounted.current){setLocalError(result.error||'');if(result.ok)setSavedAt(now);}
 }
 function change(next:ReportDraftForm){formRef.current=next;touched.current=true;setForm(next);onDirty();cancelTimer();timer.current=setTimeout(()=>{timer.current=null;persist();},350);}
 function discard(){suppressed.current=true;cancelTimer();removeReportDraft(storage,identity);}
 useEffect(()=>{
  mounted.current=true;discardDraftRef.current=discard;
  const flush=()=>persist(),hidden=()=>{if(document.visibilityState==='hidden')flush();};
  window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
  return()=>{mounted.current=false;cancelTimer();persist(false);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);if(discardDraftRef.current===discard)discardDraftRef.current=null;};
 },[]);
 function resolvePending(restore:boolean){
  const draft=pendingRef.current;if(!draft)return;
  if(restore&&draft.baseVersion!==report.version)return;
  pendingRef.current=null;setPending(null);
  if(restore)change({...draft.form,changeReason:draft.form.changeReason??report.changeReason??''});else{removeReportDraft(storage,identity);setSavedAt(0);setLocalError('');}
 }
 async function save(){
  if(busy||savingRef.current||pendingRef.current)return;
  cancelTimer();persist();suppressed.current=true;savingRef.current=true;setSaving(true);
  try{
   const ok=await onSave({...formRef.current,progress:formRef.current.progress===''?null:Number(formRef.current.progress)});
   if(ok)removeReportDraft(storage,identity);else{suppressed.current=false;persist();}
  }catch{suppressed.current=false;persist();if(mounted.current)setLocalError('云端保存未成功，请保留当前文字后重试。');}
  finally{savingRef.current=false;if(mounted.current)setSaving(false);}
 }
 async function references(reset=true){onBusy(true);setSourceError('');let found=reset?[]:[...(sources||[])],next=reset?undefined:cursor,version=reset?undefined:pin;try{for(let n=0;n<10&&(next===undefined||next>0)&&found.length<40;n++){const r=await api({action:'report.sources',companyId,id:report.id,cursor:next,projectVersion:version});version=r.projectVersion;found.push(...r.sources);next=r.cursor;}setSources(found.slice(0,40));setCursor(next);setPin(version);}catch(e){setSourceError((e as Error).message);}finally{onBusy(false);}}
 return <form onSubmit={e=>{e.preventDefault();void save();}}>
  {pending&&<aside className="co-warning co-report-draft" aria-label="发现本机报表草稿"><strong>发现尚未保存到云端的本机副本</strong><p>{dates(pending.savedAt)} · 仅此设备、当前账号可恢复，保留7天。</p><p>{pending.baseVersion===report.version?'可以恢复后继续编辑，或舍弃副本使用云端内容。':`云端已更新为 V${report.version}，本机副本基于 V${pending.baseVersion}。请展开核对并复制需要的文字，再舍弃副本手动合并；不会自动覆盖云端。`}</p><details><summary>查看本机副本内容</summary>{[['本期项目进度（%）',pending.form.progress],['本期成果',pending.form.achievement],...(pending.form.changeReason?[['经营变化原因',pending.form.changeReason]]:[]),['风险与阻碍',pending.form.risk],['下期计划',pending.form.next],['需要协调',pending.form.help]].map(([label,value])=><label key={label}>{'本机副本：'+label}<textarea readOnly rows={3} value={value}/></label>)}</details><div className="co-card-actions">{pending.baseVersion===report.version&&<button type="button" className="co-primary" disabled={busy} onClick={()=>resolvePending(true)}>恢复本机副本</button>}<button type="button" className="co-text" disabled={busy} onClick={()=>resolvePending(false)}>舍弃本机副本，使用云端版本</button></div></aside>}
  <fieldset disabled={busy||saving||!!pending}><p className="co-muted">{report.projectName} · {reportPeriodLabel(report)}</p><ReportBriefPicker owner={owner} report={report} login={login} form={form} change={change} disabled={busy||saving||!!pending}/>{report.kind!=='daily'&&<><div className="co-report-reference"><button className="co-text" type="button" onClick={()=>void references(true)}><Link2 size={15}/>查看本期已确认项目进度</button>{sourceError&&<p className="co-error" role="alert">{sourceError}</p>}{sources!==null&&<><p className="co-muted">{sources.length?'找到 '+sources.length+' 条已确认进度，可带入最新一条再整理本期总结。':'暂未找到本期已确认进度，可以直接手动填写。'}{sources.length>=40?'当前显示最近40条。':''}</p>{sources.length>0&&<><button className="co-text" type="button" onClick={()=>{const latest=sources[0];change({...form,progress:String(latest.progress),achievement:latest.achievement,risk:latest.risk,next:latest.next,sourceVersions:sources.map(x=>x.version)});}}>带入最新一条到草稿</button><details><summary>查看参考记录</summary>{sources.map(s=><div className="co-source-entry" key={s.version}><strong>{dates(s.at)} · {s.progress}%</strong><p>{s.achievement}</p></div>)}</details></>}{!!cursor&&sources.length<40&&<button type="button" className="co-text" onClick={()=>void references(false)}>继续查找较早记录</button>}</>}</div><label>本期项目进度（%）<input type="number" min={0} max={100} value={form.progress} onChange={e=>change({...form,progress:e.target.value})}/></label></>}<label>{report.kind==='daily'?'今日完成':'本期成果'}<textarea rows={5} maxLength={8000} value={form.achievement} onChange={e=>change({...form,achievement:e.target.value})}/></label><details className="co-report-reason"><summary>风险、下一步与补充说明{form.risk||form.next||form.help||form.changeReason?' · 已填写':''}</summary>{report.kind!=='daily'&&<label>经营变化原因（选填）<textarea rows={3} maxLength={4000} value={form.changeReason??''} onChange={e=>change({...form,changeReason:e.target.value})}/></label>}<label>风险与阻碍<textarea rows={3} maxLength={4000} value={form.risk} onChange={e=>change({...form,risk:e.target.value})}/></label><label>{report.kind==='daily'?'下一步':'下期计划'}<textarea rows={3} maxLength={4000} value={form.next} onChange={e=>change({...form,next:e.target.value})}/></label><label>需要协调<textarea rows={3} maxLength={4000} value={form.help} onChange={e=>change({...form,help:e.target.value})}/></label></details><small className="co-muted">{savedAt?'本机副本已保留于 '+dates(savedAt)+'，尚未保存到云端。':'编辑内容会尝试保留本机副本；请及时保存到云端。'}本机副本保留7天，清理浏览器数据会移除。保存为草稿后，可在列表提交主管；草稿不会进入领导汇总。</small>{localError&&<p className="co-error" role="alert">{localError}</p>}<button className="co-primary">{saving?'正在保存…':'保存报表草稿'}</button></fieldset>
 </form>;
}
