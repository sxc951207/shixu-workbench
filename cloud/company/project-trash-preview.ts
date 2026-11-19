import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {loadCompany,projectAt} from './core.ts';
import {readReportIndex} from './confirmed-reports.ts';
import {readIndex} from './operating.ts';
import type {CompanyTx} from './store.ts';
import type {Actor} from './model.ts';

export async function projectTrashPreview(tx:CompanyTx,actor:Actor,body:{companyId:string;id:string}){
 if(!actor.owner)throw new WorkbenchError('只有管理员可删除项目',403);
 const {c}=await loadCompany(tx,actor,body.companyId),project=await projectAt(tx,c,body.id);
 let reports=0,records=0,lastDate='';
 for(const month of Object.keys(c.operatingMonths||{})){
  const index=await readIndex(tx,c,month);
  for(const head of index.items)if(head.projectId===project.id){
   records++;if(head.date>lastDate)lastDate=head.date;
  }
 }
 for(const month of Object.keys(c.reportMonths||{})){
  const index=await readReportIndex(tx,c,month);
  reports+=index.items.filter(head=>head.projectId===project.id).length;
 }
 return {revision:c.revision,version:project.version,reports,records,lastDate};
}
