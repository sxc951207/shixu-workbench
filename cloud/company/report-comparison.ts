import {supervisedProjects} from './supervised.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {buildReportComparison,comparisonPeriods} from '../../lib/workbench/report-comparison.ts';
import type {Actor,ReportSnapshot} from './model.ts';
import type {CompanyTx} from './store.ts';
import {loadCompany} from './core.ts';
import {confirmedHeads,snapshotAt} from './confirmed-reports.ts';

function fail(message:string,status=409):never{throw new WorkbenchError(message,status);}
export async function executeReportComparison(tx:CompanyTx,actor:Actor,b:any,_clock=new Date()):Promise<any>{
 const{c,member}=await loadCompany(tx,actor,b.companyId);
 if(b.action!=='report.compare')fail('不支持的报表对比操作',400);
 const supervised=b.scope==='supervised'?supervisedProjects(member):undefined;
 if(!supervised&&!actor.owner&&!member!.roles.includes('leader'))fail('没有已确认报表对比的权限',403);
 if(b.revision!==undefined&&b.revision!==c.revision)fail('公司内容已发生变化，请重新准备对比');
 if(b.projectId!==undefined&&typeof b.projectId!=='string')fail('项目编号无效',400);
 const projectId=b.projectId||'';if(projectId&&!c.projects.some(p=>p.id===projectId&&(!supervised||supervised(p))))fail('项目不存在',404);
 if(b.page!==undefined&&(!Number.isSafeInteger(b.page)||b.page<0||b.page>=10))fail('对比页码无效',400);
 const{period,previousPeriod}=comparisonPeriods(b.kind,b.periodDate),current=await confirmedHeads(tx,c,actor,period,projectId,supervised),previous=await confirmedHeads(tx,c,actor,previousPeriod,projectId,supervised),currentByProject=new Map(current.map(h=>[h.projectId,h])),previousByProject=new Map(previous.map(h=>[h.projectId,h]));
 const ids=[...new Set([...currentByProject.keys(),...previousByProject.keys()])].sort(),page=b.page||0,now:ReportSnapshot[]=[],before:ReportSnapshot[]=[];
 if(ids.length>200)fail('报表项目目录不一致，请联系管理员');
 for(const id of ids.slice(page*20,page*20+20)){
  const a=await snapshotAt(tx,c,currentByProject.get(id),period),z=await snapshotAt(tx,c,previousByProject.get(id),previousPeriod);if(a)now.push(a);if(z)before.push(z);
 }
 return{period,previousPeriod,pairs:buildReportComparison(now,before),total:ids.length,page,companyRevision:c.revision};
}
