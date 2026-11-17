import{inCompany,isTodayTask,todayShanghai}from'./domain.ts';import type{Entry}from'./domain.ts';
export function desktopTasks(records:Entry[],scope:string,today:string,view:'today'|'daily'){
 return records.filter(e=>e.kind==='task'&&!e.deleted&&inCompany(e,scope)&&(view==='daily'?e.routineDate===today:isTodayTask(e,today)||e.done&&todayShanghai(new Date(e.updatedAt))===today)).sort((a,b)=>Number(a.done)-Number(b.done)||Number(b.priority==='high')-Number(a.priority==='high')||(a.due||'9999').localeCompare(b.due||'9999'));
}
