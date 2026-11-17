'use client';
import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,BarChart3,Check,Database,FileSpreadsheet,Layers3,LockKeyhole,ShoppingBag,Store,Target,UsersRound} from 'lucide-react';
import {operatingFields,operatingSummary,operatingTemplateMetrics,operatingTemplatePresets,parseOperatingInput} from '../lib/workbench/operating-data';
import type {OperatingRecord,OperatingSheet} from '../cloud/company/operating-model';
import {todayShanghai} from '../lib/workbench/domain';
import OperatingWeekExample from './operating-week-example';
import {formatOperatingPercent} from '../lib/workbench/operating-display';
import {formatOperatingMoney} from '../lib/workbench/operating-paste';
import '../app/operating-preview.css';
const examples:Record<string,Record<string,number>>={tpl_leads:{leads:56,validLeads:42,appointments:23,arrivals:18,deals:9,revenue:480000,spend:126000},tpl_ads:{impressions:36000,clicks:1080,leads:54,orders:18,orderAmount:2160000,spend:180000},tpl_ecommerce:{orders:76,orderAmount:2280000,refundAmount:190000,spend:380000}};
const storeExamples=[
 {name:'示例门店A',ordered:2700,verified:2100,spend:210},
 {name:'示例门店B',ordered:3600,verified:2800,spend:280},
 {name:'示例门店C',ordered:4200,verified:3300,spend:330},
];
const number=(v:number|null)=>v===null?'—':v.toLocaleString('zh-CN',{maximumFractionDigits:2});
export default function OperatingPreview(){
 useEffect(()=>{document.title='拾序 · 数据模板体验';},[]);
 const today=todayShanghai(),month=today.slice(0,7);
 const presets=useMemo(()=>operatingTemplatePresets(),[]),[selected,setSelected]=useState('store-suite'),[days,setDays]=useState(()=>Number(today.slice(8))),[dailyEdits,setDailyEdits]=useState<Record<string,Record<string,number>>>({}),[error,setError]=useState('');
 const template=presets.find(t=>t.id===selected),fields=template?operatingFields(template.id as OperatingSheet,template):[];
 const selectedDate=month+'-'+String(days).padStart(2,'0'),editKey=selected+':'+selectedDate;
 const selectedValues=dailyEdits[editKey]||examples[selected];
 const records=useMemo(()=>template?Array.from({length:Number(today.slice(8))},(_,i)=>({id:'op_'+String(i+1).padStart(32,'0'),companyId:'co_000000000000',projectId:'p_'+''.padStart(24,'0'),projectName:'示例项目',sheet:template.id as OperatingSheet,date:month+'-'+String(i+1).padStart(2,'0'),status:'draft',version:1,publishedVersion:0,writerLogin:'owner',reviewerLogin:'manager',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',createdAt:month+'-01T01:00:00.000Z',updatedAt:month+'-01T01:00:00.000Z',rows:[{storeId:'all',storeName:'全项目',values:{...(dailyEdits[template.id+':'+month+'-'+String(i+1).padStart(2,'0')]||examples[template.id])}}],published:null,template}) as OperatingRecord):[],[template,dailyEdits,month,today]);
 const summary=template?operatingSummary(records,template.id as OperatingSheet,month+'-'+String(days).padStart(2,'0')):null;
 const metrics=template?operatingTemplateMetrics(template,summary?.rows[0]?.values||{}):[];
 function change(input:HTMLInputElement,key:string,kind:'money'|'count'|'stars'){
  try{
   const value=parseOperatingInput(input.value,kind);
   if(value===null)throw Error('示例中的字段需要一个数值。');
   if(value>1000000000)throw Error(kind==='money'?'示例金额上限为一千万元。':'示例数值上限为十亿。');
   setDailyEdits(old=>({...old,[editKey]:{...(old[editKey]||examples[selected]),[key]:value}}));
   setError('');
  }catch(cause){
   const previous=selectedValues[key];
   input.value=String(kind==='money'?previous/100:previous);
   setError((cause instanceof Error?cause.message:'数值格式无效。')+' 已恢复该日上次有效的数值。');
  }
 }
 function chooseDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!value.startsWith(month)||value>today)return;
  setDays(Number(value.slice(8)));setError('');
 }
 return <main className="ot-preview">
  <header className="otp-top"><a href="/workbench/?space=company" className="otp-brand"><img src="/workbench/favicon.svg" alt="" width="38" height="38"/><strong>拾序<small>数据模板体验</small></strong></a><a href="/workbench/?space=company">进入我的工作台 <ArrowRight size={16}/></a></header>
  <section className="otp-workspace-hero" aria-labelledby="template-experience-title">
   <div className="otp-workspace-intro">
    <p className="otp-workspace-note" role="note"><LockKeyhole size={15}/>虚构数据 · 本页模拟 · 不保存云端</p>
    <h1 id="template-experience-title">经营数据模板</h1>
    <p>选择项目类型，调整示例数字，查看日明细与月初累计。</p>
    <a href="/workbench/?space=company" className="otp-workspace-login">选择我的项目 <ArrowRight size={16}/></a>
   </div>
   <ol className="otp-workspace-steps" aria-label="经营数据从填报到汇总的流程">
    <li><Database size={18}/><span>录入 / 导入明细</span></li>
    <li><Check size={18}/><span>主管核实</span></li>
    <li><BarChart3 size={18}/><span>汇总报表</span></li>
   </ol>
  </section>
  <nav className="otp-tabs" aria-label="体验数据模板">{[{id:'store-suite',name:'门店经营',icon:Store},...presets.map((t,i)=>({id:t.id,name:t.name,icon:[UsersRound,Target,ShoppingBag][i]}))].map(({id,name,icon:Icon})=><button key={id} aria-pressed={selected===id} className={selected===id?'selected':''} onClick={()=>{setSelected(id);setError('');}}><Icon size={19}/>{name}</button>)}</nav>
  <section className="otp-demo"><div className="otp-section"><div><h2>{template?template.name:'连锁门店经营'} · 月初累计</h2></div><div className="otp-cutoff"><label>累计截止<input aria-label="示例累计截止日" type="date" min={month+'-01'} max={today} value={month+'-'+String(days).padStart(2,'0')} onInput={e=>chooseDate(e.currentTarget.value)} onChange={e=>chooseDate(e.currentTarget.value)}/></label><button onClick={()=>{setDays(Number(today.slice(8)));setError('');}}>截至今天</button></div></div>
   <p className="otp-range">示例范围：{month.slice(0,4)}年{Number(month.slice(5))}月1日—{days}日 <span><Check size={14}/> 已有 {days} 天日明细 · 累计报表不重复相加</span></p>
   {!template?<><div className="otp-kpis">{[{name:'门店总业绩',value:38000*days,color:'blue'},{name:'美团核销金额',value:storeExamples.reduce((sum,store)=>sum+store.verified,0)*days,color:'green'},{name:'抖音核销金额',value:4600*days,color:'violet'}].map(k=><article key={k.name} className={k.color}><small>{k.name}</small><strong>¥ {number(k.value)}</strong><span>来自各自已填日明细</span></article>)}</div><div className="otp-note"><Store size={20}/><p><strong>总业绩已包含平台收入，三张表分别查看。</strong><br/>主管填总业绩，你填平台数据。按门店导入日明细后，同一份记录自动用于平台总数及各店累计；只有总数时，不反推门店数据。</p></div><div className="otp-store-wrap"><table><caption>美团门店累计示例 · {month.slice(0,4)}年{Number(month.slice(5))}月1日—{days}日</caption><thead><tr><th>门店</th><th>下单金额</th><th>核销金额</th><th>推广消耗</th><th>核销ROI</th></tr></thead><tbody>{storeExamples.map(store=><tr key={store.name}><td>{store.name}</td><td>¥ {number(store.ordered*days)}</td><td>¥ {number(store.verified*days)}</td><td>¥ {number(store.spend*days)}</td><td>{(store.verified/store.spend).toFixed(2)}</td></tr>)}</tbody></table></div><OperatingWeekExample/></>:<><div className="otp-kpis">{metrics.slice(0,4).map(metric=><article key={metric.key}><small>{metric.label}</small><strong>{metric.value===null?'—':metric.format==='percent'?formatOperatingPercent(metric.value):metric.format==='money'?'¥ '+number(metric.value):number(metric.value)}</strong><span>由已填数据自动计算</span></article>)}</div><div className="otp-data-grid"><article className="otp-inputs"><h3><FileSpreadsheet size={19}/> 编辑 {selectedDate} 的示例数据</h3><p>修改一项数据，再看累计结果。切换上方日期可以查阅其他天的记录。</p><div>{fields.map(f=><label key={editKey+f.key}><span>{f.label}{f.kind==='money'?'（元）':''}</span><input aria-label={'示例'+f.label} type="text" inputMode={f.kind==='count'?'numeric':'decimal'} key={editKey+f.key} defaultValue={f.kind==='money'?selectedValues[f.key]/100:selectedValues[f.key]} onBlur={e=>change(e.currentTarget,f.key,f.kind)}/></label>)}</div>{error&&<p role="alert" className="otp-error">{error}</p>}</article><article className="otp-results"><h3><BarChart3 size={19}/> 1—{days}号自动累计</h3><dl>{fields.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{f.kind==='money'?(summary?.rows[0]?.values[f.key]==null?'—':'¥ '+formatOperatingMoney(summary.rows[0].values[f.key])):number(summary?.rows[0]?.values[f.key]??null)}</dd></div>)}</dl><p>比率按累计分子 ÷ 累计分母重算，不平均每天的百分比。</p></article></div><p className="otp-formulas">{template.metrics.map(m=><span key={m.key}>{m.label} = {template.fields.find(f=>f.key===m.numerator)?.label} ÷ {template.fields.find(f=>f.key===m.denominator)?.label}</span>)}</p></>}
  </section>
  <section className="otp-footer"><div><h2>配置项目模板</h2><p>可以复制模板、调整数值字段、配置比率和填写人；历史记录保留当时的字段口径。</p></div><a href="/workbench/?space=company" className="otp-primary">进入我的工作台 <ArrowRight size={17}/></a></section>
  <footer>拾序 · 数据模板体验 <span>所有内容均为虚构示例</span><a href="/workbench/?space=company&preview=company">查看项目协作演示</a></footer>
 </main>;
}
