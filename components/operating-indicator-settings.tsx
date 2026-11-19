'use client';
import React,{useEffect,useRef,useState} from 'react';
import {companyRequest as api} from '../cloud/company-root';
import type {OperatingConfig} from '../cloud/company/operating-model';
import IndicatorAdditionForm,{type IndicatorAddition} from './operating-indicator-addition';
import OperatingTemplateLibrary from './operating-template-library';

type ProjectChoice={id:string;name:string;enabled:boolean};
type Proposal={id:string;status:'submitted'|'returned';submittedBy:string;submittedName:string;comment:string;config:OperatingConfig};
type Definition={project:ProjectChoice;config:OperatingConfig|null;proposal:Proposal|null;companyRevision:number;permissions:{indicatorMode:'employee'|'supervisor'|'admin'|'leader';reviewIndicators:boolean}};
import type {UploadCandidate} from './operating-project-upload';
type Props={uploadCandidate?:UploadCandidate;focusStores?:boolean;companyId:string;initialId?:string;month:string;dirty:boolean;busy:boolean;onDirty:(dirty:boolean)=>void;onBusy:(busy:boolean)=>void;onSaved:(revision:number,message:string,sheet?:string)=>void};

function ProposalContents({config,active}:{config:OperatingConfig;active:OperatingConfig|null}){
 return <section className="op-proposal-preview" aria-label="候选指标明细">
  {(config.templates||[]).map(template=>{
   const prior=active?.templates?.find(t=>t.id===template.id);
   return <details key={template.id} open><summary><strong>{template.name}</strong> · {prior?'已有模板':'新模板'} · {template.active?'启用':'停用'}</summary>
    <p>{template.description} {template.dimension==='total'?'按项目总数填写':'按'+(config.dimensionLabel||'门店')+'分行填写'} · {template.fields.length} 个字段，{template.metrics.length} 个公式</p>
    <ul>{template.fields.map(f=><li key={f.key}><strong>{f.label}</strong> · {f.kind==='count'?'数量':f.kind==='money'?'金额（元）':'星级'} · {f.required?'必填':'选填'}{!prior?.fields.some(old=>old.key===f.key)&&' · 新增'}<br/>{f.definition||'历史字段未记录释义'}</li>)}
    {template.metrics.map(m=><li key={m.key}><strong>{m.label}</strong> = {template.fields.find(f=>f.key===m.numerator)?.label} ÷ {template.fields.find(f=>f.key===m.denominator)?.label} · {m.format==='percent'?'百分比':m.format==='money'?'每单位金额（元）':'倍数'}</li>)}</ul>
   </details>;
  })}
  {!!config.stores.length&&<p>{config.dimensionLabel||'门店'}：{config.stores.map(s=>s.name).join('、')}</p>}
 </section>;
}
export default function OperatingIndicatorSettings({uploadCandidate,focusStores,companyId,initialId,month,dirty,busy,onDirty,onBusy,onSaved}:Props){
 const [projects,setProjects]=useState<ProjectChoice[]|null>(null),[id,setId]=useState(''),[detail,setDetail]=useState<Definition|null>(null);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0),[listRetry,setListRetry]=useState(0);
 const [panel,setPanel]=useState<'default'|'library'|'append'>('default'),[decision,setDecision]=useState<'approve'|'add'|'return'>('approve'),[comment,setComment]=useState('');
 const saving=useRef(false),adopted=useRef<string>(undefined);
 const [useActive,setUseActive]=useState(false);
 useEffect(()=>{let live=true;setError('');setProjects(null);void api({action:'ops.options',companyId,scope:'indicators'}).then(result=>{
  if(!live)return;const list=result.projects as ProjectChoice[];setProjects(list);
  if(initialId&&!list.some(p=>p.id===initialId)){setId('');setError('当前账号没有所选项目的指标配置权限。');}
  else setId(initialId||list[0]?.id||'');
 }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[companyId,initialId,listRetry]);
 useEffect(()=>{if(!id)return;let live=true;setDetail(null);setError('');setPanel('default');setUseActive(false);setDecision('approve');setComment('');
  void api({action:'ops.month',companyId,scope:'indicators',projectId:id,month}).then(result=>{if(live)setDetail(result);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
 },[companyId,id,month,retry]);
 function canLeave(){return !dirty||window.confirm('切换将放弃本次未保存的指标设置，继续吗？');}
 function chooseProject(next:string){if(!canLeave())return;onDirty(false);setDetail(null);setError('');setId(next);}
 function choosePanel(next:typeof panel){if(!canLeave())return;onDirty(false);setPanel(next);}
 async function save(body:Record<string,unknown>,message:string){
  if(!detail||saving.current)return;saving.current=true;onBusy(true);setError('');
  try{const result=await api({companyId,projectId:id,revision:detail.companyRevision,...body});onDirty(false);
   const saved=Array.isArray(body.templates)&&body.templates.some(t=>t.id===adopted.current&&t.active);
   onSaved(result.companyRevision,message,saved?adopted.current:undefined);}
  catch(e){setError((e as Error).message);}
  finally{saving.current=false;onBusy(false);}
 }
 function review(approve:boolean,addition?:IndicatorAddition){
  if(!detail?.proposal)return;
  void save({action:'ops.reviewIndicators',proposalId:detail.proposal.id,approve,...(!approve?{comment:comment.trim()}:{}),...(addition?{addition}:{})},approve?'指标配置已确认，已启用的模板可用于新记录。':'指标配置已退回，提交人可根据意见修改后重新提交。');
 }
 const proposal=detail?.proposal,mode=detail?.permissions.indicatorMode,employee=mode==='employee',leader=mode==='leader',manager=mode==='admin'||mode==='supervisor';
 const reviewing=!!detail?.permissions.reviewIndicators&&proposal?.status==='submitted';
 const library=employee||manager&&(panel==='library'||panel==='default'&&(!!uploadCandidate||focusStores||!detail?.config?.templates?.some(t=>t.active)));
 const editCandidate=employee&&!useActive&&proposal?.status==='returned'?proposal.config:detail?.config||null;
 return <div className="op-indicator-settings">
  <label className="op-indicator-project">配置项目<select aria-label="配置项目" disabled={busy||!!uploadCandidate||!projects?.length} value={id} onChange={e=>chooseProject(e.target.value)}>
   {!id&&<option value="">{projects?.length?'请选择项目':'暂无项目'}</option>}{projects?.map(p=><option key={p.id} value={p.id}>{p.name}{!p.enabled?(p.id===id&&proposal?.status==='submitted'?' · 待主管核实':' · 尚未配置'):''}</option>)}
  </select></label>
  {uploadCandidate&&<details><summary>查看原表数据预览</summary><div className="op-table-wrap"><table className="op-table"><thead><tr>{uploadCandidate.source.rows[uploadCandidate.source.header].map((v,i)=><th key={i}>{String(v??'')}</th>)}</tr></thead><tbody>{uploadCandidate.source.rows.slice(uploadCandidate.source.header+1,uploadCandidate.source.header+4).map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{String(v??'—')}</td>)}</tr>)}</tbody></table></div></details>}
  {error&&<p className="co-error" role="alert">{error} <button type="button" className="co-text" disabled={busy} onClick={()=>{if(!canLeave())return;onDirty(false);if(id)setRetry(n=>n+1);else setListRetry(n=>n+1);}}>重新读取</button></p>}
  {!error&&!projects&&<p role="status">正在读取可配置项目…</p>}
  {projects?.length===0&&<p>当前没有可配置指标的项目。员工可为已分配的项目提交方案，主管可核实所负责项目的方案。</p>}
  {!error&&id&&!detail&&<p role="status">正在读取项目指标…</p>}
  {detail&&<>
   {proposal&&<section className="op-template-designer"><h3>{proposal.status==='submitted'?'待主管核实的指标配置':'已退回的指标配置'}</h3>
    <p>{proposal.submittedName} 提交。{proposal.status==='returned'?'退回意见：'+proposal.comment:'主管确认后，新配置才会生效。'}</p>
    <ProposalContents config={proposal.config} active={detail.config}/>
    {employee&&proposal.status==='returned'&&<button type="button" className="op-button" onClick={()=>{if(canLeave()){onDirty(false);setUseActive(!useActive);}}}>{useActive?'继续修改退回的方案':'从当前生效配置重新编辑'}</button>}
    {reviewing&&<><div className="op-mode-tabs" role="group" aria-label="处理指标方案">
     <button type="button" disabled={busy} aria-pressed={decision==='approve'} onClick={()=>{if(canLeave()){onDirty(false);setDecision('approve');}}}>采用员工方案</button>
     <button type="button" disabled={busy||!proposal.config.templates?.some(t=>t.active)} aria-pressed={decision==='add'} onClick={()=>{if(canLeave()){onDirty(false);setDecision('add');}}}>补充指标后确认</button>
     <button type="button" disabled={busy} aria-pressed={decision==='return'} onClick={()=>{if(canLeave()){onDirty(false);setDecision('return');}}}>退回给提交人</button>
    </div>{decision==='return'&&<label className="op-indicator-project">退回原因<textarea rows={2} disabled={busy} maxLength={1000} value={comment} onChange={e=>{setComment(e.target.value);onDirty(true);}}/></label>}
    {decision==='add'?<IndicatorAdditionForm key={proposal.id} config={proposal.config} busy={busy} review onDirty={()=>onDirty(true)} onSave={a=>review(true,a)}/>:<button type="button" className="co-primary" disabled={busy||decision==='return'&&!comment.trim()} onClick={()=>review(decision!=='return')}>{decision==='return'?'确认退回方案':'确认并启用指标'}</button>}</>}
   </section>}
   {!reviewing&&!(employee&&proposal?.status==='submitted')&&<>
    {manager&&<div className="op-mode-tabs" role="group" aria-label="项目指标操作"><button type="button" disabled={busy} aria-pressed={library} onClick={()=>choosePanel('library')}>项目模板库</button><button type="button" disabled={busy} aria-pressed={!library} onClick={()=>choosePanel('append')}>追加指标</button></div>}
    {library?<OperatingTemplateLibrary uploadCandidate={uploadCandidate} onAdoptUpload={id=>{adopted.current=id;}} focusStores={focusStores} key={id+':'+retry+':'+useActive} own={employee} pending={employee} projectId={id} projectName={detail.project.name} config={editCandidate} activeConfig={detail.config} busy={busy} onDirty={()=>onDirty(true)}
     onSave={value=>void save({action:employee?'ops.proposeIndicators':'ops.configure',...value},employee?'指标方案已提交主管核实。确认后，项目负责人可按新模板填报。':'项目模板已保存。')}/>:
     <section className="op-template-designer"><h3>追加项目指标</h3><p>{leader?'可以补充本公司项目需要跟踪的字段或公式。经营报表仍展示已确认的数字。':'可以给已有模板新增字段或公式，也可以建立独立的补充指标表。'}</p>
      <IndicatorAdditionForm config={detail.config} busy={busy} onDirty={()=>onDirty(true)} onSave={addition=>void save({action:'ops.appendIndicator',...addition},'已追加指标，新建记录时可使用。')}/></section>}
   </>}
  </>}
 </div>;
}
