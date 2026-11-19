'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowLeft,BarChart3,ChartNoAxesCombined,ShieldCheck,TriangleAlert} from 'lucide-react';
import {Area,AreaChart,Bar,BarChart,CartesianGrid,Rectangle,ResponsiveContainer,Tooltip,XAxis,YAxis,type BarShapeProps,type MouseHandlerDataParam} from 'recharts';
import type {OperatingRecord,OperatingSheet,OperatingTemplate} from '../cloud/company/operating-model';
import {buildOperatingChart,operatingChartDetail,operatingChartOptions,operatingChartPointText,type OperatingChart,type OperatingChartKind,type OperatingChartMetric,type OperatingChartPoint,type OperatingChartPurpose,type OperatingChartSheet} from '../lib/workbench/operating-chart';
import OperatingWeekdayPattern from './operating-weekday-pattern';
import '../app/operating-charts.css';

export type OperatingChartsProps={records:OperatingRecord[];cutoff:string;initialSheet?:OperatingSheet;templates?:OperatingTemplate[]};
const compact=(value:number)=>new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value);
const shortLabel=(value:unknown)=>String(value).length>10?String(value).slice(0,9)+'…':String(value);

function operatingBarShape({value,x,y,width,height,radius,fill,payload}:BarShapeProps){
 if(payload?.value==null)return <g/>;
 const style={animationDelay:payload.revealDelay+'ms'};
 if(value===0){
  return <circle className="och-bar-zero" style={style} cx={x+width/2} cy={y} r={Math.min(3,width/2)} fill="var(--och-surface)" stroke={fill} strokeWidth={1.5}/>;
 }
 return <Rectangle className="och-bar-growth" style={{...style,transformOrigin:height<0?'center top':'center bottom'}} x={x} y={y} width={width} height={height} radius={radius} fill={fill}/>;
}

// Start the reveal when the plot is in view, even on long monthly reports.
function OperatingPlot({children,descriptionId,reveal}:{children:React.ReactNode;descriptionId:string;reveal:boolean}){
 const plotRef=useRef<HTMLDivElement>(null);
 const [entered,setEntered]=useState(false);
 useEffect(()=>{
  if(!reveal||!plotRef.current)return;
  if(typeof IntersectionObserver==='undefined'){setEntered(true);return;}
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){setEntered(true);observer.disconnect();}
  },{threshold:0.12});
  observer.observe(plotRef.current);
  return ()=>observer.disconnect();
 },[reveal]);
 return <div ref={plotRef} className="och-plot" aria-describedby={descriptionId}
   data-reveal={reveal?(entered?'playing':'waiting'):undefined}>{children}</div>;
}

function ChartRows({points,metric,onOpen}:{points:OperatingChartPoint[];metric:OperatingChartMetric;onOpen?:(point:OperatingChartPoint,trigger:HTMLElement)=>void}){
 return <tbody>{points.map(point=><tr key={point.id}>
  <th scope="row">{onOpen?<button type="button" className="och-open-point" aria-haspopup="dialog" onClick={event=>onOpen(point,event.currentTarget)}>{point.label}</button>:point.label}</th>
  <td title={point.rawCents!==undefined?'原始金额：'+point.rawCents+' 分':undefined}>{operatingChartPointText(point,metric)}</td>
  <td>{point.reason||(point.value===0?'已确认值为0':'已确认')}</td>
 </tr>)}</tbody>;
}

type Detail=ReturnType<typeof operatingChartDetail>&{trigger:HTMLElement|null};
function ChartDetail({detail,chart,metric,onClose}:{detail:Detail;chart:OperatingChart;metric:OperatingChartMetric;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),title=useId();
 React.useLayoutEffect(()=>{
  const dialog=ref.current!,overflow=document.body.style.overflow,x=window.scrollX,y=window.scrollY;
  document.body.style.overflow='hidden';
  dialog.showModal();
  return ()=>{
   dialog.close();
   document.body.style.overflow=overflow;
   detail.trigger?.focus({preventScroll:true});
   window.scrollTo({left:x,top:y,behavior:'instant'});
  };
 },[detail]);
 const rowDimension=chart.purpose==='time'?'门店 / 范围':chart.source==='snapshot'?'累计截止日':'业务日期';
 return <dialog ref={ref} className="och-drill" aria-labelledby={title} onCancel={event=>{event.preventDefault();onClose();}}>
  <header><div><h3 id={title}>{detail.heading} · {metric.label}明细</h3>
   <p>{detail.projectName} · {chart.name} · {chart.start} 至 {chart.end}{chart.source==='snapshot'?' · 已确认累计快照':''}</p></div>
   <button type="button" className="op-button" onClick={onClose} autoFocus><ArrowLeft size={16}/>返回图形</button></header>
  {detail.reason&&<p className="och-drill-reason">{chart.purpose==='time'?'当日指标':'区间指标'}留空：{detail.reason}。</p>}
  {detail.points.length>0&&<div className="och-table-scroll" role="region" aria-label={detail.heading+'已确认明细'} tabIndex={0}><table>
   <thead><tr><th scope="col">{rowDimension}</th><th scope="col">{metric.label}（{metric.unit}）</th><th scope="col">说明</th></tr></thead>
   <ChartRows points={detail.points} metric={metric}/>
  </table></div>}
 </dialog>;
}

