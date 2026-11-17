import type {OperatingConfig,OperatingRecord,OperatingRow,OperatingSheet} from '../../cloud/company/operating-model.ts';
import {operatingFields,revenueDraftIssue,validateOperatingRows} from './operating-data.ts';
import {formatOperatingInput} from './operating-paste.ts';

export function compareOperatingImport(record:Pick<OperatingRecord,'sheet'|'template'|'rows'|'sharedAdSpend'>,source:{rows:OperatingRow[];columns:string[];sharedAdSpend?:number}){
 const incoming=new Map(source.rows.map(row=>[row.storeId,row]));
 const fields=operatingFields(record.sheet,record.template).filter(f=>source.columns.includes(f.key));
 if(source.rows.some(row=>fields.some(f=>row.values[f.key]!=null)&&!record.rows.some(old=>old.storeId===row.storeId)))throw Error('原表与已有记录的门店范围不同，请打开原记录核对。');
 const changes:string[]=[];
 const rows=record.rows.map(old=>{
  const next=incoming.get(old.storeId);
  if(!next)return old;
  const values={...old.values};
  for(const field of fields){
   const value=next.values[field.key],before=values[field.key];
   if(value==null||value===before)continue;
   values[field.key]=value;
   changes.push(old.storeName+' · '+field.label+' '+(formatOperatingInput(before,field.kind)||'空白')+' → '+formatOperatingInput(value,field.kind));
  }
  return {...old,values};
 });
 const sharedAdSpend=source.sharedAdSpend??record.sharedAdSpend;
 if(sharedAdSpend!==record.sharedAdSpend)changes.push('全平台累计消耗 '+(formatOperatingInput(record.sharedAdSpend,'money')||'空白')+' → '+formatOperatingInput(sharedAdSpend,'money'));
 return {rows,sharedAdSpend,changes};
}

export type OperatingImportEntry={skipReason?:string;sheet:OperatingSheet;date:string;rows:OperatingRow[];columns:string[];sharedAdSpend?:number;storeMatches?:{source:string;target:string}[]};
type ImportOutcome='created'|'updated'|'reconciled'|'unchanged'|'review'|'skipped'|'errors'|'pending';
export type OperatingImportReceipt={outcome:ImportOutcome;recordVersion?:number;saveUnconfirmed?:boolean;submitIssue?:string;record?:OperatingRecord;sheet:OperatingSheet;date:string;status:string;version?:number;changes?:string[];approved?:boolean};
export type ImportMonth={records:OperatingRecord[];config:OperatingConfig|null;permissions:{revenue:boolean;platform:boolean;projectOwner?:boolean}};
type ImportSave={sheet:OperatingSheet;date:string;rows:OperatingRow[];version:number;importCorrection?:boolean;reason?:string;sharedAdSpend?:number};
type ImportActions={
 readMonth:(month:string)=>Promise<ImportMonth>;save:(body:ImportSave)=>Promise<OperatingRecord>;
 login:string;previous:OperatingImportReceipt[];reason:string;
};

export function completeOperatingRecord(record:OperatingRecord){
 try{
  validateOperatingRows(record.sheet,record.rows,record.rows.map(row=>({id:row.storeId,name:row.storeName})),true,record.template,record.sharedAdSpend);
  return true;
 }catch{return false;}
}
export function canWriteOperatingSheet(sheet:OperatingSheet,month:ImportMonth,owner:boolean){
 if(!month.config)return false;
 if(sheet.startsWith('tpl_')){
  const writer=month.config.templates?.find(template=>template.id===sheet)?.writer;
  return !!writer&&(owner|| (writer==='project-owner'?!!month.permissions.projectOwner:writer==='supervisor'&&month.permissions.revenue));
 }
 return owner||(sheet==='revenue'||sheet==='targets'?month.permissions.revenue:month.permissions.platform);
}
export function importSubmitIssue(record:OperatingRecord,month:ImportMonth,owner:boolean,originalVersion?:number){
 if(record.status!=='draft'&&record.status!=='returned')return;
 if(!canWriteOperatingSheet(record.sheet,month,owner))return '当前账号仅可查看';
 if(originalVersion!==record.version)return originalVersion?'导入时 V'+originalVersion+'，请打开当前版本重新核对':'请打开当前版本重新核对';
 if(!completeOperatingRecord(record))return '请先补齐必填项';
}
export const reconciledStatus='已重新核实云端内容一致，前次保存结果未收到';
export function importDayComplete(receipt:Pick<OperatingImportReceipt,'outcome'>){
 return receipt.outcome==='created'||receipt.outcome==='updated'||receipt.outcome==='unchanged'||receipt.outcome==='reconciled';
}
export function importReceiptStage(receipt:OperatingImportReceipt){
 return importDayComplete(receipt)&&receipt.record?receipt.record.status:'unresolved';
}
export function operatingImportCounts(receipts:OperatingImportReceipt[]){
 const counts={created:0,updated:0,unchanged:0,reconciled:0,review:0,skipped:0,errors:0,pending:0};
 for(const receipt of receipts)counts[receipt.outcome]++;
 return counts;
}

