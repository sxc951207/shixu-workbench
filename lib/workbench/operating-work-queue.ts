import type{OperatingRecord,OperatingSheet}from'../../cloud/company/operating-model.ts';
import{operatingDate}from'./operating-data.ts';
export type OperatingWorkItem={key:string;sheet:OperatingSheet;date:string;name:string;status:OperatingRecord['status']|'missing';record?:OperatingRecord};
export type OperatingWorkOptions={companyId:string;projectId:string;cutoff:string;login:string;summary:boolean;fillable:{sheet:OperatingSheet;date:string;name:string}[]};
export const operatingSheetNames:Record<string,string>={revenue:'门店总业绩',targets:'门店月目标',meituan:'美团平台日录',douyin:'抖音平台日录','meituan-stores':'美团门店累计','douyin-stores':'抖音门店累计'};
export type OperatingFillTarget={companyId:string;projectId:string;date:string;sheet:OperatingSheet};
export type OperatingHomeFill=OperatingFillTarget&{projectName:string;name:string;status:'missing'|'draft'|'returned'};
export type OperatingHomeResult={since:string;day:string;item:OperatingHomeFill|null};
export function readOperatingFillTarget(search:string):OperatingFillTarget|undefined{
 const params=new URLSearchParams(search);
 if(params.get('tab')!=='operating'||params.get('fill')!=='1')return;
 const companyId=params.get('company')||'',projectId=params.get('project')||'',date=params.get('day')||'',sheet=params.get('sheet')||'';
 if(!/^[\w-]{1,80}$/.test(companyId)||!/^p_[\w-]{1,80}$/.test(projectId)||!(/^(revenue|targets|meituan|douyin|tpl_[a-z0-9_]{1,32})$/.test(sheet)))return;
 try{operatingDate(date);}catch{return;}
 return{companyId,projectId,date,sheet:sheet as OperatingSheet};
}
export const fillPriority=(status:string)=>status==='returned'?0:status==='draft'?1:2;
export function operatingWorkQueue(records:readonly OperatingRecord[],options:OperatingWorkOptions):{fill:OperatingWorkItem[];review:OperatingWorkItem[]}{
 if(options.summary)return{fill:[],review:[]};
 const day=operatingDate(options.cutoff),month=day.slice(0,7),scoped=records.filter(r=>r.companyId===options.companyId&&r.projectId===options.projectId&&r.date.slice(0,7)===month);
 const fill:OperatingWorkItem[]=[],seen=new Set<string>();
 for(const candidate of options.fillable){
  if(candidate.sheet.endsWith('-stores')||(candidate.sheet==='targets'?candidate.date!==month+'-01':candidate.date!==day))continue;
  const key=candidate.sheet+':'+candidate.date;if(seen.has(key))continue;seen.add(key);
  const record=scoped.find(r=>r.sheet===candidate.sheet&&r.date===candidate.date);
  if(record&&!['draft','returned'].includes(record.status))continue;
  fill.push({key:'fill:'+key,...candidate,status:record?.status||'missing',...(record?{record}:{})});
 }
 fill.sort((a,b)=>fillPriority(a.status)-fillPriority(b.status)||a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'zh-CN'));
 const review=scoped.filter(r=>r.status==='submitted'&&r.reviewerLogin===options.login).map(record=>({key:'review:'+record.id,sheet:record.sheet,date:record.date,name:record.template?.name||operatingSheetNames[record.sheet]||'自定义记录',status:record.status,record})).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'zh-CN')||a.key.localeCompare(b.key));
 return{fill,review};
}
