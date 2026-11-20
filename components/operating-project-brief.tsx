import React,{useEffect,useId,useMemo,useState} from 'react';
import type {OperatingRecord,OperatingSheet,OperatingTemplate} from '../cloud/company/operating-model';
import {briefDates,buildOperatingBrief,type BriefPeriod} from '../lib/workbench/operating-brief';
import {formatOperatingMoney} from '../lib/workbench/operating-paste';
import {formatOperatingDecimal,formatOperatingPercent} from '../lib/workbench/operating-display';
import '../app/operating-project-brief.css';

type ReportProps={companyId:string;projectId:string;projectName:string;cutoff:string;records:OperatingRecord[];sheets:{id:OperatingSheet;name:string;template?:OperatingTemplate}[];initialSheet:OperatingSheet;loadMonth:(month:string)=>Promise<OperatingRecord[]>;changeDate:(date:string)=>void};
const periodNames={day:'日报',week:'周报',month:'月报'};
const formats=(n:number|null|undefined,kind:string)=>n==null?'—':kind==='money'?formatOperatingMoney(n)+' 元':n.toLocaleString('zh-CN');
export default function OperatingProjectBrief(props:ReportProps){
 const {companyId,projectId,projectName,cutoff,records,sheets,loadMonth}=props;
 const [mode,setMode]=useState<BriefPeriod>('day'),[sheetId,setSheet]=useState(props.initialSheet),[key,setKey]=useState('');
 const [explicitSheet,setExplicitSheet]=useState(false);
 const [history,setHistory]=useState<{month:string;records:OperatingRecord[];error?:string}>(),[retry,setRetry]=useState(0);
 const uid=useId();
 const eligible=sheets.filter(s=>s.id!=='targets'&&!s.id.endsWith('-stores'));
 const hasData=(id:OperatingSheet)=>records.some(r=>r.sheet===id&&r.date<=cutoff&&(r.status==='approved'||r.published));
 const source=eligible.find(s=>s.id===sheetId&&hasData(s.id))??(explicitSheet?eligible.find(s=>s.id===sheetId):undefined)??eligible.find(s=>hasData(s.id))??eligible[0];
 const range=briefDates(cutoff,mode),priorMonth=range.previous.start.slice(0,7),needHistory=priorMonth!==cutoff.slice(0,7);
 useEffect(()=>{let active=true;if(needHistory)loadMonth(priorMonth).then(data=>{if(active)setHistory({month:priorMonth,records:data});},e=>{if(active)setHistory({month:priorMonth,records:[],error:e.message});});return()=>{active=false;};},[needHistory,priorMonth,loadMonth,retry]);
 const past=needHistory&&history?.month===priorMonth?history:undefined;
 const result=useMemo(()=>{if(!source)return {};try{return {report:buildOperatingBrief([...(past?.records??[]),...records],companyId,projectId,source.id,cutoff,mode,source.template)};}catch(e){return {error:e instanceof Error?e.message:'报表数据暂时无法核对'};}},[past,records,companyId,projectId,source?.id,source?.template,cutoff,mode]);
 const r=result.report,periodName=periodNames[mode];
 const dateRange=range.current.start===cutoff?cutoff:range.current.start+' 至 '+cutoff;
 const fields=r?.fields??[];
 const priority=['orderAmount','verifiedAmount','refundAmount','adSpend'];
 const ordered=[...priority.flatMap(k=>fields.filter(f=>f.key===k)),...fields.filter(f=>!priority.includes(f.key))];
 const shown=ordered.filter(f=>r?.totals[f.key]!=null);
 const field=fields.find(f=>f.key===key)??shown[0]??fields[0];
 const fieldKey=field?.key??'';
 const overviewFields=field&&shown.some(f=>f.key===field.key)?[field,...shown.filter(f=>f.key!==field.key)]:shown;
 const overviewCards=overviewFields.map(f=>({
  id:'field-'+f.key,label:f.label+(r?.complete?'':' · 已报小计'),value:formats(r?.totals[f.key],f.kind),
  previous:r?.priorTotals[f.key]!=null?formats(r.priorTotals[f.key],f.kind):null
 }));
 for(const metric of r?.metrics??[]){
  if(metric.value==null||metric.unitIssue)continue;
  overviewCards.push({id:'metric-'+metric.key,label:metric.label,value:metric.format==='percent'?formatOperatingPercent(metric.value):formatOperatingDecimal(metric.value,2)+(metric.format==='money'?' 元':' 倍'),previous:null});
 }
 const fmt=(n:number|null|undefined)=>formats(n,field?.kind??'count');
 const ranked=(r?.details??[]).filter(s=>s.values[fieldKey]!=null).sort((a,b)=>b.values[fieldKey]!-a.values[fieldKey]!||a.name.localeCompare(b.name,'zh-CN'));
 const days=(r?.days??[]).map(date=>({date,value:r?.byDay.get(date)?.[fieldKey]??null}));
 const available=days.filter(d=>d.value!==null),topDay=available.reduce<typeof days[number]|null>((a,b)=>!a||b.value!>a.value!?b:a,null);
 const max=Math.max(0,...available.map(d=>d.value!)),leader=ranked[0];
 const scopeComplete=r?.complete&&r.details.every(s=>s.days===r.days.length);
 const allAllocated=scopeComplete&&leader&&r!.current.every(d=>d.rows.every(row=>row.storeId!=='all'))&&r!.details.every(s=>s.values[fieldKey]!=null);
 const share=allAllocated&&r!.totals[fieldKey]!>0?leader.values[fieldKey]!/r!.totals[fieldKey]!:null;
 const refunds=r?.details.filter(s=>s.values.refundAmount!=null).sort((a,b)=>b.values.refundAmount!-a.values.refundAmount!)??[];
 const refund=scopeComplete&&r?.totals.refundAmount&&refunds[0]?.values.refundAmount?refunds[0]:null;
 const ratio=r?.metrics.find(m=>m.key==='verificationRate'&&m.value!=null)??r?.metrics.find(m=>m.format==='percent'&&m.value!=null);
 const formula=source?.template?.metrics.find(m=>m.key===ratio?.key);
 const numerator=ratio?.key==='verificationRate'?'verifiedCoupons':formula?.numerator;
 const denominator=ratio?.key==='verificationRate'?'orderedCoupons':formula?.denominator;
 const weekly=new Map<string,typeof days>();
 if(mode==='month')for(const day of days){const start=briefDates(day.date,'week').current.start;const group=weekly.get(start)??[];group.push(day);weekly.set(start,group);}
 const prior=r?.priorTotals[fieldKey],actual=r?.totals[fieldKey];
 const diff=actual!=null&&prior!=null?actual-prior:null;
 const compareLabel=mode==='day'?'前一日':mode==='week'?'上周同期':'上月可比期间';
 const tableFields=field?[field,...shown.filter(f=>f.key!==fieldKey)]:shown;
 const latest=source&&records.filter(a=>a.sheet===source.id&&a.date<=cutoff&&(a.status==='approved'||a.published)).map(a=>a.date).sort().at(-1);
 return <section className="op-brief" aria-label="项目经营报表">
  <header><div><h3>{projectName} · 经营报表</h3><p>{dateRange} · {source?.name??'暂无业务表'} · 已确认数据</p></div><div role="group" aria-label="经营报表周期">{(['day','week','month'] as const).map(p=><button key={p} type="button" aria-pressed={mode===p} onClick={()=>setMode(p)}>{periodNames[p]}</button>)}</div></header>
  <div className="op-brief-filters">{eligible.length>1&&<label>业务表<select value={source?.id} onChange={e=>{setSheet(e.target.value as OperatingSheet);setKey('');setExplicitSheet(true);}}>{eligible.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}<label>业务日期<input type="date" value={cutoff} onChange={e=>e.target.value&&props.changeDate(e.target.value)}/></label>{fields.length>1&&<label>分析指标<select value={fieldKey} onChange={e=>setKey(e.target.value)}>{ordered.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>}</div>
  {needHistory&&!past&&<p role="status">正在读取跨月数据…</p>}{past?.error&&<p role="alert">历史月份读取失败，跨月数字可能未齐。<button onClick={()=>setRetry(i=>i+1)}>重试</button></p>}
  {result.error?<p role="alert">{result.error}</p>:!r?.current.length?<p>本期暂无已确认记录。{latest&&latest!==cutoff&&<button onClick={()=>props.changeDate(latest)}>查看 {latest} 的报表</button>}</p>:<>
   <section><h4>{periodName}概览 <small>{r.current.length} / {r.days.length} 天已确认</small></h4>
    <div className="op-readout-grid">{overviewCards.slice(0,4).map(card=><article key={card.id}><span>{card.label}</span><strong>{card.value}</strong>{card.previous!==null&&<small>{compareLabel} {card.previous}</small>}</article>)}</div>
    {overviewCards.length>4&&<details className="op-brief-more"><summary>更多指标（{overviewCards.length-4}）</summary><dl>{overviewCards.slice(4).map(card=><div key={card.id}><dt>{card.label}</dt><dd>{card.value}{card.previous!==null&&<small>{compareLabel} {card.previous}</small>}</dd></div>)}</dl></details>}
    {r.missing.length>0&&<details><summary>还有 {r.missing.length} 天缺报</summary><p>{r.missing.join('、')}</p></details>}{!r.complete&&!r.missing.length&&<p>期间门店范围有变化，总数按已报范围展示。</p>}
   </section>
   <section><h4>{periodName}分析</h4><div className="op-brief-insights">
    {diff!==null&&<article><b>{field.label}{diff===0?'与'+compareLabel+'持平':'较'+compareLabel+(diff>0?'增加 ':'减少 ')+fmt(Math.abs(diff))}</b><p>{range.previous.start} 至 {range.previous.end} 为 {fmt(prior)}，本期为 {fmt(actual)}。{prior!>0&&diff!==0?'变化幅度 '+formatOperatingPercent(Math.abs(diff)/prior!)+'。':''}</p></article>}
    {topDay&&available.length>1&&<article><b>{topDay.date} 的{field.label}最高</b><p>有完整数值的 {available.length} 天中，最高为 {fmt(topDay.value)}。{available.filter(d=>d.value===topDay.value).length>1?'有多个日期并列。':''}</p><a href={'#'+uid+'-trend'}>看逐日走势</a></article>}
    {share!==null&&ranked.length>1&&<article><b>{leader.name}占{field.label}的 {formatOperatingPercent(share)}</b><p>该门店或渠道合计 {fmt(leader.values[fieldKey])}，同范围合计 {fmt(actual)}。</p><a href={'#'+uid+'-stores'}>核对分项明细</a></article>}
    {ratio&&numerator&&denominator&&r.totals[numerator]!=null&&r.totals[denominator]!=null&&<article><b>{ratio.label} {formatOperatingPercent(ratio.value!)}</b><p>{fields.find(f=>f.key===numerator)?.label} {formats(r.totals[numerator],fields.find(f=>f.key===numerator)?.kind??'count')}，{fields.find(f=>f.key===denominator)?.label} {formats(r.totals[denominator],fields.find(f=>f.key===denominator)?.kind??'count')}。按本期合计计算。</p></article>}
    {r.metrics.find(m=>m.key==='verifiedRoi'&&m.value!=null)&&(r.totals.adSpend??0)>0&&<article><b>每 1 元推广消耗对应 {formatOperatingDecimal(r.totals.verifiedAmount!/r.totals.adSpend!,2)} 元核销金额</b><p>本期推广花费 {formatOperatingMoney(r.totals.adSpend)} 元，核销金额 {formatOperatingMoney(r.totals.verifiedAmount)} 元。</p></article>}
    {refund&&<article><b>退款金额优先核对{refund.name}</b><p>该项退款 {formatOperatingMoney(refund.values.refundAmount!)} 元，本期共 {formatOperatingMoney(r.totals.refundAmount!)} 元。可先核对该门店的退款单及发生日期。</p></article>}
    {diff===null&&<article><b>{field?.label??'指标'}暂无法和{compareLabel}比较</b><p>两期需要相同的业务范围、完整的确认日期和可比字段。本期已确认 {r.current.length} 天。</p></article>}
   </div></section>
   {mode!=='day'&&field&&<section id={uid+'-trend'}><h4>逐日走势 <small>{field.label}</small></h4><div className="op-brief-trend" role="img" aria-label={field.label+'逐日走势，完整数值见下方日期明细'}>{days.map(d=><i key={d.date} title={d.date+' · '+fmt(d.value)} data-missing={d.value===null} style={{height:d.value===null?'2px':Math.max(2,max?100*d.value/max:0)+'%'}}/>)}</div><div className="op-brief-axis"><small>{days[0]?.date}</small><small>{cutoff}</small></div><details><summary>逐日数值与缺报明细</summary>{days.map(d=><p key={d.date}>{d.date}　{d.value===null?'未齐':fmt(d.value)}</p>)}</details></section>}
   {mode==='month'&&field&&weekly.size>1&&<section><h4>按周看{field.label}</h4><div className="op-table-scroll"><table className="op-table"><thead><tr><th>本月日期</th><th>有数天数</th><th>已报小计</th><th>已报日均</th></tr></thead><tbody>{[...weekly].map(([start,group])=>{const values=group.flatMap(d=>d.value===null?[]:[d.value]);const sum=values.reduce((a,b)=>a+BigInt(b),BigInt(0)),n=BigInt(values.length);const display=(v:bigint)=>field.kind==='money'?(v/BigInt(100)).toLocaleString('zh-CN')+'.'+String(v%BigInt(100)).padStart(2,'0')+' 元':v.toLocaleString('zh-CN');return <tr key={start}><th>{group[0].date.slice(5)} 至 {group.at(-1)!.date.slice(5)}</th><td>{values.length}/{group.length}</td><td>{values.length?display(sum):'—'}</td><td>{values.length?(field.kind==='money'?display((sum*BigInt(2)+n)/(BigInt(2)*n)):formatOperatingDecimal(Number(sum)/Number(n),2)):'—'}</td></tr>;})}</tbody></table></div></section>}
   <section id={uid+'-stores'}><h4>门店 / 渠道明细</h4>{ranked.length>0&&<div className="op-brief-rank">{ranked.slice(0,5).map(s=><div key={s.id}><span>{s.name}</span><meter min={0} max={leader.values[fieldKey]||1} value={s.values[fieldKey]!}/><b>{fmt(s.values[fieldKey])}</b></div>)}</div>}
   {r.details.length>0?<div className="op-table-scroll" role="region" tabIndex={0} aria-label="经营报表分项明细"><table className="op-table"><thead><tr><th>门店 / 渠道</th><th>已报天数</th>{tableFields.map(f=><th key={f.key}>{f.label}{f.kind==='money'?'（元）':''}</th>)}</tr></thead><tbody>{[...ranked,...r.details.filter(s=>s.values[fieldKey]==null)].map(s=><tr key={s.id}><th>{s.name}</th><td>{s.days}/{r.days.length}</td>{tableFields.map(f=><td key={f.key}>{f.kind==='money'?formatOperatingMoney(s.values[f.key]):formats(s.values[f.key],f.kind)}</td>)}</tr>)}</tbody></table></div>:<p>本期填报为项目或平台总数，尚无门店 / 渠道分项。</p>}</section>
  </>}
 </section>;
}
