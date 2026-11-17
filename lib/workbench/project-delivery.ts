import type{WorkItem}from'../../cloud/company/work-model.ts';
import{WorkbenchError,todayShanghai}from'./domain.ts';
export function workDate(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1970-01-01'||value>'2100-12-31')throw new WorkbenchError('日期无效');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new WorkbenchError('日期无效');return value;}
const day=(v:string)=>Date.parse(workDate(v)+'T00:00:00Z')/86400000;
export function itemState(item:WorkItem,today:string):'done'|'overdue'|'soon'|'open'{if(item.status==='done')return'done';const distance=day(item.due)-day(today);return distance<0?'overdue':distance<=3?'soon':'open';}
export function waitingDays(at:string,today:string):number{const d=new Date(at);return Number.isFinite(d.getTime())?Math.max(0,day(today)-day(todayShanghai(d))):0;}
export function timelineBounds(items:WorkItem[],today:string):{start:string;end:string;days:number}{const start=items.length?items.map(x=>workDate(x.start)).sort()[0]:workDate(today),end=items.length?items.map(x=>workDate(x.due)).sort().at(-1)!:workDate(today);return{start,end,days:day(end)-day(start)+1};}
export function timelinePosition(item:WorkItem,bounds:{start:string;end:string;days:number}){return{left:(day(item.start)-day(bounds.start))/bounds.days*100,width:(day(item.due)-day(item.start)+1)/bounds.days*100};}
