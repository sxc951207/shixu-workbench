import {createHash} from 'node:crypto';
import {validateEntry,parseBackup,WorkbenchError,todayShanghai,validateAssociations} from '../lib/workbench/domain.ts';
import type {Entry} from '../lib/workbench/domain.ts';
import{dailyTasks}from'../lib/workbench/daily.ts';
export function applyAction(records:Entry[],body:any,clock=new Date(),versionFloor=0):{records:Entry[];result:unknown}{
 if(!body||typeof body!=='object'||Array.isArray(body))throw new WorkbenchError('请求格式无效');
 let next=[...records],result:unknown;
 if(body.action==='save'){
  let e=validateEntry(body.record);const old=records.find(x=>x.id===e.id);
  if(old?.routineId&&(old.routineId!==e.routineId||old.routineDate!==e.routineDate))throw new WorkbenchError('每日事项的来源和原日期不能修改');
  if(old&&(old.kind!==e.kind||old.version!==body.expectedVersion)||!old&&body.expectedVersion!=null)throw new WorkbenchError('这条内容已在另一处更新，请保留文字并刷新后重试',409);
  const now=new Date(Math.max(Date.now(),old?Date.parse(old.updatedAt)+1:0)).toISOString();
  e={...e,version:old?old.version+1:1,createdAt:old?.createdAt??now,updatedAt:now};next=[e,...records.filter(x=>x.id!==e.id)];result={record:e};
 }else if(body.action==='convert'){
  const n=records.find(x=>x.id===body.id);if(!n||n.kind!=='note'||n.deleted)throw new WorkbenchError('笔记不存在',404);
  const id='from-'+createHash('sha256').update(n.id).digest('hex'),existing=records.find(e=>e.id===id);
  if(existing)return{records,result:{record:existing}};
  if(n.version!==body.version)throw new WorkbenchError('笔记已在另一处更新，请刷新后重试',409);
  const now=new Date().toISOString(),e=validateEntry({id,kind:'task',title:n.title||n.body.slice(0,60),body:n.body,companyId:n.companyId,due:todayShanghai(),createdAt:now,updatedAt:now,version:1});next=[e,...records];result={record:e};
 }else if(body.action==='prepare-daily'){
  const today=todayShanghai(clock),added=dailyTasks(records,today,clock.toISOString());
  next=added.length?[...added,...records]:records;result={records:next,generated:added.length,today};
 }else if(body.action==='import'){
  const entries=parseBackup(body.backup),map=new Map(records.map(e=>[e.id,e]));let imported=0;
  for(const e of entries){const old=map.get(e.id);if(old?.routineId&&(old.routineId!==e.routineId||old.routineDate!==e.routineDate))throw new WorkbenchError('每日事项的来源和原日期不能修改');if(old&&old.kind!==e.kind)throw new WorkbenchError('备份记录类型冲突',409);if(!old||e.updatedAt>old.updatedAt){map.set(e.id,{...e,version:old?old.version+1:Math.max(1,e.version)});imported++;}}
  next=[...map.values()];result={imported};
 }else throw new WorkbenchError('不支持的操作');
 if(versionFloor>0&&next!==records){const previous=new Map(records.map(e=>[e.id,e]));next=next.map(e=>previous.get(e.id)===e?e:validateEntry({...e,version:Math.max(e.version,versionFloor+1)}));const output=result as {record?:Entry;records?:Entry[]};if(output.record)output.record=next.find(e=>e.id===output.record!.id);if(output.records)output.records=next;}
 validateAssociations(next);
 if(next.length>10000||Buffer.byteLength(JSON.stringify(next))>4*1024*1024)throw new WorkbenchError('当前个人工作台数据上限为 4 MB，请先导出备份后整理内容');
 return{records:next,result};
}
