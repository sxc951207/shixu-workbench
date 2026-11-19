import {activeProjects} from './model.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {reportPeriod} from '../../lib/workbench/report-period.ts';
import type {DailyRoster,DailyRosterRow} from '../../lib/workbench/daily-roster.ts';
import {MAX_DAILY_SCHEDULE_GROUPS} from '../../lib/workbench/daily-roster.ts';
import {readReportIndex} from './confirmed-reports.ts';
import {saveDirectory} from './core.ts';
import type {Actor,Company,Member} from './model.ts';
import {canReviewDaily} from './reports.ts';
import type {CompanyTx} from './store.ts';

export async function dailyRosterAction(tx:CompanyTx,actor:Actor,c:Company,member:Member|null|undefined,b:any){
 if(!actor.owner&&!member?.roles.includes('supervisor'))throw new WorkbenchError('没有主管日报名单权限',403);
 const {start:date}=reportPeriod('daily',b.periodDate),month=date.slice(0,7),day=Number(date.slice(8));
 const managed=activeProjects(c).filter(p=>actor.owner||p.reviewerLogin===member?.login);
 const projects=managed.map(p=>({id:p.id,name:p.name,employees:c.members.filter(m=>m.active&&m.roles.includes('employee')&&(m.login===p.ownerLogin||p.participants.includes(m.login))).map(({login,name})=>({login,name}))}));
 const schedules=c.dailySchedules||[];
 if(b.action==='report.dailySchedule'){
  const project=projects.find(p=>p.id===b.projectId);
  if(!project)throw new WorkbenchError('没有该项目的日报安排权限',403);
  if(typeof b.login!=='string'||typeof b.assigned!=='boolean')throw new WorkbenchError('请选择员工与安排状态');
  const slot=schedules.find(s=>s.projectId===project.id&&s.login===b.login&&s.month===month);
  if(b.assigned&&!project.employees.some(e=>e.login===b.login))throw new WorkbenchError('只能安排本项目当前在岗的员工',403);
  if(Boolean(slot?.days.includes(day))===b.assigned)return {companyRevision:c.revision};
  if(b.revision!==c.revision)throw new WorkbenchError('日报安排已变化，请刷新名单再操作',409);
  if(!slot&&schedules.length>=MAX_DAILY_SCHEDULE_GROUPS)throw new WorkbenchError('日报安排已达到公司容量，请联系管理员');
  c.dailySchedules=schedules.filter(s=>s!==slot);
  const days=(slot?.days||[]).filter(value=>value!==day);
  if(b.assigned)days.push(day);
  if(days.length)c.dailySchedules.push({projectId:project.id,login:b.login,month,days:days.sort((a,b)=>a-b)});
  c.revision++;await saveDirectory(tx,c);
  return {companyRevision:c.revision};
 }
 const rows=new Map<string,DailyRosterRow>(),byProject=new Map(managed.map(p=>[p.id,p]));
 const names=new Map(c.members.map(m=>[m.login,m.name]));
 for(const s of schedules){
  const project=byProject.get(s.projectId);
  if(!project||s.month!==month||!s.days.includes(day))continue;
  rows.set(s.projectId+':'+s.login,{projectId:project.id,projectName:project.name,login:s.login,name:names.get(s.login)||s.login,assigned:true,status:'due'});
 }
 const index=await readReportIndex(tx,c,month);
 for(const h of index.items){
  const project=byProject.get(h.projectId);
  if(!project||h.kind!=='daily'||h.start!==date||!h.authorLogin)continue;
  const status=h.status==='draft'?(h.publishedVersion?'approved':undefined):h.status;
  if(!status)continue;
  const key=project.id+':'+h.authorLogin;
  const row:DailyRosterRow={projectId:project.id,projectName:project.name,login:h.authorLogin,name:names.get(h.authorLogin)||(h.authorLogin==='owner'?'管理员':h.authorLogin),assigned:rows.has(key),status};
  if(canReviewDaily(actor,c,project,h))row.review={type:'daily',id:h.id,projectId:project.id,projectName:project.name,date,start:date,end:date,version:h.version,submittedBy:h.submittedBy,submittedAt:null,amendment:!!h.publishedVersion};
  rows.set(key,row);
 }
 return {date,companyRevision:c.revision,projects,rows:[...rows.values()]} satisfies DailyRoster;
}