export async function saveOperatingImportBatch(entries:OperatingImportEntry[],actions:ImportActions):Promise<OperatingImportReceipt[]>{
 const months=new Map<string,ImportMonth>(),receipts:OperatingImportReceipt[]=[];
 for(const entry of entries){
  const {sheet,date,rows,sharedAdSpend}=entry,month=date.slice(0,7),identity={sheet,date};
  const previous=actions.previous.find(r=>r.sheet===sheet&&r.date===date);
  let saveUnconfirmed=previous?.saveUnconfirmed??false;
  try{
   if(entry.skipReason){receipts.push({...identity,outcome:'skipped',status:entry.skipReason});continue;}
   if(!months.has(month))months.set(month,await actions.readMonth(month));
   const remote=months.get(month)!,existing=remote.records.find(r=>r.sheet===sheet&&r.date===date);
   if(sheet==='targets'){
    if(!remote.permissions.revenue){receipts.push({...identity,outcome:'skipped',status:'当前账号无权保存门店月目标'});continue;}
    if(!existing&&remote.config?.builtinSheets&&!remote.config.builtinSheets.includes('targets')){receipts.push({...identity,outcome:'skipped',status:'项目尚未启用门店月目标'});continue;}
    if(rows.every(r=>r.values.target==null)){receipts.push({...identity,outcome:'skipped',status:'目标金额均为空，此月未保存'});continue;}
   }
   const issue=revenueDraftIssue(sheet,rows,existing?.template??remote.config?.templates?.find(t=>t.id===sheet));
   if(issue){receipts.push({...identity,outcome:'skipped',status:'原表未读到业绩金额，此日未保存。'+issue});continue;}
   if(!existing){
    saveUnconfirmed=true;
    const record=await actions.save({...identity,version:0,rows,...(sharedAdSpend!==undefined?{sharedAdSpend}:{})});
    receipts.push({...identity,outcome:'created',status:'已保存草稿',record});continue;
   }
   const diff=compareOperatingImport(existing,entry);
   if(!diff.changes.length){
    const priorWrite=previous?.outcome==='created'||previous?.outcome==='updated'||previous?.outcome==='reconciled';
    const outcome=saveUnconfirmed?'reconciled':priorWrite?previous.outcome:'unchanged';
    const status=saveUnconfirmed?reconciledStatus:priorWrite?previous.status:'与原表一致';
    receipts.push({...identity,outcome,status,record:existing});continue;
   }
   if(existing.status==='submitted'&&existing.submittedBy!==actions.login){
    receipts.push({...identity,outcome:'skipped',status:'正在审核，请原提交人撤回或由主管退回。',changes:diff.changes});continue;
   }
   if(previous?.outcome!=='review'||previous.version!==existing.version){
    receipts.push({...identity,outcome:'review',status:'待核对差异 · V'+existing.version,version:existing.version,changes:diff.changes,approved:existing.status==='approved'});continue;
   }
   saveUnconfirmed=true;
   const record=await actions.save({...identity,version:existing.version,importCorrection:true,reason:actions.reason,rows:diff.rows,sharedAdSpend:diff.sharedAdSpend});
   receipts.push({...identity,outcome:'updated',status:'已按新表更新草稿',record});
  }catch(e){
   receipts.push({...identity,outcome:'errors',saveUnconfirmed,status:(saveUnconfirmed?'保存未确认：':'核对未完成：')+(e as Error).message});
   for(const pending of entries.slice(receipts.length)){
    const prior=actions.previous.find(r=>r.sheet===pending.sheet&&r.date===pending.date);
    receipts.push(prior??{sheet:pending.sheet,date:pending.date,outcome:'pending',status:'尚未处理，可重试'});
   }
   break;
  }
 }
 return receipts.map(item=>{
  const remote=months.get(item.date.slice(0,7));
  if(!item.record||!remote)return item;
  const recordVersion=item.recordVersion??item.record.version;
  return {...item,recordVersion,submitIssue:importSubmitIssue(item.record,remote,actions.login==='owner',recordVersion)};
 });
}
