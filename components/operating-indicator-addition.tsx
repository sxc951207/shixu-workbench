'use client';
import React,{useState} from 'react';
import type {OperatingConfig,OperatingField,OperatingMetric} from '../cloud/company/operating-model';
import {assertOperatingYuanUnit} from '../lib/workbench/operating-field-dictionary';
import {operatingMetricFormats} from '../lib/workbench/operating-templates';

export type IndicatorAddition={templateId?:string;fields?:OperatingField[];metrics?:OperatingMetric[]};
const formats={percent:'百分比',ratio:'倍数',money:'每单位金额（元）'};

export default function IndicatorAdditionForm({config,busy,review=false,onDirty,onSave}:{
 config:OperatingConfig|null;busy:boolean;review?:boolean;onDirty:()=>void;onSave:(addition:IndicatorAddition)=>void;
}){
 const templates=config?.templates?.filter(template=>template.active)||[];
 const [target,setTarget]=useState(templates[0]?.id||''),[type,setType]=useState<'field'|'metric'>('field');
 const [label,setLabel]=useState(''),[definition,setDefinition]=useState(''),[kind,setKind]=useState<OperatingField['kind']>('count'),[required,setRequired]=useState(false);
 const [numerator,setNumerator]=useState(''),[denominator,setDenominator]=useState(''),[format,setFormat]=useState<OperatingMetric['format']>('percent'),[error,setError]=useState('');
 const [addedFields,setAddedFields]=useState<OperatingField[]>([]),[addedMetrics,setAddedMetrics]=useState<OperatingMetric[]>([]);
 const queued=addedFields.length+addedMetrics.length,template=templates.find(t=>t.id===target);
 const fields=[...(template?.fields||[]),...addedFields],metrics=[...(template?.metrics||[]),...addedMetrics];
 const sources=fields.filter(f=>f.kind!=='stars'),top=numerator||sources[0]?.key||'',bottom=denominator||sources[1]?.key||sources[0]?.key||'';
 const validFormats=operatingMetricFormats(fields,{numerator:top,denominator:bottom}),display=validFormats.includes(format)?format:validFormats[0];
 function save(another:boolean){
  setError('');
  try{
   const name=label.trim(),nextFields=[...addedFields],nextMetrics=[...addedMetrics];
   if(!name&&(!queued||another||definition.trim()))throw Error('请填写指标名称。');
   if(name){
    if([...fields,...metrics].some(item=>item.label===name))throw Error('当前模板已有同名指标，请核对名称。');
    const key=(type==='field'?'field_':'metric_')+crypto.randomUUID().replace(/-/g,'').slice(0,12);
    if(type==='field'){
     if(fields.length>=30)throw Error('每份模板最多可设置30个字段。');
     if(!definition.trim())throw Error('请填写指标释义和数据来源。');
     assertOperatingYuanUnit(name);
     nextFields.push({key,label:name,kind,required,definition:definition.trim()});
    }else{
     if(metrics.length>=10)throw Error('每份模板最多可设置10个自动指标。');
     if(!top||!bottom||!display)throw Error('请选择单位兼容的分子和分母。');
     nextMetrics.push({key,label:name,numerator:top,denominator:bottom,format:display});
    }
   }
   if(another){
    setAddedFields(nextFields);setAddedMetrics(nextMetrics);setLabel('');setDefinition('');setRequired(false);onDirty();
   }else onSave({...(target?{templateId:target}:{}),...(nextFields.length?{fields:nextFields}:{}),...(nextMetrics.length?{metrics:nextMetrics}:{})});
  }catch(e){setError((e as Error).message);}
 }
 return <form className="op-form" onSubmit={event=>{event.preventDefault();save(false);}} onChange={()=>{onDirty();setError('');}}><fieldset disabled={busy}>
  <label>追加到哪张表<select disabled={!!queued} value={target} onChange={e=>{setTarget(e.target.value);setNumerator('');setDenominator('');setType('field');}}>
   {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}{!review&&<option value="">新建项目补充指标表</option>}
  </select></label>
  {!target&&<p className="op-muted">补充表由项目负责人按日填写全项目数字。门店经营套表的固定字段和对账规则保持原有口径。</p>}
  {template&&<details><summary>查看已有字段和公式</summary><ul>{template.fields.map(f=><li key={f.key}>{f.label} · {f.definition||'未记录释义'}</li>)}{template.metrics.map(m=><li key={m.key}>{m.label} = {fields.find(f=>f.key===m.numerator)?.label} ÷ {fields.find(f=>f.key===m.denominator)?.label}</li>)}</ul></details>}
  {!!queued&&<section className="op-note" aria-label="本次待追加指标"><strong>本次待追加 {queued} 项</strong><ul>{[...addedFields,...addedMetrics].map(item=><li key={item.key}>{item.label}</li>)}</ul><button type="button" className="co-text" onClick={()=>{setAddedFields([]);setAddedMetrics([]);onDirty();}}>清空待追加项</button></section>}
  <label>指标类型<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="field">人工填报字段</option><option value="metric" disabled={!sources.length}>自动计算指标</option></select></label>
  <label>新增指标名称<input required={!queued||!!definition.trim()} maxLength={40} value={label} onChange={e=>setLabel(e.target.value)}/></label>
  {type==='field'?<><label>数据类型<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="count">数量（整数）</option><option value="money">金额（元）</option><option value="stars">星级（0–5）</option></select></label>
   <label>指标释义与来源<textarea required={!queued||!!label.trim()} rows={2} maxLength={300} value={definition} onChange={e=>setDefinition(e.target.value)} placeholder="例如，当日首次到店咨询的人数，按手机号去重，来自接待登记表。"/></label>
   <label className="op-daily-confirm"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/>新记录提交前必填</label></>:<>
   <div className="op-config-grid"><label>分子<select value={top} onChange={e=>setNumerator(e.target.value)}>{sources.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label><label>分母<select value={bottom} onChange={e=>setDenominator(e.target.value)}>{sources.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label></div>
   <label>显示方式<select value={display||''} onChange={e=>setFormat(e.target.value as typeof format)}>{validFormats.length?validFormats.map(f=><option key={f} value={f}>{formats[f]}</option>):<option value="">请调整分子与分母的单位</option>}</select></label></>}
  {error&&<p className="co-error" role="alert">{error}</p>}
  <div className="op-form-footer"><p>新增指标用于之后创建的记录。已有记录沿用保存时的字段和公式。</p><button type="button" className="op-button" disabled={!label.trim()} onClick={()=>save(true)}>再加一个指标</button><button className="co-primary" disabled={busy||review&&!target}>{review?'确认并启用指标':'保存追加指标'}</button></div>
 </fieldset></form>;
}
