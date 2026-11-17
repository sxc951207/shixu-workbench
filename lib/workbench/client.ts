import type{Entry}from'./domain.ts';
export interface RecordsResponse{records:Entry[];record?:Entry;error?:string;imported?:number;today?:string;generated?:number;}
export async function requestRecords(data?:unknown):Promise<RecordsResponse>{
 const cloud=typeof window!=='undefined'&&window.location.pathname.startsWith('/workbench');
 let response:Response;
 try{response=await fetch(cloud?'/shixu-api/records':'/api/records',data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{cache:'no-store'});}
 catch{throw Error('网络连接中断，请保持页面打开，恢复连接后重试');}
 let result:RecordsResponse;try{result=await response.json();}catch{throw Error('暂时连接不上，请保留内容后重试');}
 if(response.status===401&&cloud)window.dispatchEvent(new Event('shixu-session-expired'));if(!response.ok)throw Error(result.error||'操作失败，请重试');return result;
}
type RequestRecords=typeof requestRecords;
const sameQuickFields=(left:Entry,right:Entry)=>!left.deleted&&left.kind===right.kind&&left.title===right.title&&left.body===right.body&&left.companyId===right.companyId&&left.due===right.due;

// Keep the intent id while the result is unknown. Only amend a verified previous payload.
export async function createQuickRecord(draft:Entry,request:RequestRecords=requestRecords,previous?:Entry,onAttempt?:(entry:Entry,beforeUpdate?:Entry)=>void,beforeUpdate?:Entry):Promise<RecordsResponse>{
 const readCurrent=async()=>{const snapshot=await request();return {snapshot,saved:snapshot.records.find(item=>item.id===draft.id)};};
 let update:Entry|undefined,verifiedBase:Entry|undefined;
 if(previous){
  const {snapshot,saved}=await readCurrent();
  if(saved){
   if(sameQuickFields(saved,draft))return {...snapshot,record:saved};
   if(!sameQuickFields(saved,previous)&&!(beforeUpdate&&sameQuickFields(saved,beforeUpdate)))throw Error('云端内容已变化。输入框里保留了你的草稿，请在工作台核对原记录后处理。');
   verifiedBase=saved;
   update={...saved,title:draft.title,body:draft.body,companyId:draft.companyId,due:draft.due};
  }
 }
 onAttempt?.(draft,verifiedBase);
 try{
  const response=await request({action:'save',record:update??draft,...(update?{expectedVersion:update.version}:{})});
  if(response.record?.id!==draft.id||!sameQuickFields(response.record,draft))throw Error('保存结果尚未确认，请保持页面打开，恢复连接后重试');
  return response;
 }catch(error){
  const current=await readCurrent().catch(()=>null);
  if(current?.saved&&sameQuickFields(current.saved,draft))return {...current.snapshot,record:current.saved};
  throw error;
 }
}
export async function loadRecords(request:(data?:unknown)=>Promise<RecordsResponse>=requestRecords){
 try{return{...await request({action:'prepare-daily'}),dailyError:''};}
 catch(error){const original=await request();return{...original,dailyError:'原有内容已读取，但今天的每日事项未能准备：'+(error as Error).message};}
}
