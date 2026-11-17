import {applyAction} from '../core.ts';
import {digest} from './core.ts';
import {WorkbenchError,type Entry} from '../../lib/workbench/domain.ts';
import type {Actor} from './model.ts';
import type {CompanyTx} from './store.ts';

export async function memberWorkspace(tx:CompanyTx,actor:Actor,body:{companyId?:string;login?:string;operation?:unknown}){
 if(actor.owner||!actor.companyId||!actor.login||body.companyId!==actor.companyId||body.login!==actor.login){
  throw new WorkbenchError('当前账号已变化，请重新打开自己的工作总览',403);
 }
 const key='workspace_'+digest(JSON.stringify([actor.companyId,actor.login])).slice(0,32);
 const state=await tx.get<{revision:number;recordsJson:string}>(key);
 const records:Entry[]=state?JSON.parse(state.recordsJson):[];
 if(body.operation===undefined)return {records};
 const revision=state?.revision??0;
 const next=applyAction(records,body.operation,new Date(),revision);
 if(next.records!==records){
  const recordsJson=JSON.stringify(next.records);
  if(Buffer.byteLength(recordsJson)>850000)throw new WorkbenchError('成员空间容量不足，请先导出自己的备份',413);
  await tx.put(key,{recordsJson,revision:Math.max(revision+1,...next.records.map(r=>r.version))});
 }
 return next.result;
}
