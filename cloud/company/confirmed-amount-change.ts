import type {CompanyTx} from './store.ts';
import type {OperatingHead,OperatingRecord,OperatingSnapshot,OperatingVersion} from './operating-model.ts';
import {commonOperatingDefinition,operatingFields} from '../../lib/workbench/operating-data.ts';
import {operatingTableTotals} from '../../lib/workbench/operating-paste.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';

function amount(snapshot:OperatingSnapshot,key:string){
 const field=operatingFields(snapshot.sheet,snapshot.template).find(field=>field.key===key&&field.kind==='money');
 if(!field)throw new WorkbenchError('这个金额字段在确认版本之间不可比。',409);
 return operatingTableTotals(snapshot.rows,[field],true)[key];
}

export async function confirmedAmountChange(tx:CompanyTx,heads:OperatingHead[],companyId:string,field:string,versionKey:(id:string,v:number)=>string){
 const approved:OperatingSnapshot[]=[];
 for(const head of heads){
  const current=await tx.get<OperatingRecord>(head.id),s=current?.published;
  if(!s||s.companyId!==companyId||s.id!==head.id||s.projectId!==head.projectId||s.sheet!==head.sheet||s.date!==head.date||s.version!==head.publishedVersion||s.status!=='approved')throw new WorkbenchError('确认版本已变化，请刷新报表。',409);
  approved.push(s);
 }
 approved.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
 const latest=approved[0];
 if(!latest)return {rows:[],total:null};
 if(latest.template&&!commonOperatingDefinition(approved))throw new WorkbenchError('期间指标口径发生变化，请选取可比期间。',409);
 const rows:{date:string;before:number|null;after:number|null;delta:number|null;first:boolean}[]=[];
 let batch:string|undefined;
 for(const s of approved){
  if(s!==latest&&(!batch||s.submittedBy!==latest.submittedBy))continue;
  const version=await tx.get<OperatingVersion>(versionKey(s.id,s.version-1)),submitted=version?.operating;
  if(!submitted||submitted.status!=='submitted'||submitted.id!==s.id||submitted.companyId!==companyId||submitted.projectId!==s.projectId||submitted.sheet!==s.sheet||submitted.date!==s.date||submitted.version!==s.version-1||submitted.submittedBy!==s.submittedBy)throw new WorkbenchError('提交批次历史不完整，请核对后重试。',409);
  if(s===latest)batch=submitted.submissionBatchId;
  else if(submitted.submissionBatchId!==batch)continue;
  const old=submitted.published;
  if(old&&(old.id!==s.id||old.companyId!==companyId||old.projectId!==s.projectId||old.date!==s.date||old.sheet!==s.sheet||old.status!=='approved'))throw new WorkbenchError('此前确认版本不一致，无法比较。',409);
  if(old&&s.template&&!commonOperatingDefinition([old,s]))throw new WorkbenchError('确认版本的指标定义已变化，无法比较。',409);
  const before=old?amount(old,field):null,after=amount(s,field);
  rows.push({date:s.date,before,after,delta:after===null||old&&before===null?null:after-(before??0),first:!old});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 let sum=BigInt(0);
 for(const row of rows)if(row.delta!==null)sum+=BigInt(row.delta);
 const total=Number(sum);
 if(!Number.isSafeInteger(total))throw new WorkbenchError('批次变化金额超出可显示范围。',409);
 return {rows,total:rows.some(row=>row.delta===null)?null:total};
}
