import {digest,text} from './core.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {isOperatingReportNote} from '../../lib/workbench/operating-report-note.ts';
import type {OperatingConfig} from './operating-model.ts';
import type {CompanyTx} from './store.ts';

export async function operatingStoreAliases(tx:CompanyTx,companyId:string,config:OperatingConfig,b:any){
 const channel=b.sheet==='meituan-stores'?'meituan':b.sheet==='douyin-stores'?'douyin':b.sheet;
 const key='store_alias_'+digest(JSON.stringify([companyId,config.projectId,channel])).slice(0,32);
 const state=await tx.get<{aliases:[string,string][]}>(key);
 const stores=new Set(config.stores.map(s=>s.id));
 const map=new Map((state?.aliases||[]).filter(([,id])=>stores.has(id)));
 if(b.action==='ops.storeAlias.save'){
  const source=text(b.source,200,true);
  if(isOperatingReportNote([source]))throw new WorkbenchError('统计说明无需对应门店');
  const id=b.storeId;
  if(id!==null&&!stores.has(id))throw new WorkbenchError('请选择本项目现有门店');
  const current=map.get(source)??null;
  if(current!==id){
   if(current!==b.previous)throw new WorkbenchError('门店对应已发生变化，请刷新后核对',409);
   if(id===null)map.delete(source);else map.set(source,id);
   if(map.size>600)throw new WorkbenchError('对应名称已达上限，请清理不用的门店别名');
   await tx.put(key,{aliases:[...map]});
  }
 }
 return {aliases:[...map]};
}
