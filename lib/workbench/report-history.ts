import{reportPeriod,reportPeriodLabel,type ReportKind,type ReportPeriod}from'./report-period.ts';
export type ConfirmedReportHistory={state:'found'|'later';period:ReportPeriod;total:number}|{state:'empty'}|{state:'continue';nextOffset:number};

export function historyPeriodInput(period:ReportPeriod){
 return period.kind==='monthly'?period.start.slice(0,7):period.start<'1970-01-01'?period.end:period.start;
}

export async function loadConfirmedReportHistory(request:(body:any)=>Promise<any>,filter:{companyId:string;projectId:string;kind:ReportKind;periodDate:string},revision:number,isCurrent:()=>boolean){
 const selected=reportPeriod(filter.kind,filter.periodDate);
 let offset=0;
 while(isCurrent()){
  const result=await request({...filter,action:'report.list',scope:'summary',findPrevious:true,revision,...(offset?{historyOffset:offset}:{})});
  if(!isCurrent())return null;
  const history:ConfirmedReportHistory|undefined=result.history;
  if(!Number.isSafeInteger(revision)||result.companyRevision!==revision||!history)throw Error('历史报表未能核对，请刷新后重试');
  if(history.state==='empty')return history;
  if(history.state==='found'||history.state==='later'){
   const target=history.period;
   const expected=target&&reportPeriod(filter.kind,historyPeriodInput(target));
   if(!expected||target.kind!==filter.kind||expected.start!==target.start||expected.end!==target.end||
      (history.state==='found'?target.start>=selected.start:target.start<=selected.start)||!Number.isSafeInteger(history.total)||history.total<1)throw Error('历史报表周期不一致，请刷新后重试');
   return history;
  }
  // The calendar spans 1970–2100. Only the selected month can occur in both directions.
  if(history.state!=='continue'||!Number.isSafeInteger(history.nextOffset)||history.nextOffset<=offset||history.nextOffset>12*131+2)throw Error('历史报表读取位置无效，请刷新后重试');
  offset=history.nextOffset;
 }
 return null;
}
export type HistoryKind=ReportKind|'operating';
export type HistoryShortcut={label:string;value:string};
export type HistoryNavigation={label:string;history:boolean;future:boolean;previous:string|null;next:string|null;shortcuts:HistoryShortcut[];caption:string};
const iso=(date:Date)=>date.toISOString().slice(0,10);
const shiftDays=(value:string,days:number)=>{const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return iso(date);};
const monthEnd=(value:string,offset:number)=>{const[year,month]=value.slice(0,7).split('-').map(Number);return iso(new Date(Date.UTC(year,month+offset,0)));};
const valid=(value:string|null)=>value&&value>='1970-01-01'&&value<='2100-12-31'?value:null;
/** Business dates are Shanghai date strings; calendar arithmetic stays in UTC. */
export function reportHistoryNavigation(kind:HistoryKind,value:string,today:string):HistoryNavigation{
 reportPeriod('monthly',today);const thisWeek=reportPeriod('weekly',today),thisMonth=today.slice(0,7);
 if(kind==='daily'){
  reportPeriod(kind,value);
  return{label:value,history:value<today,future:value>today,previous:valid(shiftDays(value,-1)),next:value<today?valid(shiftDays(value,1)):null,shortcuts:[{label:'回到今天',value:today}],caption:'按工作日期查看每位员工的日报。'};
 }
 if(kind==='operating'){
  reportPeriod('weekly',value);const month=value.slice(0,7),prior=valid(monthEnd(value,-1));
  const next=month<thisMonth?valid(monthEnd(value,1)>today?today:monthEnd(value,1)):null;
  const lastWeek=valid(shiftDays(thisWeek.start,-1)),lastMonth=valid(monthEnd(today,-1));
  return{label:month+'-01 — '+value,history:value<today,future:value>today,previous:prior,next,shortcuts:[{label:'截至今天',value:today},...(lastWeek?[{label:'上周截止',value:lastWeek}]:[]),...(lastMonth?[{label:'上月整月',value:lastMonth}]:[])],caption:'经营数字按月初累计至所选截止日；“上周截止”不是仅上周7天的合计。'};
 }
 const period=reportPeriod(kind,value),current=reportPeriod(kind,today),previous=valid(kind==='weekly'?shiftDays(period.start,-7):monthEnd(period.start,-1));
 const forward=valid(kind==='weekly'?shiftDays(period.start,7):shiftDays(period.end,1));
 const next=forward&&reportPeriod(kind,forward).start<=current.start?forward:null;
 return{label:reportPeriodLabel(period),history:period.start<current.start,future:period.start>current.start,previous:previous&&(kind==='monthly'?previous.slice(0,7):previous),next:next&&(kind==='monthly'?next.slice(0,7):next),shortcuts:[{label:kind==='weekly'?'回到本周':'回到本月',value:kind==='weekly'?today:thisMonth}],caption:kind==='weekly'?'文字周报按周一至周日查看；切换周期后可查看该期已保存的汇报。':'文字月报按整月查看；切换周期后可查看该期已保存的汇报。'};
}
