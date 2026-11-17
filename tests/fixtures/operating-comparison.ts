import{operatingFields}from'../../lib/workbench/operating-data.ts';import type{OperatingRecord}from'../../cloud/company/operating-model.ts';
export const comparisonScope={companyId:'co_123456abcdef',projectId:'p_'+'a'.repeat(24),projectName:'对比项目'};
let serial=0;
export function comparisonRecord(date:string,value=10000,options:any={}):OperatingRecord{
 const sheet=options.sheet||'revenue',template=options.template,fields=operatingFields(sheet,template),row=(id:string,name:string,values:any)=>({storeId:id,storeName:name,values:Object.fromEntries(fields.map(f=>[f.key,values[f.key]===undefined?(f.required?0:null):values[f.key]]))});
 return{id:'op_'+String(++serial).padStart(32,'0'),...comparisonScope, sheet,date,status:'approved',version:3,publishedVersion:3,writerLogin:'manager',reviewerLogin:'owner',submittedBy:'manager',submittedName:'主管',submittedAt:date+'T08:00:00Z',reviewerName:'管理员',comment:'',createdAt:date+'T08:00:00Z',updatedAt:date+'T09:00:00Z',published:null,...(template?{template}:{}),rows:options.rows?options.rows.map((r:any)=>row(r.id,r.name,r.values)):[row('s001','甲店',{revenue:value,...options.values})]};
}
export function comparisonDays(month:string,days:number,value=10000,options:any={}){return Array.from({length:days},(_,i)=>comparisonRecord(month+'-'+String(i+1).padStart(2,'0'),value,options));}
