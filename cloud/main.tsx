import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {LockKeyhole,ArrowRight} from 'lucide-react';
import {BrandScene} from '../components/workspace-material';
import Workbench from '../components/workbench';
import {CompanyAppearance,CompanyThemeToggle} from '../components/company-appearance';
import '../app/globals.css';
import '../app/tech.css';
import '../app/effects.css';
import '../app/playful.css';
import '../app/daily.css';
import '../app/desktop.css';
import '../app/backups.css';
import '../app/workspace-daylight.css';
import DesktopPanel,{DesktopControls} from '../components/desktop-panel';
const desktopMode=new URLSearchParams(window.location.search).get('desktop')==='1';
async function request(path:string,body?:unknown){const r=await fetch('/shixu-api/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});let data:any;try{data=await r.json();}catch{throw Error('暂时连接不上，请稍后重试');}if(!r.ok)throw Error(data.error||'请求失败');return data;}
function Root(){
 const [session,setSession]=useState<{authenticated:boolean;setupRequired:boolean}|null>(null),[error,setError]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[reauth,setReauth]=useState(false);
 const token=new URLSearchParams(window.location.hash.slice(1)).get('setup')||'';
 const check=async()=>{try{setError('');setSession(await request('session'));}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void check();},[]);
 useEffect(()=>{const expired=()=>setReauth(true);window.addEventListener('shixu-session-expired',expired);return()=>window.removeEventListener('shixu-session-expired',expired);},[]);
 async function submit(e:React.FormEvent){e.preventDefault();if(session?.setupRequired&&password!==confirm){setError('两次密码不一致，请重新核对');return;}setBusy(true);setError('');try{await request(session?.setupRequired?'setup':'login',{password,...(session?.setupRequired?{token}:{})});window.history.replaceState(null,'',window.location.pathname+window.location.search);setPassword('');setConfirm('');setSession({authenticated:true,setupRequired:false});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(session?.authenticated)return <>{desktopMode?<DesktopPanel onSignOut={async()=>{await request('logout',{});setSession({authenticated:false,setupRequired:false});}}/>:<Workbench displayName="我的工作台" localPreview={false} onSignOut={async()=>{await request('logout',{});setSession({authenticated:false,setupRequired:false});}}/>}{reauth&&<Reauthenticate onDone={()=>{setReauth(false);window.dispatchEvent(new Event('shixu-session-restored'));}} onClose={()=>setReauth(false)}/>}</>;
 if(!session&&!error)return <>{desktopMode&&<DesktopControls/>}<main className="zb-loading" role="status" aria-busy="true">正在打开个人工作台…</main></>;
 const setup=session?.setupRequired;
 return <>{desktopMode&&<DesktopControls/>}<main className={"login cloud-login"+(desktopMode?" desktop-login":"")}>{desktopMode?<div className="brand-mark">拾</div>:<BrandScene/>}{!desktopMode&&<CompanyThemeToggle/>}<h1>{setup?'首次启用工作台':'登录个人工作台'}</h1><p>你的待办、项目与灵感，在每个设备上接着做。</p>{setup&&!token?<div className="cloud-login-form"><p className="form-error">工作台尚未启用。请使用本人收到的首次启用链接设置访问密码。</p></div>:session?<form className="cloud-login-form" onSubmit={submit}><div className="cloud-form-title"><LockKeyhole size={15}/>{setup?'首次启用 · 设置访问密码':'登录我的工作台'}</div><fieldset disabled={busy} className="editor-fields"><label htmlFor="access-password">{setup?'设置 12 位以上访问密码':'访问密码'}</label><input autoFocus id="access-password" type="password" autoComplete={setup?'new-password':'current-password'} minLength={setup?12:undefined} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/>{setup&&<><label htmlFor="confirm-password">再输入一次密码</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)}/></>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'正在连接…':setup?'启用我的工作台':'进入工作台'}<ArrowRight size={16}/></button></fieldset>{setup&&<p className="cloud-help">请自行保管密码。之后手机、电脑使用同一个密码登录。</p>}</form>:<div className="cloud-login-form"><p className="form-error" role="alert">{error}</p><button className="secondary" onClick={()=>void check()}>重新连接</button></div>}{!desktopMode&&<div className="member-entry-links"><a className="company-report-link" href="/workbench/?space=company&tab=operating">公司成员登录填报<ArrowRight size={16} aria-hidden="true"/></a><a className="member-home-link" href="/workbench/?space=company&tab=personal">成员工作总览</a></div>}<small>个人空间 · 数据云端保存 · 仅凭访问密码进入</small></main></>;
}
const CompanyRoot=React.lazy(()=>import('./company-root'));
function companyEntry(){
 const query=new URLSearchParams(location.search);
 return query.get('space')==='company'||query.get('activate')==='1'||new URLSearchParams(location.hash.slice(1)).has('join');
}
class CompanyEntryBoundary extends React.Component<React.PropsWithChildren, {failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(!this.state.failed)return this.props.children;
  return <main className="login cloud-login"><h1>公司工作台暂时没能打开</h1>
   <p role="alert">请检查网络连接，再重新加载当前页面。</p>
   <button className="primary" onClick={()=>window.location.reload()}>重新加载工作台</button>
  </main>;
 }
}
function Entry(){
 const [company,setCompany]=useState(companyEntry);
 useEffect(()=>{const sync=()=>setCompany(companyEntry());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
 return company?<CompanyEntryBoundary><React.Suspense fallback={<main className="zb-loading" role="status">正在打开公司工作台…</main>}><CompanyRoot/></React.Suspense></CompanyEntryBoundary>:desktopMode?<Root/>:<CompanyAppearance><Root/></CompanyAppearance>;
}
createRoot(document.getElementById('root')!).render(<Entry/>);
function Reauthenticate({onDone,onClose}:{onDone:()=>void;onClose:()=>void}){
 const ref=React.useRef<HTMLDialogElement>(null),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="modal" aria-label="重新登录" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><h2>登录状态需要更新</h2><p className="modal-caption">你的未保存内容仍在，登录后可以继续保存。</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request('login',{password});onDone();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}}}><label>访问密码<input autoFocus required type="password" autoComplete="current-password" maxLength={128} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>先保留草稿</button><button className="primary" disabled={busy}>{busy?'正在登录…':'登录并继续'}</button></div></form></dialog>;
}
