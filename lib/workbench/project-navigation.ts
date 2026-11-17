export type ProjectShortcut={id:string;name:string;confirmedOnly?:boolean};
/** An explicit project shortcut must never silently land on another project's form. */
export function resolveOperatingProject(options:readonly{id:string}[],current:string,requested=''){
 if(current&&options.some(p=>p.id===current))return{id:current,unavailable:false};
 if(requested)return options.some(p=>p.id===requested)?{id:requested,unavailable:false}:{id:'',unavailable:true};
 return{id:options[0]?.id||'',unavailable:false};
}
/** Uses the existing paginated published view, never writable project headers. */
export async function loadConfirmedProjects(api:(body:any)=>Promise<any>,companyId:string){
 const projects:ProjectShortcut[]=[],seen=new Set<string>();let revision:number|undefined,total=0,page=0;
 do{
  const result=await api({action:'view',companyId,scope:'summary',page});
  if(result.company?.id!==companyId||!Number.isSafeInteger(result.company.revision)||!Number.isSafeInteger(result.total)||result.total<0||result.total>200||result.page!==page||!Array.isArray(result.projects)||result.projects.length>20)throw Error('已确认项目目录无法核对，请重新读取');
  if(revision!==undefined&&(result.company.revision!==revision||result.total!==total))throw Error('读取期间项目已变化，请重新读取');
  revision=result.company.revision;total=result.total;
  for(const project of result.projects){if(project.status!=='approved'||typeof project.id!=='string'||!project.id||typeof project.name!=='string'||!project.name.trim()||seen.has(project.id))throw Error('已确认项目快照无法核对，请重新读取');seen.add(project.id);projects.push({id:project.id,name:project.name});}
  if(projects.length<Math.min(total,(page+1)*20))throw Error('已确认项目尚未读取完整，请重新读取');page++;
 }while(projects.length<total);
 if(projects.length!==total)throw Error('已确认项目数量无法核对，请重新读取');
 return{projects,companyRevision:revision!};
}
