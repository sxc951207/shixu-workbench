import {z} from 'zod';
import type {OperatingRecord,OperatingSheet} from '../../cloud/company/operating-model.ts';
import type {OperatingDraftStorage} from './operating-local-draft.ts';
import {importDayComplete,importSubmitIssue,reconciledStatus,type ImportMonth,type OperatingImportEntry,type OperatingImportReceipt} from './operating-reimport.ts';
import {operatingDate} from './operating-data.ts';

type Entry=Pick<OperatingImportReceipt,'sheet'|'date'|'outcome'|'recordVersion'>&{unconfirmedSource?:string};
const outcomes=['created','updated','reconciled','unchanged','review','skipped','errors','pending'] as const;
const statuses:Record<Entry['outcome'],string>={
 reconciled:reconciledStatus,created:'已保存草稿',updated:'已按新表更新草稿',unchanged:'与原表一致',
 review:'上次差异尚待核对，请重新选择原表',skipped:'上次已跳过，请重新选择原表核对',
 errors:'上次导入未核实，请重新选择原表核对',pending:'上次尚未处理，请重新选择原表'
};
const entrySchema=z.object({
 sheet:z.string().regex(/^(revenue|targets|meituan|douyin|meituan-stores|douyin-stores|tpl_[a-z0-9_]{1,32})$/).transform(value=>value as OperatingSheet),
 date:z.string().refine(value=>{try{return operatingDate(value)===value;}catch{return false;}}),
 outcome:z.enum(outcomes),recordVersion:z.number().int().positive().optional(),
 unconfirmedSource:z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();
const envelopeSchema=z.object({savedAt:z.number().int().nonnegative(),entries:z.array(entrySchema).min(1).max(3000)}).strict();
const lifetime=7*24*60*60*1000;

export function receiptStorageKey(companyId:string,login:string,projectId:string){
 return 'shixu-operating-receipt:v1:'+JSON.stringify([companyId,login,projectId]);
}
// Only an unacknowledged write needs a source match. Compare the selected, normalized
// input (including blanks and zeroes) without saving workbook rows or reading them back.
export async function importSourceFingerprint(scope:string,entries:readonly OperatingImportEntry[]){
 try{
  const source=entries.map(entry=>{
   const columns=[...entry.columns].sort();
   const rows=entry.rows.map(row=>[row.storeId,...columns.map(key=>row.values[key]??null)] as const)
    .sort((a,b)=>a[0].localeCompare(b[0]));
   return [entry.sheet,entry.date,columns,rows,entry.sharedAdSpend??null] as const;
  }).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  const bytes=new TextEncoder().encode(JSON.stringify([scope,source]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 }catch{return undefined;}
}
export function unconfirmedImportReceipts(entries:readonly Entry[],source:string|undefined):OperatingImportReceipt[]{
 if(!source)return [];
 return entries.filter(entry=>entry.outcome==='errors'&&entry.unconfirmedSource===source)
  .map(({sheet,date})=>({sheet,date,outcome:'errors',status:'上次保存未确认',saveUnconfirmed:true}));
}
export function receiptLocator(entries:readonly (Entry&{saveUnconfirmed?:boolean})[],source?:string):Entry[]{
 return entries.map(({sheet,date,outcome,recordVersion,unconfirmedSource,saveUnconfirmed})=>{
  const marker=outcome==='errors'&&(unconfirmedSource||(saveUnconfirmed&&source));
  return {sheet,date,outcome,...(recordVersion!==undefined?{recordVersion}:{}),...(marker?{unconfirmedSource:marker}:{})};
 });
}
export function writeReceiptLocator(storage:OperatingDraftStorage,key:string,entries:readonly Entry[],now=Date.now()){
 try{
  const envelope=envelopeSchema.parse({savedAt:now,entries:receiptLocator(entries)});
  storage.setItem(key,JSON.stringify(envelope));return true;
 }catch{
  try{storage.removeItem(key);}catch{/* Browser storage may be unavailable. */}
  return false;
 }
}
export function readReceiptLocator(storage:OperatingDraftStorage,key:string,now=Date.now()):Entry[]|null{
 try{
  const raw=storage.getItem(key);
  if(!raw)return null;
  if(raw.length>512*1024)throw Error();
  const {savedAt,entries}=envelopeSchema.parse(JSON.parse(raw));
  if(now<savedAt||now-savedAt>=lifetime)throw Error();
  return entries;
 }catch{
  try{storage.removeItem(key);}catch{/* Browser storage may be unavailable. */}
  return null;
 }
}
export async function refreshReceipt(entries:readonly Entry[],readMonth:(month:string)=>Promise<ImportMonth>,owner:boolean):Promise<OperatingImportReceipt[]>{
 const months=new Set(entries.filter(importDayComplete).map(item=>item.date.slice(0,7)));
 const records=new Map<string,{record:OperatingRecord;month:ImportMonth}>();
 for(const month of months){
  const response=await readMonth(month);
  for(const record of response.records)records.set(record.sheet+':'+record.date,{record,month:response});
 }
 return entries.map(item=>{
  const status=item.outcome==='errors'&&item.unconfirmedSource?'上次保存未确认，请重新选择原表核对':statuses[item.outcome];
  if(!importDayComplete(item))return {...item,status};
  const current=records.get(item.sheet+':'+item.date);
  return current?{...item,status,record:current.record,submitIssue:importSubmitIssue(current.record,current.month,owner,item.recordVersion)}:{...item,status:status+'，此记录当前不可查看'};
 });
}
