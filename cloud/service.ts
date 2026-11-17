import {createHash,createHmac,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import type {Entry} from '../lib/workbench/domain.ts';
import {WorkbenchError} from '../lib/workbench/domain.ts';
import {applyAction} from './core.ts';
import type{BackupVault}from'./backups.ts';
import{createBackup,readBackup,previewBackup,restoreBackup,BACKUP_LIMITS}from'./backups.ts';
export interface CloudState {records:Entry[];auth:{salt:string;hash:string;epoch:string;failed:number;blockedUntil:number};revision:number}
export interface Reply {statusCode:number;headers:Record<string,string>;body:string;isBase64Encoded:false}
export interface CloudStore {run(fn:(state:CloudState|null,vault?:BackupVault)=>Promise<{state:CloudState|null;response:Reply}>):Promise<Reply>}
interface Event {path?:string;httpMethod?:string;headers?:Record<string,string>;body?:string;isBase64Encoded?:boolean}
const cookieName='__Host-shixu_session';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function passwordHash(password:string,salt:string):Promise<string>{return new Promise((resolve,reject)=>scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k.toString('hex'))));}
export function isOwnerSession(cookie:string,state:CloudState|null,secret:string){if(!state)return false;const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'',parts=value.split('.');if(parts.length!==2||!equal(createHmac('sha256',secret).update(parts[0]).digest('base64url'),parts[1]))return false;try{const p=JSON.parse(Buffer.from(parts[0],'base64url').toString());return p.epoch===state.auth.epoch&&Number.isFinite(p.exp)&&p.exp>Date.now();}catch{return false;}}
export function createService(store:CloudStore,config:{secret:string;bootstrapHash:string;origin:string}){
 if(config.secret.length<32)throw Error('Missing session signing key');
 const response=(data:unknown,statusCode=200,extra:Record<string,string>={}):Reply=>({isBase64Encoded:false,statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra},body:JSON.stringify(data)});
 const signature=(value:string)=>createHmac('sha256',config.secret).update(value).digest('base64url');
 const issue=(state:CloudState)=>{const v=Buffer.from(JSON.stringify({epoch:state.auth.epoch,exp:Date.now()+30*86400000})).toString('base64url');return `${cookieName}=${v}.${signature(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;};
 const authenticated=(cookie:string,state:CloudState|null)=>{
  return isOwnerSession(cookie,state,config.secret);
 };
 return async(event:Event):Promise<Reply>=>{
  try{
   const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),String(v)]));
   const action=(event.path||'').split('/').filter(Boolean).pop()||'',method=(event.httpMethod||'GET').toUpperCase();
   if(!['session','setup','login','logout','records','backups'].includes(action))return response({error:'页面不存在'},404);
   if(!['GET','POST'].includes(method))return response({error:'请求方式不支持'},405);
   let body:any;
   if(method==='POST'){
    if(h.origin!==config.origin)return response({error:'请求来源无效'},403);
    if(!h['content-type']?.includes('application/json'))return response({error:'只接受 JSON 请求'},415);
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString():event.body||'';
    if(Buffer.byteLength(raw)>6*1024*1024)return response({error:'文件过大，请先缩小备份'},413);
    try{body=JSON.parse(raw);}catch{return response({error:'请求格式无效'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return response({error:'请求格式无效'},400);
   }
   return await store.run(async(state,vault)=>{
    const ok=authenticated(h.cookie||'',state);
    if(action==='session'&&method==='GET')return{state,response:response({authenticated:ok,setupRequired:!state})};
    if(action==='logout'&&method==='POST')return{state,response:response({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`})};
    if(action==='setup'&&method==='POST'){
     if(state)return{state,response:response({error:'工作台已经启用，请使用访问密码登录'},409)};
     if(typeof body.token!=='string'||!equal(hash(body.token),config.bootstrapHash))return{state,response:response({error:'启用链接无效，请使用本人收到的首次启用链接'},403)};
     if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)return{state,response:response({error:'请设置 12 至 128 位访问密码'},400)};
     const salt=randomBytes(24).toString('hex');const next:CloudState={records:[],revision:0,auth:{salt,hash:await passwordHash(body.password,salt),epoch:randomBytes(24).toString('hex'),failed:0,blockedUntil:0}};
     return{state:next,response:response({ok:true},200,{'Set-Cookie':issue(next)})};
    }
    if(action==='login'&&method==='POST'){
     if(!state)return{state,response:response({error:'工作台尚未启用，请先打开本人收到的首次启用链接'},403)};
     if(state.auth.blockedUntil>Date.now())return{state,response:response({error:'尝试次数较多，请一分钟后重试'},429)};
     if(typeof body.password!=='string'||body.password.length>128)return{state,response:response({error:'密码格式不正确'},400)};
     if(!equal(await passwordHash(body.password,state.auth.salt),state.auth.hash)){
      const failed=state.auth.blockedUntil&&state.auth.blockedUntil<Date.now()?1:state.auth.failed+1;
      return{state:{...state,auth:{...state.auth,failed,blockedUntil:failed>=5?Date.now()+60000:0}},response:response({error:'访问密码不正确'},401)};
     }
     const next={...state,auth:{...state.auth,failed:0,blockedUntil:0}};return{state:next,response:response({ok:true},200,{'Set-Cookie':issue(next)})};
    }
    if(!ok||!state)return{state,response:response({error:'请先登录工作台'},401)};
    if(action==='backups'){
     if(!vault)return{state,response:response({error:'云端备份尚未连接'},503)};
     if(method==='GET')return{state,response:response({backups:await vault.list(),policy:BACKUP_LIMITS,schedule:'每日上海时间02:00后',independentCopyRecommended:true})};
     if(body.action==='create')return{state,response:response({backup:await createBackup(state,vault,'manual')})};
     if(body.action==='preview')return{state,response:response(await previewBackup(state,vault,body.id))};
     if(body.action==='download')return{state,response:response({backup:(await readBackup(vault,body.id)).backup})};
     if(body.action==='restore'){const next=await restoreBackup(state,vault,body.id,body.expectedRevision);return{state:next,response:response({records:next.records,revision:next.revision,restored:true})};}
     return{state,response:response({error:'不支持的备份操作'},400)};
    }
    if(action==='records'&&method==='GET')return{state,response:response({records:[...state.records].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))})};
    if(action==='records'&&method==='POST'){const result=applyAction(state.records,body,new Date(),state.revision);return{state:result.records===state.records?state:{...state,records:result.records,revision:Math.max(state.revision+1,...result.records.map(e=>e.version))},response:response(result.result)};}
    return{state,response:response({error:'请求方式不支持'},405)};
   });
  }catch(e){if(e instanceof WorkbenchError)return response({error:e.message},e.status);console.error('shixu operation failed',e instanceof Error?e.message:'unknown');return response({error:'暂时无法连接，请保留文字并稍后重试'},503);}
 };
}
