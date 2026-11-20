import {memberLoginPattern} from './member-login.ts';
import {approvalFlowSchema} from './approval-flow-schema.ts';
import {z} from 'zod';
import {WorkbenchError} from './domain.ts';
import {operatingTemplateSchema} from './operating-templates.ts';
export {operatingTemplateSchema,operatingTemplatePresets,operatingTemplateMetrics} from './operating-templates.ts';
import type {OperatingBuiltinSheet,OperatingField,OperatingRecord,OperatingRow,OperatingSheet,OperatingSnapshot,OperatingStore,OperatingTemplate} from '../../cloud/company/operating-model.ts';

type Field=OperatingField;
const field=(key:string,label:string,kind:Field['kind']='count',required=true):Field=>({key,label,kind,required});
const financial=[field('orderedCoupons','下单券数'),field('orderAmount','下单金额','money'),field('verifiedCoupons','核销券数'),field('verifiedAmount','核销金额','money'),field('refundOrders','退款订单数'),field('refundAmount','退款金额','money'),field('adSpend','推广花费','money')];
const fields:Record<OperatingBuiltinSheet,Field[]>={
 revenue:[field('revenue','门店总业绩','money')],targets:[field('target','月目标','money')],
 meituan:[...financial,field('naturalExposure','自然曝光','count',false),field('paidExposure','付费曝光','count',false),field('consultations','咨询数','count',false),field('leads','线索数','count',false),field('positiveReviews','新增好评','count',false),field('stars','星级','stars',false)],
 douyin:[...financial,field('shopVisits','进店次数','count',false),field('shopVisitors','进店人数','count',false),field('privateContacts','私信咨询人数','count',false),field('privateOpens','私信开口人数','count',false),field('privateLeads','私信留资人数','count',false)],
 'meituan-stores':[...financial,field('positiveReviews','新增好评','count',false),field('stars','星级','stars',false)],'douyin-stores':[...financial,field('positiveReviews','新增好评','count',false),field('negativeReviews','新增中差评','count',false),field('stars','评分','stars',false)],
};
function fail(message:string):never{throw new WorkbenchError(message);}
export function operatingFields(sheet:OperatingSheet,template?:OperatingTemplate):Field[]{
 if(typeof sheet==='string'&&sheet.startsWith('tpl_')){
  const parsed=operatingTemplateSchema.safeParse(template);if(!parsed.success||parsed.data.id!==sheet)fail('经营模板定义缺失或编号不匹配');return parsed.data.fields.map(f=>({...f}));
 }
 if(!Object.hasOwn(fields,sheet)||template!==undefined)fail('经营表类型无效');
 return fields[sheet as OperatingBuiltinSheet].map(f=>({...f}));
}
export function isStoreRevenueSheet(sheet:OperatingSheet,template?:OperatingTemplate):boolean{
 if(sheet==='revenue')return true;
 if(template?.dimension!=='store'||template.fields.length!==1)return false;
 const field=template.fields[0];
 return field.key==='revenue'&&field.label==='门店总业绩'&&field.kind==='money';
}
export function selectStoreRevenueSource(records:OperatingRecord[]){
 const eligible=records.filter(record=>isStoreRevenueSheet(record.sheet,record.template));
 const builtin=eligible.filter(record=>record.sheet==='revenue');
 if(builtin.length)return {records:builtin,issue:''};
 if(new Set(eligible.map(record=>record.sheet)).size>1)return {records:[],issue:'有多份门店总业绩模板，请先核对所选期间的业绩来源'};
 return {records:eligible,issue:''};
}
export function revenueDraftIssue(sheet:OperatingSheet,rows:OperatingRow[],template?:OperatingTemplate):string{
 if(isStoreRevenueSheet(sheet,template)&&!rows.some(row=>row.values.revenue!=null)){
  return '请至少填写一家门店的业绩金额。当天确实没有业绩时可填 0。';
 }
 return '';
}
export function parseOperatingInput(text:string,kind:Field['kind']):number|null{
 if(typeof text!=='string'||!['money','count','stars'].includes(kind))fail('经营数值格式无效');
 const raw=text.trim();if(!raw)return null;
 const decimals=kind==='money'?2:kind==='stars'?1:0;
 const pattern=new RegExp('^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)' +(decimals?'(?:\\.[0-9]{1,'+decimals+'})?':'')+'$');
 if(raw.length>80||!pattern.test(raw))fail(kind==='money'?'金额请填写非负数字，最多两位小数':kind==='count'?'数量请填写非负整数':'星级请填写0到5，最多一位小数');
 const plain=raw.replaceAll(',','');
 if(kind==='money'){
  const[whole,fraction='']=plain.split('.');const cents=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))fail('金额超出安全范围');return Number(cents);
 }
 const value=Number(plain);if(!Number.isFinite(value)||value<0||kind==='count'&&!Number.isSafeInteger(value)||kind==='stars'&&value>5)fail('数量或星级超出范围');return value;
}
export function operatingDate(date:string):string{
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1970-01-01'||date>'2100-12-31')fail('请选择有效经营日期');
 const parsed=new Date(date+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)fail('请选择有效经营日期');return date;
}
const nonnegative=z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const name=z.string().min(1).max(80).refine(v=>v.trim()===v&&!!v.trim());
const storeId=z.string().regex(/^s0(?:0[1-9]|[12][0-9]|30)$/);
const storeSchema=z.object({id:storeId,name}).strict();
const storeList=z.array(storeSchema).max(30).refine(stores=>new Set(stores.map(s=>s.id)).size===stores.length&&new Set(stores.map(s=>s.name)).size===stores.length,'门店编号或名称重复');
const storesSchema=storeList.refine(stores=>stores.length>0,'至少需要一行门店或渠道');
const projectId=z.string().regex(/^p_[a-f0-9]{24}$/);
const builtinSheetSchema=z.enum(['revenue','targets','meituan','douyin','meituan-stores','douyin-stores']);
export const defaultRevenueNote='门店总业绩包含抖音、美团和其他渠道的业绩。';
export const operatingConfigSchema=z.object({projectId,stores:storeList,templates:z.array(operatingTemplateSchema).max(12).optional(),builtinSheets:z.array(builtinSheetSchema).max(6).optional(),dimensionLabel:z.string().min(1).max(12).refine(v=>!!v.trim()&&v.trim()===v).optional(),revenueNote:z.string().trim().min(1).max(300).optional(),confirmedProjectName:z.string().min(1).max(80).optional()}).strict().superRefine((config,ctx)=>{
 const builtin=config.builtinSheets||Object.keys(fields);
 if(new Set(builtin).size!==builtin.length||new Set(config.templates?.map(t=>t.id)).size!==(config.templates?.length||0))ctx.addIssue({code:z.ZodIssueCode.custom,message:'启用的经营表或模板编号重复'});
 if(!config.stores.length&&(builtin.some(s=>s!=='meituan'&&s!=='douyin')||config.templates?.some(t=>t.active&&t.dimension==='store')))ctx.addIssue({code:z.ZodIssueCode.custom,message:'启用门店或渠道表时请先配置行'});
});
const rowSchema=z.object({storeId:z.union([storeId,z.literal('all')]),storeName:name,values:z.record(z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable())}).strict();
export const operatingProposalSchema=z.object({
 id:z.string().regex(/^ip_[a-f0-9]{24}$/),projectId,status:z.enum(['submitted','returned']),
 submittedBy:z.string().regex(memberLoginPattern).refine(s=>s!=='owner'),submittedName:z.string().trim().min(1).max(40),
 submittedAt:z.string().datetime(),comment:z.string().max(1000),baseDigest:z.string().regex(/^[a-f0-9]{64}$/),config:operatingConfigSchema
}).strict().superRefine((proposal,ctx)=>{
 const config=proposal.config;
 if(config.projectId!==proposal.projectId||config.confirmedProjectName!==undefined||config.builtinSheets?.length!==0||!config.templates?.length||config.templates.some(t=>t.writer!=='project-owner')||
   (proposal.status==='returned'?!proposal.comment.trim():!!proposal.comment))ctx.addIssue({code:z.ZodIssueCode.custom,message:'待确认指标配置或退回说明无效'});
});
export function validateOperatingRows(sheet:OperatingSheet,rows:OperatingRow[],stores:OperatingStore[],complete=false,template?:OperatingTemplate,sharedAdSpend?:number):OperatingRow[]{
 if(sharedAdSpend!==undefined&&(sheet!=='douyin-stores'||!Number.isSafeInteger(sharedAdSpend)||sharedAdSpend<0||rows.some(r=>r.values.adSpend!=null)))fail('平台累计消耗须单独记录，不能与门店推广花费混填');
 const descriptors=operatingFields(sheet,template),platform=sheet==='meituan'||sheet==='douyin';
 const result=z.array(rowSchema).min(1).max(30).safeParse(rows);if(!result.success)fail('经营行或数值格式无效');const parsed=result.data;
 const total=template?.dimension==='total'||platform&&parsed.some(r=>r.storeId==='all');
 const config=total?null:storesSchema.safeParse(stores);if(config&&!config.success)fail('门店配置无效');
 const configured=total?[{id:'all',name:platform?'全平台':parsed[0].storeName}]:config!.data!;
 if(parsed.length!==configured.length||new Set(parsed.map(r=>r.storeId)).size!==parsed.length)fail('请填写完整门店行，不能重复门店');
 const known=new Map(configured.map(s=>[s.id,s.name]));
 for(const row of parsed){
  if(known.get(row.storeId)!==row.storeName)fail('门店未知或名称已变化，请重新读取');
  // Only new saves normalize these later-added optional fields; schema validation discards this copy.
  if(sheet==='meituan')for(const key of['positiveReviews','stars'])if(!Object.hasOwn(row.values,key))row.values[key]=null;
  if(sheet==='douyin-stores')for(const f of descriptors)if(!f.required&&!Object.hasOwn(row.values,f.key))row.values[f.key]=null;
  if(Object.keys(row.values).length!==descriptors.length||descriptors.some(f=>!Object.hasOwn(row.values,f.key)))fail('经营字段缺失或包含未知字段');
  for(const f of descriptors){const value=row.values[f.key];
   if(value===null){if(complete&&f.required&&!(sharedAdSpend!==undefined&&f.key==='adSpend'))fail(row.storeName+'：请填写'+f.label);continue;}
   if(f.kind==='stars'?(value>5||!Number.isInteger(value*10)):!Number.isSafeInteger(value))fail(f.label+'数值无效');
  }
 }
 return parsed;
}
const identity=z.union([z.literal('owner'),z.string().regex(memberLoginPattern)]);
const emptyIdentity=z.union([identity,z.literal('')]);
const stamp=z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/).refine(v=>{const d=new Date(v);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,19)===v.slice(0,19);});
const day=z.string().refine(v=>{try{operatingDate(v);return true;}catch{return false;}},'经营日期无效');
const snapshotSchema=z.object({approvalFlow:approvalFlowSchema.optional(),sharedAdSpend:nonnegative.optional(),
 id:z.string().regex(/^op_[a-f0-9]{32}$/),companyId:z.string().regex(/^co_[a-f0-9]{12}$/),projectId,projectName:name,
 sheet:z.union([builtinSheetSchema,z.string().regex(/^tpl_[a-z0-9_]{1,32}$/)]),date:day,status:z.enum(['draft','submitted','returned','approved']),
 version:nonnegative.min(1),publishedVersion:nonnegative,writerLogin:identity,reviewerLogin:identity,submittedBy:emptyIdentity,submittedName:z.string().max(40),submittedAt:stamp.nullable(),
 reviewerName:z.string().max(40),comment:z.string().max(1000),amendmentReason:z.string().min(1).max(1000).refine(v=>v.trim()===v&&!!v.trim()).optional(),createdAt:stamp,updatedAt:stamp,rows:z.array(rowSchema).min(1).max(30),template:operatingTemplateSchema.optional(),
}).strict();
function checkSnapshot(snapshot:OperatingSnapshot,ctx:z.RefinementCtx){
 try{validateOperatingRows(snapshot.sheet,snapshot.rows,snapshot.rows.map(r=>({id:r.storeId,name:r.storeName})),snapshot.status==='submitted'||snapshot.status==='approved',snapshot.template,snapshot.sharedAdSpend);}catch(error){ctx.addIssue({code:z.ZodIssueCode.custom,message:error instanceof Error?error.message:'经营行无效',path:['rows']});}
 if(snapshot.sheet==='targets'&&!snapshot.date.endsWith('-01'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'月目标必须保存在月首日期',path:['date']});
 if(snapshot.publishedVersion>snapshot.version||Date.parse(snapshot.createdAt)>Date.parse(snapshot.updatedAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:'经营版本或时间关系无效'});
 if(['submitted','approved'].includes(snapshot.status)&&(!snapshot.submittedBy||!snapshot.submittedName.trim()||!snapshot.submittedAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:'提交人和提交时间不完整'});
 if(snapshot.status==='approved'&&(!snapshot.reviewerName.trim()||snapshot.reviewerLogin==='owner'&&snapshot.submittedBy===snapshot.reviewerLogin))ctx.addIssue({code:z.ZodIssueCode.custom,message:'确认人无效'});
}
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const submissionBatchIdSchema=z.string().uuid();
export const operatingRecordSchema=snapshotSchema.extend({submissionBatchId:submissionBatchIdSchema.optional(),published:snapshotSchema.nullable()}).strict().superRefine((record,ctx)=>{
 if(record.submissionBatchId&&record.status!=='submitted')ctx.addIssue({code:z.ZodIssueCode.custom,message:'仅待确认记录可关联当前提交批次'});
 checkSnapshot(record as OperatingRecord,ctx);const snapshot=record.published;
 if(record.publishedVersion!==(snapshot?.version||0))ctx.addIssue({code:z.ZodIssueCode.custom,message:'确认快照版本不一致',path:['publishedVersion']});
 if(snapshot){
  checkSnapshot(snapshot as OperatingSnapshot,ctx);
  if(['id','companyId','projectId','sheet','date'].some(key=>snapshot[key as keyof typeof snapshot]!==record[key as keyof typeof record])||snapshot.status!=='approved'||snapshot.publishedVersion!==snapshot.version||snapshot.version>record.version)ctx.addIssue({code:z.ZodIssueCode.custom,message:'确认快照身份或版本不一致',path:['published']});
 }
 if(record.status==='approved'){
  const{published,...current}=record;
  if(!published||record.publishedVersion!==record.version||stable(current)!==stable(published))ctx.addIssue({code:z.ZodIssueCode.custom,message:'已确认经营记录必须保留同版本完整快照',path:['published']});
 }
});
function ratio(values:Record<string,number|null>,numerator:string,denominator:string):number|null{
 const n=values[numerator],d=values[denominator];return typeof n==='number'&&Number.isFinite(n)&&n>=0&&typeof d==='number'&&Number.isFinite(d)&&d>0?n/d:null;
}
function sum(values:(number|null|undefined)[]):number|null{
 const known=values.filter((v):v is number=>typeof v==='number');if(!known.length)return null;
 const total=known.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total)||total<0)fail('累计数值超出安全范围');return total;
}
export const combinedPlatformFields=['verifiedAmount','orderAmount','refundAmount','adSpend','verifiedCoupons','orderedCoupons','refundOrders'] as const;
export function combinedPlatformSummary(records:OperatingRecord[],start:string,end:string,key:typeof combinedPlatformFields[number]){
 const parts=(['meituan','douyin'] as const).map(sheet=>{
  const summary=operatingSummary(records,sheet,end,{start});
  const value=summary.rows[0]?.values[key]??null;
  const complete=value!==null&&!summary.incompleteFields.includes(key);
  const latest=records.filter(r=>r.sheet===sheet&&r.date>=start&&r.date<=end&&r.rows.some(row=>row.values[key]!=null)).map(r=>r.date).sort().at(-1);
  return {sheet,value,complete,latest};
 });
 return {parts,total:parts.every(part=>part.complete)?sum(parts.map(part=>part.value)):null};
}
export function operatingRatios(values:Record<string,number|null>):{verificationRate:number|null;refundRate:number|null;verifiedRoi:number|null;orderRoi:number|null;positiveRate:number|null;totalExposure:number|null}{
 const exposure=values.naturalExposure,paid=values.paidExposure;
 return{verificationRate:ratio(values,'verifiedCoupons','orderedCoupons'),refundRate:ratio(values,'refundOrders','orderedCoupons'),verifiedRoi:ratio(values,'verifiedAmount','adSpend'),orderRoi:ratio(values,'orderAmount','adSpend'),positiveRate:ratio(values,'positiveReviews','verifiedCoupons'),totalExposure:typeof exposure==='number'&&typeof paid==='number'?sum([exposure,paid]):null};
}
function monthDays(date:string):string[]{const end=Number(date.slice(8)),start=date.slice(0,8);return Array.from({length:end},(_,i)=>start+String(i+1).padStart(2,'0'));}
function rangeDays(start:string,end:string):string[]{const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');return Array.from({length:(last-first)/86400000+1},(_,i)=>new Date(first+i*86400000).toISOString().slice(0,10));}
function uniqueRecords(records:OperatingRecord[],sheet:OperatingSheet,start:string,end:string):OperatingRecord[]{
 const byDate=new Map<string,OperatingRecord>(),versions=new Set<string>();let scope='';
 for(const r of records){if(r.sheet!==sheet||r.date<start||r.date>end)continue;operatingDate(r.date);
  const currentScope=r.companyId+':'+r.projectId;if(scope&&scope!==currentScope)fail('不能混合不同公司或项目的经营记录');scope=currentScope;
  if(!Number.isSafeInteger(r.version)||r.version<1)fail('经营版本无效');const key=r.id+':'+r.version;if(versions.has(key))fail('经营记录版本重复');versions.add(key);
  const old=byDate.get(r.date);if(old&&old.id!==r.id)fail('同日同表存在冲突记录');if(!old||r.version>old.version)byDate.set(r.date,r);
 }
 return Array.from(byDate.values()).sort((a,b)=>a.date.localeCompare(b.date));
}
function rowsComplete(sheet:OperatingSheet,rows:OperatingRow[],template?:OperatingTemplate,sharedAdSpend?:number):boolean{return rows.length>0&&rows.every(row=>operatingFields(sheet,template).filter(f=>f.required).every(f=>typeof row.values[f.key]==='number'||f.key==='adSpend'&&sharedAdSpend!==undefined));}
type Summary={sharedAdSpend?:number;start:string;end:string;rows:OperatingRow[];daysExpected:number;daysReported:number;missingDates:string[];complete:boolean;incompleteFields:string[];incompleteFieldsByStore?:Record<string,string[]>;scopeChanged?:boolean;source?:'daily'|'snapshot';template?:OperatingTemplate};
function fieldGaps(descriptors:Field[],rows:OperatingRow[],missingRows=false,nonadditiveStars=false):string[]{return descriptors.filter(f=>missingRows||!rows.length||nonadditiveStars&&f.kind==='stars'||rows.some(row=>typeof row.values[f.key]!=='number')).map(f=>f.key);}
function aggregateRows(rows:OperatingRow[],descriptors:Field[]):OperatingRow[]{
 const byStore=new Map<string,OperatingRow[]>();
 for(const row of rows){const history=byStore.get(row.storeId)||[];history.push(row);byStore.set(row.storeId,history);}
 return Array.from(byStore,([storeId,history])=>({storeId,storeName:history.at(-1)!.storeName,values:Object.fromEntries(descriptors.map(f=>[f.key,f.kind==='stars'?null:sum(history.map(r=>r.values[f.key]))]))}));
}
function storeGaps(fields:Field[],source:OperatingRow[],output:OperatingRow[],daysExpected:number){
 const history=new Map<string,OperatingRow[]>();
 for(const row of source){const rows=history.get(row.storeId)||[];rows.push(row);history.set(row.storeId,rows);}
 return Object.fromEntries(output.map(row=>{
  const rows=history.get(row.storeId)||[];
  const missing=fields.filter(f=>f.kind==='stars'?row.values[f.key]==null:rows.length!==daysExpected||rows.some(r=>r.values[f.key]==null));
  return [row.storeId,missing.map(f=>f.key)];
 }));
}
export function extendsOperatingDefinition(old:OperatingTemplate,next:OperatingTemplate):boolean{
 return old.id===next.id&&old.dimension===next.dimension&&old.fields.length<=next.fields.length&&old.metrics.length<=next.metrics.length&&
  stable(old.fields)===stable(next.fields.slice(0,old.fields.length))&&stable(old.metrics)===stable(next.metrics.slice(0,old.metrics.length));
}
export function commonOperatingDefinition(records:readonly {template?:OperatingTemplate}[]):OperatingTemplate|undefined{
 let widest=records[0]?.template;
 if(!widest)return undefined;
 for(const {template} of records){
  if(!template||template.description!==widest.description)return undefined;
  if(extendsOperatingDefinition(widest,template))widest=template;
  else if(!extendsOperatingDefinition(template,widest))return undefined;
 }
 return widest;
}
function checkSnapshotScope(daily:OperatingRecord[],snapshot?:OperatingRecord){
 if(daily[0]&&snapshot&&(daily[0].companyId!==snapshot.companyId||daily[0].projectId!==snapshot.projectId))fail('不能混合不同公司或项目的日记录和累计快照');
}
function cumulativeFromDaily(records:OperatingRecord[],sheet:'meituan-stores'|'douyin-stores',end:string,range?:{start:string}):Summary{
 const start=range?.start||end.slice(0,8)+'01',dates=range?rangeDays(start,end):monthDays(end),platform=sheet==='meituan-stores'?'meituan':'douyin',daily=uniqueRecords(records,platform,start,end),snapshots=range?[]:uniqueRecords(records,sheet,end,end),descriptors=operatingFields(sheet);
 checkSnapshotScope(daily,snapshots[0]);
 const details=daily.filter(r=>r.rows.length>0&&r.rows.every(row=>row.storeId!=='all'));
 const storeIds=new Set(details.flatMap(r=>r.rows.map(row=>row.storeId)));
 const valid=(r:OperatingRecord)=>r.rows.length===storeIds.size&&new Set(r.rows.map(row=>row.storeId)).size===storeIds.size&&r.rows.every(row=>storeIds.has(row.storeId))&&rowsComplete(platform,r.rows);
 const missingDates=dates.filter(date=>!details.some(r=>r.date===date&&valid(r)));
 const complete=missingDates.length===0&&storeIds.size>0;
 if(!complete&&snapshots[0]&&rowsComplete(sheet,snapshots[0].rows,undefined,snapshots[0].sharedAdSpend))return{sharedAdSpend:snapshots[0].sharedAdSpend,start,end,rows:structuredClone(snapshots[0].rows),daysExpected:dates.length,daysReported:dates.length,missingDates:[],complete:true,incompleteFields:fieldGaps(descriptors,snapshots[0].rows),source:'snapshot'};
 const sourceRows=details.flatMap(r=>r.rows),missingDimensions=dates.some(date=>!details.some(r=>r.date===date&&r.rows.length===storeIds.size&&new Set(r.rows.map(row=>row.storeId)).size===storeIds.size));
 const rows=aggregateRows(sourceRows,descriptors),incompleteFields=fieldGaps(descriptors.filter(f=>f.kind!=='stars'),sourceRows,missingDimensions);
 if(sheet==='meituan-stores'){
  const cutoff=details.find(r=>r.date===end);
  for(const row of rows){const stars=cutoff?.rows.find(r=>r.storeId===row.storeId)?.values.stars;row.values.stars=typeof stars==='number'?stars:null;}
  if(!rows.length||rows.some(row=>row.values.stars===null))incompleteFields.push('stars');
 }
 return{start,end,rows,daysExpected:dates.length,daysReported:details.filter(valid).length,missingDates,complete,incompleteFields,incompleteFieldsByStore:storeGaps(descriptors,sourceRows,rows,dates.length),source:'daily'};
}
/** An explicit range uses daily facts only; manual snapshots describe month-to-date amounts. */
export function operatingSummary(records:OperatingRecord[],sheet:OperatingSheet,date:string,range?:{start:string}):Summary{
 const end=operatingDate(date),start=range?operatingDate(range.start):end.slice(0,8)+'01';
 if(start>end)fail('经营日期区间无效');
 const dates=range?rangeDays(start,end):monthDays(end),targets=sheet==='targets',platform=sheet==='meituan'||sheet==='douyin';
 if(sheet==='meituan-stores'||sheet==='douyin-stores')return cumulativeFromDaily(records,sheet,end,range);
 const selected=uniqueRecords(records,sheet,start,targets?start:end);
 if(targets){const current=selected[0];return{start,end,rows:current?structuredClone(current.rows):[],daysExpected:1,daysReported:current?1:0,missingDates:current?[]:[start],complete:!!current&&rowsComplete(sheet,current.rows),incompleteFields:fieldGaps(operatingFields(sheet),current?.rows||[])};}
 const generic=sheet.startsWith('tpl_');
 const template=generic?commonOperatingDefinition(selected):undefined;
 if(generic&&selected.length&&!template)fail('同一模板的历史字段、单位或指标口径不同，不能混合累计');
 if(generic)for(const r of selected)operatingFields(sheet,r.template);
 const descriptors=generic&&!selected.length?[]:operatingFields(sheet,template);
 const missingDates=dates.filter(day=>!selected.some(r=>r.date===day));
 const dailyRows=selected.flatMap(r=>platform?[{storeId:'all',storeName:'全平台',values:Object.fromEntries(descriptors.map(f=>[f.key,f.kind==='stars'?null:sum(r.rows.map(row=>row.values[f.key]))]))}]:r.rows);
 const rows=aggregateRows(dailyRows,descriptors);
 const scopes=new Set(selected.map(r=>JSON.stringify(r.rows.map(row=>row.storeId).sort()))),scopeChanged=scopes.size>1;
 const incompleteFields=fieldGaps(descriptors,selected.flatMap(r=>r.rows),!!missingDates.length||scopeChanged,true);
 const summaryTemplate=template&&{...template,metrics:template.metrics.filter(metric=>selected.every(r=>r.template?.metrics.some(m=>m.key===metric.key)))};
 return{start,end,rows,daysExpected:dates.length,daysReported:selected.length,missingDates,scopeChanged,complete:!missingDates.length&&!scopeChanged&&selected.every(r=>rowsComplete(sheet,r.rows,template))&&rows.length>0,incompleteFields,incompleteFieldsByStore:platform?{all:incompleteFields}:storeGaps(descriptors,dailyRows,rows,dates.length),...(summaryTemplate?{template:summaryTemplate}:{})};
}
export function operatingTargetProgress(targets:OperatingRecord,records:OperatingRecord[],cutoff:string,confirmedOnly:boolean){
 const end=operatingDate(cutoff),start=end.slice(0,8)+'01';
 if(targets.sheet!=='targets'||targets.date!==start)fail('请按月目标所属月份查看完成情况');
 if(confirmedOnly&&targets.status!=='approved')fail('本月目标尚未确认');
 const source=selectStoreRevenueSource(records.filter(r=>r.companyId===targets.companyId&&r.projectId===targets.projectId&&
  r.date>=start&&r.date<=end&&(!confirmedOnly||r.status==='approved')));
 if(source.issue)fail(source.issue);
 const sheet=source.records[0]?.sheet??'revenue';
 const days=uniqueRecords(source.records,sheet,start,end).filter(r=>r.rows.some(row=>row.values.revenue!=null));
 const summary=operatingSummary(days,sheet,end),amounts=new Map(summary.rows.map(r=>[r.storeId,r.values.revenue]));
 const stores=new Map(targets.rows.map(r=>[r.storeId,{storeId:r.storeId,storeName:r.storeName,target:r.values.target}]));
 for(const r of summary.rows)if(!stores.has(r.storeId))stores.set(r.storeId,{storeId:r.storeId,storeName:r.storeName,target:null});
 const rows=[...stores.values()].map(store=>{
  const revenue=amounts.get(store.storeId)??null;
  const reported=days.filter(day=>day.rows.some(r=>r.storeId===store.storeId&&r.values.revenue!=null));
  return {...store,revenue,rate:ratio({revenue,target:store.target},'revenue','target'),reportedDays:reported.length,unconfirmedDays:reported.filter(day=>day.status!=='approved').length};
 });
 const target=sum(rows.map(r=>r.target)),revenue=sum(rows.map(r=>r.revenue));
 const rate=rows.every(r=>r.target!=null)?ratio({revenue,target},'revenue','target'):null;
 return {rows,total:{target,revenue,rate},daysExpected:summary.daysExpected,missingDates:summary.missingDates,sourceName:days[0]?.template?.name??'门店总业绩'};
}
export function operatingReconciliation(records:OperatingRecord[],platform:'meituan'|'douyin',date:string):{state:'match'|'different'|'incomplete';scopeMismatch:boolean;differences:{key:string;label:string;daily:number|null;stores:number|null;difference:number|null}[];missingDates:string[];storesSource:'snapshot'|'daily'}{
 if(platform!=='meituan'&&platform!=='douyin')fail('核对平台无效');
 const daily=operatingSummary(records,platform,date),sheet=(platform+'-stores') as 'meituan-stores'|'douyin-stores',snapshot=uniqueRecords(records,sheet,daily.end,daily.end)[0];
 const dailyRecords=uniqueRecords(records,platform,daily.start,daily.end);checkSnapshotScope(dailyRecords,snapshot);
 const snapshotIds=new Set(snapshot?.rows.map(row=>row.storeId));
 const scopeMismatch=!!snapshot&&dailyRecords.some(record=>record.rows.length>0&&record.rows.every(row=>row.storeId!=='all')&&(record.rows.length!==snapshotIds.size||record.rows.some(row=>!snapshotIds.has(row.storeId))));
 // Independent reconciliation must retain an exact manual source, even if its required fields are incomplete.
 const stores:Summary=snapshot?{start:daily.start,end:daily.end,rows:structuredClone(snapshot.rows),daysExpected:daily.daysExpected,daysReported:daily.daysExpected,missingDates:[],complete:rowsComplete(sheet,snapshot.rows,undefined,snapshot.sharedAdSpend),sharedAdSpend:snapshot.sharedAdSpend,incompleteFields:fieldGaps(operatingFields(sheet),snapshot.rows),source:'snapshot'}:operatingSummary(records,sheet,date);
 const differences=financial.map(f=>{
  const side=(summary:Summary)=>f.key==='adSpend'&&summary.sharedAdSpend!==undefined?summary.sharedAdSpend:!summary.incompleteFields.includes(f.key)&&summary.rows.length&&summary.rows.every(row=>typeof row.values[f.key]==='number')?sum(summary.rows.map(row=>row.values[f.key])):null;
  const d=side(daily),s=side(stores);return{key:f.key,label:f.label,daily:d,stores:s,difference:!scopeMismatch&&d!==null&&s!==null?s-d:null};
 });
 const incomplete=!daily.complete||!stores.complete||differences.some(d=>d.daily===null||d.stores===null);
 return{state:incomplete?'incomplete':scopeMismatch||differences.some(d=>d.difference!==0)?'different':'match',scopeMismatch,differences,missingDates:Array.from(new Set([...daily.missingDates,...stores.missingDates])).sort(),storesSource:snapshot?'snapshot':'daily'};
}
