import{validateEntry,dailyTaskId,WorkbenchError}from'./domain.ts';import type{Entry}from'./domain.ts';
export const weekdays=[1,2,3,4,5,6,7];
export function repeatLabel(days:number[]=[]){
 const sorted=[...days].sort((a,b)=>a-b),key=sorted.join(',');
 if(key==='1,2,3,4,5,6,7')return'每天';if(key==='1,2,3,4,5')return'工作日';if(key==='6,7')return'周末';
 return sorted.map(n=>'周'+['','一','二','三','四','五','六','日'][n]).join('、');
}
export function dailyTasks(records:Entry[],day:string,now=new Date().toISOString()):Entry[]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new WorkbenchError('每日日期无效');
 const weekday=new Date(day+'T12:00:00Z').getUTCDay()||7,map=new Map(records.map(e=>[e.id,e]));
 return records.filter(r=>r.kind==='routine'&&!r.deleted&&!r.archived&&!!r.due&&r.due<=day&&r.repeatDays?.includes(weekday)).flatMap(r=>{
  const id=dailyTaskId(r.id,day),existing=map.get(id);if(existing){if(existing.kind!=='task'||existing.routineId!==r.id||existing.routineDate!==day)throw new WorkbenchError('每日事项编号已被其他记录占用，请检查备份',409);return[];}
  return[validateEntry({id,kind:'task',title:r.title,body:r.body,priority:r.priority,companyId:r.companyId,due:day,routineId:r.id,routineDate:day,version:1,createdAt:now,updatedAt:now})];
 });
}