export default function OperatingCharts({records,cutoff,initialSheet,templates=[]}:OperatingChartsProps){
 const titleId=useId(),descriptionId=useId(),areaId=useId();
 const [detail,setDetail]=useState<Detail|null>(null);
 const [sheetId,setSheetId]=useState<OperatingSheet>(initialSheet||'revenue'),[metricKey,setMetricKey]=useState(''),[purposeChoice,setPurposeChoice]=useState<'auto'|OperatingChartPurpose>('auto'),[kindChoice,setKindChoice]=useState<'auto'|OperatingChartKind>('auto');
 const prepared=useMemo(()=>{
  let options:OperatingChartSheet[]=[],chart:OperatingChart|null=null,error='';
  try{
   options=operatingChartOptions(records,cutoff,templates);
   const chosen=options.find(option=>option.sheet===sheetId)||options.find(option=>option.sheet==='revenue')||options[0];
   if(chosen){
    const metric=chosen.metrics.some(m=>m.key===metricKey)?metricKey:undefined,purpose=purposeChoice==='auto'?chosen.defaultPurpose:purposeChoice;
    chart=buildOperatingChart(records,{cutoff,sheet:chosen.sheet,metric,purpose,...(kindChoice==='auto'?{}:{kind:kindChoice})},templates);
   }
  }catch(cause){error=cause instanceof Error?cause.message:'图形数据暂时无法核对，请刷新后重试。';}
  return {options,chart,error};
 },[records,cutoff,templates,sheetId,metricKey,purposeChoice,kindChoice]);
 const {options,chart,error}=prepared,metric=chart?.metric,chosen=options.find(option=>option.sheet===(chart?.sheet||sheetId))||options.find(option=>option.sheet==='revenue')||options[0];
 const purpose=chart?.purpose||(purposeChoice==='auto'?chosen?.defaultPurpose:purposeChoice),recommended=purpose==='stores'?'bar':'line';
 const source=chart?.source==='snapshot'?'已确认手工累计快照':'已确认逐日记录';
 const bars=useMemo(()=>{
  if(chart?.kind!=='bar')return [];
  const count=chart.points.filter(point=>point.value!==null).length;
  const step=Math.min(100,700/Math.max(1,count-1));
  let order=0;
  return chart.points.map(point=>({...point,revealDelay:point.value===null?0:Math.round(order++*step)}));
 },[chart]);
 function openPoint(point:OperatingChartPoint,trigger:HTMLElement|null){
  if(chart&&metric)setDetail({...operatingChartDetail(records,chart,point.id),trigger});
 }
 function openPlotPoint({activeTooltipIndex}:MouseHandlerDataParam){
  const point=activeTooltipIndex==null?null:chart?.points[Number(activeTooltipIndex)];
  if(point)openPoint(point,document.activeElement instanceof HTMLElement?document.activeElement:null);
 }
 const tooltip=metric&&<Tooltip filterNull={false} cursor={chart?.kind==='bar'?{fill:'var(--och-tint)'}:undefined}
  contentStyle={{background:'var(--och-surface)',border:'1px solid var(--och-border)',borderRadius:10,color:'var(--och-text)'}} labelStyle={{color:'var(--och-text)'}}
  formatter={(value,_name,item)=>[item.payload?.reason||operatingChartPointText({value:typeof value==='number'?value:null,rawCents:item.payload?.rawCents,fraction:item.payload?.fraction},metric),metric.label]}/>;
 const graphic=chart&&metric&&chart.hasData?<ResponsiveContainer width="100%" height="100%" minWidth={0}>
  {chart.kind==='line'?<AreaChart data={chart.points} margin={{top:14,right:16,left:0,bottom:10}} accessibilityLayer onClick={openPlotPoint}>
   <defs><linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--och-blue)" stopOpacity={0.2}/><stop offset="100%" stopColor="var(--och-blue)" stopOpacity={0}/></linearGradient></defs>
   <CartesianGrid stroke="var(--och-grid)" strokeDasharray="4 4" vertical={false}/>
   <XAxis dataKey="label" tick={{fill:'var(--och-muted)',fontSize:12}} axisLine={false} tickLine={false} minTickGap={24} interval="preserveStartEnd" tickFormatter={shortLabel}/>
   <YAxis width={66} tick={{fill:'var(--och-muted)',fontSize:12}} axisLine={false} tickLine={false} tickFormatter={compact} domain={[0,'auto']}/>
   {tooltip}
   <Area fill={`url(#${areaId})`} fillOpacity={1} name={metric.label} type="linear" dataKey="value" stroke="var(--och-blue)" strokeWidth={2.5} dot={{r:3,strokeWidth:2,fill:'var(--och-surface)'}} activeDot={{r:5}} connectNulls={false} isAnimationActive={false}/>
  </AreaChart>:<BarChart data={bars} margin={{top:14,right:16,left:0,bottom:10}} accessibilityLayer onClick={openPlotPoint}>
   <CartesianGrid stroke="var(--och-grid)" strokeDasharray="4 4" vertical={false}/>
   <XAxis dataKey="label" tick={{fill:'var(--och-muted)',fontSize:12}} axisLine={false} tickLine={false} minTickGap={24} interval="preserveStartEnd" tickFormatter={shortLabel}/>
   <YAxis width={66} tick={{fill:'var(--och-muted)',fontSize:12}} axisLine={false} tickLine={false} tickFormatter={compact} domain={[0,'auto']}/>
   {tooltip}
   <Bar name={metric.label} dataKey="value" fill="var(--och-blue)" shape={operatingBarShape} radius={[4,4,0,0]} maxBarSize={44} isAnimationActive={false}/>
  </BarChart>}
 </ResponsiveContainer>:null;

 const validPoints=chart?.points.filter(point=>point.value!==null)??[];
 const last=validPoints.at(-1);
 const magnitude=(p:OperatingChartPoint)=>p.rawCents!==undefined?BigInt(p.rawCents):p.value!;
 const peak=validPoints.reduce<OperatingChartPoint|undefined>((highest,p)=>!highest||magnitude(p)>magnitude(highest)?p:highest,undefined);
 const tied=peak?validPoints.filter(p=>magnitude(p)===magnitude(peak)).length:0;
 const time=chart?.purpose==='time';
 const facts:{title:string;point:OperatingChartPoint;note:string}[]=[];
 if(time&&last)facts.push({title:'最近有数的一天',point:last,note:last.id});
 if(peak&&(!time||validPoints.length>1))facts.push({title:time?'有记录日期中的最高值':'有数值的门店 / 渠道最高值',point:peak,note:(time?peak.id:peak.label)+(tied>1?' · '+tied+' 项并列':'')});
 return <section className="och-card" aria-labelledby={titleId}>
  <header className="och-heading"><div><span className="och-eyebrow"><ChartNoAxesCombined size={16}/>经营图形</span><h3 id={titleId}>从已确认数据看走势与差异</h3><p>每次查看一个指标，保留金额、数量和比率各自的单位。</p></div><span className="och-badge"><ShieldCheck size={14}/>只读已确认版</span></header>
  {chosen&&<div className="och-selectors">
    <label>数据表<select value={chosen.sheet} aria-label="图形数据表" onChange={event=>{setSheetId(event.target.value as OperatingSheet);setMetricKey('');setPurposeChoice('auto');setKindChoice('auto');}}>{options.map(option=><option key={option.sheet} value={option.sheet}>{option.name}{options.some(other=>other.sheet!==option.sheet&&other.name===option.name)?' · '+option.sheet:''}</option>)}</select></label>
    <label>查看指标<select value={metric?.key||(error?(metricKey||chosen.defaultMetric||''):'')} aria-label="图形指标" onChange={event=>setMetricKey(event.target.value)}>{!chosen.defaultMetric&&<option value="">请选择指标</option>}{chosen.metrics.map(option=><option key={option.key} value={option.key}>{option.label} · {option.unit}{option.key.startsWith('metric:')?' · 自动计算':''}</option>)}</select></label>
    <label>查看用途<select value={purposeChoice} aria-label="图形用途" onChange={event=>{setPurposeChoice(event.target.value as 'auto'|OperatingChartPurpose);setKindChoice('auto');}}><option value="auto">自动 · {chosen?.defaultPurpose==='stores'?'门店对比':'日期走势'}</option><option value="time">日期走势</option><option value="stores">门店 / 渠道对比</option></select></label>
    <label>图形<select value={purpose==='stores'&&kindChoice==='line'?'auto':kindChoice} aria-label="图形类型" onChange={event=>setKindChoice(event.target.value as 'auto'|OperatingChartKind)}><option value="auto">自动 · {recommended==='line'?'折线图':'柱状图'}</option>{purpose==='time'&&<option value="line">折线图</option>}<option value="bar">柱状图</option></select></label>
   </div>}
  {error?<div className="och-message och-warning" role="alert"><TriangleAlert size={20}/><div><strong>暂不能绘制这组数据</strong><p>{error}</p></div></div>:!chart?<div className="och-message" role="status"><BarChart3 size={26}/><div><strong>本月还没有可绘图的已确认经营记录</strong><p>草稿与待确认的新记录不进入图形。已有确认版的更正记录，继续使用原确认值。月目标不作为每日经营发生量。</p></div></div>:<>
   <div className="och-chart-heading"><div><h4>{metric?.label||'选择一个指标开始'}{metric&&<span>单位：{metric.unit}</span>}</h4><p id={descriptionId}>{chart.start} — {chart.end} · {source}{chart.validDays!==null?' · 该指标有确认值 '+chart.validDays+'/'+chart.expected+' 天':chart.source==='daily'?' · '+chart.reported+'/'+chart.expected+' 天有记录':''}</p></div><span className="och-kind">{chart.purpose==='time'?'日期走势':'门店 / 渠道对比'}</span></div>
   {metric&&facts.length>0&&<section className="op-readout" aria-label="本期看点"><h4>本期看点</h4><div className="op-readout-grid">{facts.map(f=><button type="button" key={f.title} aria-haspopup="dialog" onClick={e=>openPoint(f.point,e.currentTarget)}><span>{f.title} · {metric.label}</span><strong>{operatingChartPointText(f.point,metric)}</strong><small>{f.note} · 查看明细</small></button>)}</div></section>}
   {metric&&chart.periodRatio&&<p className="och-period-ratio"><strong>全期{metric.label} {operatingChartPointText(chart.periodRatio,metric)}</strong> · {chart.periodRatio.reason||'按全期分子、分母合计计算'}</p>}
   {metric?.definition&&<p className="och-definition">{metric.definition}</p>}
   {graphic?<OperatingPlot key={JSON.stringify([chart.sheet,metric?.key,chart.kind,chart.purpose,chart.end])} descriptionId={descriptionId}
     reveal={chart.kind==='bar'||chart.points.filter(point=>point.value!==null).length>1}>{graphic}</OperatingPlot>:<div className="och-message och-plot-empty" role="status"><BarChart3 size={28}/><p>{!metric?'请选择指标。自定义模板有多个字段时，需要先确认要查看的口径。':chart.points.length?'这段范围内暂无完整的该指标数值。请在下方明细查看缺报原因。':'当前数据无法按所选用途绘图，请核对下方说明或切换用途。'}</p></div>}
   <OperatingWeekdayPattern chart={chart}/>
   {chart.kind==='bar'&&chart.points.some(point=>point.value===0)&&<p className="och-zero-key"><span aria-hidden="true"/>已确认值为 0</p>}
   <div className="och-notes">{chart.notes.map(note=><p key={note}>{note}</p>)}<p>总业绩与各平台金额分别查看，不能再相加；星级不求合计。图形不修改原始记录。</p></div>
   {metric&&chart.points.length>0&&<details className="och-details"><summary>查看数值与缺报明细（{chart.points.length} 项）</summary><div className="och-table-scroll" role="region" aria-label="图形数值与缺报明细，可横向滚动" tabIndex={0}><table><caption>{chart.name} · {metric.label}（{metric.unit}）· {chart.start} — {chart.end}</caption><thead><tr><th scope="col">{chart.purpose==='time'?'日期':'门店 / 渠道'}</th><th scope="col">{metric.label}</th><th scope="col">说明</th></tr></thead><ChartRows points={chart.purpose==='time'?chart.points.map(point=>({...point,label:point.id})):chart.points} metric={metric} onOpen={openPoint}/></table></div></details>}
   {detail&&metric&&<ChartDetail detail={detail} chart={chart} metric={metric} onClose={()=>setDetail(null)}/>}
  </>}
 </section>;
}
