'use client';
import {useEffect,useRef,useState} from 'react';
import {Timer,Play,Pause,RotateCcw} from 'lucide-react';
import {newTimer,toggleTimer,timerRemaining,restoreTimer} from '../lib/workbench/productivity';
import {FOCUS_CELEBRATION,focusCompletionCue} from '../lib/workbench/playful';
import type {TimerState} from '../lib/workbench/productivity';
export default function FocusTimer({memberScope=''}:{memberScope?:string}){
 const suffix=memberScope?':'+memberScope:'';
 const key='shixu-focus-v1'+suffix,rewardKey='shixu-focus-celebrated'+suffix;
 const [state,setState]=useState<TimerState>(()=>newTimer()),[now,setNow]=useState(0),[ready,setReady]=useState(false),[rewarding,setRewarding]=useState(false);
 const lastReward=useRef<number|null>(null),rewardTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(rewardTimer.current)clearTimeout(rewardTimer.current);},[]);
 useEffect(()=>{
  try{const saved=restoreTimer(JSON.parse(localStorage.getItem(key)||'null'));if(saved)setState(saved);const last=Number(localStorage.getItem(rewardKey));if(Number.isSafeInteger(last)&&last>0)lastReward.current=last;}catch{}
  setNow(Date.now());setReady(true);
  const storage=(e:StorageEvent)=>{try{if(e.key===key){const next=restoreTimer(JSON.parse(e.newValue||'null'));if(next){setState(next);setNow(Date.now());}}if(e.key===rewardKey){const marker=Number(e.newValue);if(Number.isSafeInteger(marker)&&marker>0)lastReward.current=marker;}}catch{}};
  window.addEventListener('storage',storage);return()=>window.removeEventListener('storage',storage);
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify(state));}catch{}},[state,ready]);
 const remaining=timerRemaining(state,now),running=state.endsAt!==null&&remaining>0,finished=state.endsAt!==null&&remaining===0;
 useEffect(()=>{
  if(!ready||state.endsAt===null)return;
  const tick=()=>setNow(Date.now());const interval=running?setInterval(tick,1000):null;
  window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
  return()=>{if(interval)clearInterval(interval);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};
 },[ready,state.endsAt,running]);
 useEffect(()=>{
  if(!ready||document.hidden)return;
  let seen=lastReward.current;try{const stored=Number(localStorage.getItem(rewardKey));if(Number.isSafeInteger(stored)&&stored>0)seen=stored;}catch{}
  const deadline=focusCompletionCue(state,now,seen);if(deadline===null)return;
  lastReward.current=deadline;try{localStorage.setItem(rewardKey,String(deadline));}catch{}
  setRewarding(true);window.dispatchEvent(new Event(FOCUS_CELEBRATION));
  if(rewardTimer.current)clearTimeout(rewardTimer.current);
  rewardTimer.current=setTimeout(()=>setRewarding(false),2200);
 },[ready,state,now]);
 // A state change may interrupt a reward; it must never leave a wave running.
 useEffect(()=>{if(!finished)setRewarding(false);},[finished]);
 const act=()=>{const n=Date.now();setNow(n);setState(s=>toggleTimer(s,n));};
 return <section className={'panel focus-panel'+(rewarding?' focus-rewarding':'')}><div className="section-heading"><div><h2><Timer size={18}/> 专注一会儿</h2><p>一次，只做眼前这一件。</p></div><span className="mini-label">FOCUS</span></div><div className="timer-modes" aria-label="计时模式"><button aria-pressed={state.mode==='focus'} onClick={()=>setState(newTimer('focus'))}>专注 25 分钟</button><button aria-pressed={state.mode==='break'} onClick={()=>setState(newTimer('break'))}>休息 5 分钟</button></div><div className={'timer-display '+(running?'running':'')}><div className="timer-energy" aria-hidden="true"/><div className="timer-wave" aria-hidden="true"/><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="52" style={{strokeDasharray:327,strokeDashoffset:327*(1-remaining/(state.mode==='focus'?1500:300))}}/></svg><span>{String(Math.floor(remaining/60)).padStart(2,'0')}<i>:</i>{String(remaining%60).padStart(2,'0')}</span></div><p className="timer-status" role="status">{finished?state.mode==='focus'?'这一轮完成了，休息一下吧。':'休息结束，可以继续啦。':running?'保持专注，按自己的节奏来。':'给自己留一段不被打扰的时间。'}</p><div className="timer-actions"><button className="primary" disabled={!ready} onClick={act}>{running?<Pause size={15}/>:<Play size={15}/>} {running?'暂停':finished?'再来一轮':remaining<newTimer(state.mode).remaining?'继续':'开始'}</button><button className="icon-button" aria-label="重置计时" onClick={()=>setState(newTimer(state.mode))}><RotateCcw size={17}/></button></div><small className="timer-help">本设备计时 · 关闭页面后不发送提醒</small></section>;
}
