'use client';
import {readCompanyInvitation,invitationFromLink} from '../lib/workbench/company-invitation';
import {BrandScene} from '../components/workspace-material';
import EmployeeHomeFill from '../components/employee-home-fill';
import Workbench from '../components/workbench';
import React,{useCallback,useEffect,useRef,useState,lazy,Suspense}from'react';import{ArrowRight,MonitorPlay,TableProperties}from'lucide-react';
import{CompanyAppearance,CompanyThemeToggle}from'../components/company-appearance';
import'../app/company.css';import'../app/company-polish.css';import'../app/company-executive.css';import'../app/company-tabler.css';import'../app/company-studio.css';
import '../app/company-daylight.css';
export async function companyRequest(body:any){const r=await fetch('/shixu-api/team',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});let data:any;try{data=await r.json();}catch{throw Error('连接未确认，请保留内容并重试');}if(!r.ok){if(body.action==='workspace.records'&&[401,403].includes(r.status))window.dispatchEvent(new Event('company-member-session-changed'));else if(r.status===401&&!['login','join','invite.info','session'].includes(body.action))window.dispatchEvent(new Event('company-session-expired'));throw Error(data.error||'操作未确认，请刷新核对');}if(body.companyId&&/\.(approve|return|submit|withdraw|configure)$/.test(body.action))window.dispatchEvent(new CustomEvent('company-review-changed',{detail:body.companyId}));return data;}
async function clearAdministratorSession(){
 const response=await fetch('/shixu-api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
 const receipt=await response.json().catch(()=>null) as {ok?:boolean}|null;
 if(!response.ok||receipt?.ok!==true)throw Error('上一个登录状态尚未清除，请重试。');
}
const CompanyWorkbench=lazy(()=>import('../components/company-workbench'));
const CompanyPreview=lazy(()=>import('../components/company-preview'));
const OperatingPreview=lazy(()=>import('../components/operating-preview'));
export default function CompanyRoot(){const[preview]=useState(()=>new URLSearchParams(window.location.search).get('preview'));return <CompanyAppearance>{preview==='company'||preview==='templates'?<Suspense fallback={<div className="company-app"><p className="co-preview-loading" role="status">正在打开示例预览…</p></div>}>{preview==='templates'?<OperatingPreview/>:<CompanyPreview/>}</Suspense>:<CompanySessionRoot/>}</CompanyAppearance>;}
function CompanySessionRoot(){
 const[session,setSession]=useState<any>(null),[error,setError]=useState(''),[reauth,setReauth]=useState(false),[join,setJoin]=useState(()=>readCompanyInvitation(window.location.hash));
 const [entryCompany,setEntryCompany]=useState('');
 const [activating,setActivating]=useState(()=>new URLSearchParams(location.search).get('activate')==='1'||location.hash.startsWith('#join='));
 useEffect(()=>{
  const sync=()=>{const invite=readCompanyInvitation(location.hash);setJoin(invite);setActivating(!!invite||new URLSearchParams(location.search).get('activate')==='1'||location.hash.startsWith('#join='));};
  window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);
 },[]);
 const check=async()=>{try{setSession(await companyRequest({action:'session'}));setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{document.title='拾序 · 公司项目工作台';void check();const expired=()=>setReauth(true);const changed=()=>{setSession(null);void check();};window.addEventListener('company-member-session-changed',changed);window.addEventListener('company-session-expired',expired);return()=>{window.removeEventListener('company-member-session-changed',changed);window.removeEventListener('company-session-expired',expired);};},[]);
 const done=async()=>{if(join){const url=new URL(location.href);url.searchParams.delete('activate');url.searchParams.set('space','company');url.hash='';window.history.replaceState(null,'',url.pathname+url.search);setActivating(false);setJoin(null);}await check();setReauth(false);};
 const companyId=session?.companyId,login=session?.login;
 const memberRecords=useCallback((operation?:unknown)=>companyRequest({action:'workspace.records',companyId,login,operation}),[companyId,login]);
 if(!session&&!error&&!activating&&!join)return <main className="zb-loading" role="status" aria-busy="true">正在打开公司工作台…</main>;
 if(activating||join||!session?.authenticated)return (
  <main className="company-login co-studio-login">
   <header className="co-entry-bar">
    <a className="co-entry-brand zb-back-link" href="/workbench/"><ArrowRight size={16} aria-hidden="true"/>个人工作台</a>
    <CompanyThemeToggle/>
   </header>
   <div className="co-entry-layout zb-entry-layout">
    <BrandScene companyName={entryCompany}/>
    <section className="co-login-card co-entry-form">
     <h1>{join||activating?'启用公司账号':'登录公司工作台'}</h1>
     {activating&&!join?<InvitationEntry onAccept={setJoin}/>:<CompanySignIn key={join?join.token:'signin'} join={join} onCompanyName={setEntryCompany} onDone={done}/>}
     {error&&<p className="co-error" role="alert">{error}<button className="co-text" onClick={()=>void check()}>重新连接</button></p>}
    </section>
    <aside className="co-entry-art" aria-labelledby="co-entry-preview">
     <div className="co-entry-art-content">
      <h2 id="co-entry-preview">工作台演示</h2>
      <p>用示例数据体验项目审批和经营填报。</p>
      <div className="co-entry-links">
       <a href="/workbench/?space=company&preview=company"><MonitorPlay size={16} aria-hidden="true"/>先看只读演示<ArrowRight size={15} aria-hidden="true"/></a>
       <a href="/workbench/?space=company&preview=templates"><TableProperties size={16} aria-hidden="true"/>试用数据模板<ArrowRight size={15} aria-hidden="true"/></a>
      </div>
     </div>
    </aside>
   </div>
  </main>
 );
 const tab=new URLSearchParams(window.location.search).get('tab');
 const personal=!!login&&(tab==='personal'||(!tab&&session.defaultPersonal));
 const signOut=async()=>{await clearAdministratorSession();await companyRequest({action:'logout'});setSession({authenticated:false});};
 const scope=JSON.stringify([companyId,login]);
 return <>{personal?<Workbench key={scope} memberScope={scope} homePriority={session.defaultPersonal?<EmployeeHomeFill companyId={companyId}/>:undefined} displayName={session.displayName||login} localPreview={false} api={memberRecords} onSignOut={signOut}/>:<CompanyWorkbench owner={session.owner} onSignOut={signOut}/>}{reauth&&<ReauthDialog><div className="co-login-card"><h2>登录状态需要更新</h2><p>你的编辑内容仍保留在原页面。</p><CompanySignIn lockedIdentity defaultOwner={session.owner} initialCompany={session.companyId} initialLogin={session.login} onDone={done}/><button className="co-text" onClick={()=>setReauth(false)}>先保留编辑内容</button></div></ReauthDialog>}</>;
}
function InvitationEntry({onAccept}:{onAccept:(invite:NonNullable<ReturnType<typeof readCompanyInvitation>>)=>void}){
 const [value,setValue]=useState(''),[error,setError]=useState('');
 return <form onSubmit={e=>{e.preventDefault();const invite=invitationFromLink(value,location.origin);if(!invite){setError('请粘贴管理员用「复制邀请链接」发给你的完整链接，也可以粘贴管理员单独发给你的邀请口令。');return;}setValue('');setError('');onAccept(invite);}}>
  <label>管理员发给你的邀请链接或口令<input required type="text" autoComplete="off" spellCheck={false} value={value} onChange={e=>{setValue(e.target.value);setError('');}} placeholder="粘贴完整邀请链接或邀请口令"/></label>
  {error&&<p className="co-error" role="alert">{error}</p>}<button className="co-primary">读取邀请，设置密码<ArrowRight size={16}/></button>
  <p><a href="/workbench/?space=company">已启用？返回成员登录</a></p>
 </form>;
}
function ReauthDialog({children}:{children:React.ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);return <dialog className="co-reauth" ref={ref} aria-label="重新登录公司空间" onCancel={e=>e.preventDefault()}>{children}</dialog>;}
function CompanySignIn({join,onDone,defaultOwner=false,initialCompany='',initialLogin='',lockedIdentity=false,onCompanyName}:{onCompanyName?:(name:string)=>void;join?:any;onDone:()=>Promise<void>;defaultOwner?:boolean;initialCompany?:string;initialLogin?:string;lockedIdentity?:boolean}){
 const[owner,setOwner]=useState(defaultOwner),[companyId,setCompanyId]=useState(join?.companyId||initialCompany),[login,setLogin]=useState(join?.login||initialLogin),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[invitation,setInvitation]=useState<any>(null);
 useEffect(()=>{if(join)void companyRequest({action:'invite.info',...join}).then(setInvitation).catch(e=>setError(e.message));},[join]);
 useEffect(()=>{const name=owner?'':join?invitation?.companyName||'':companyId.trim();onCompanyName?.(/^co_[a-f0-9]+$/i.test(name)?'':name);return()=>onCompanyName?.('');},[companyId,owner,join,invitation,onCompanyName]);
 async function submit(e:React.FormEvent){e.preventDefault();if(join&&password!==confirm){setError('两次密码不一致');return;}setBusy(true);setError('');try{if(owner&&!join){const r=await fetch('/shixu-api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const d:any=await r.json();if(!r.ok)throw Error(d.error||'登录失败');await companyRequest({action:'logout'});}else {await clearAdministratorSession();await companyRequest({action:join?'join':'login',companyId:companyId.trim(),login:login.trim(),password,...(join?{token:join.token}:{})});}setPassword('');setConfirm('');await onDone();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}}
 return <><div className="co-auth-tabs">{join?<strong>{invitation?invitation.companyName+' · '+invitation.name:'启用你的受邀账号'}</strong>:lockedIdentity?<strong>继续以原账号登录</strong>:<><button type="button" className={!owner?'selected':''} aria-pressed={!owner} onClick={()=>{setOwner(false);setError('');}}>成员登录</button><button type="button" className={owner?'selected':''} aria-pressed={owner} onClick={()=>{setOwner(true);setError('');}}>管理员登录</button></>}</div><form onSubmit={submit}><fieldset disabled={busy}>{!owner&&<><label>{join&&invitation?'公司名称':'公司名称或编号'}<input required readOnly={!!join||lockedIdentity} autoComplete="organization" placeholder="填写公司空间中的中文名称" value={join&&invitation?invitation.companyName:companyId} maxLength={60} onChange={e=>setCompanyId(e.target.value)}/></label><label>登录名<input required readOnly={!!join||lockedIdentity} autoComplete="username" value={login} maxLength={40} onChange={e=>setLogin(e.target.value)}/></label></>}<label>{owner?'原个人工作台访问密码':join?'设置 8 至 128 位密码':'密码'}<input required type="password" autoComplete={join?'new-password':'current-password'} minLength={join?8:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>{join&&<label>再输入一次密码<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}{error&&<p className="co-error" role="alert">{error}</p>}<button className="co-primary">{busy?'正在连接…':join?'启用并进入':'进入公司工作台'}<ArrowRight size={16}/></button></fieldset></form>{!join&&!lockedIdentity&&!owner&&<p className="co-help"><a className="co-text" href="/workbench/?space=company&activate=1">首次启用公司账号</a> · 需管理员发的邀请链接</p>}</>;
}
