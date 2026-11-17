'use client';
import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {TASK_CELEBRATION,FOCUS_CELEBRATION} from '../lib/workbench/playful';
import type {EffectPoint} from '../lib/workbench/playful';
interface Flight{id:number;kind:'task'|'focus';start:EffectPoint;end:EffectPoint;count:number}
export default function PlayfulFeedback({enabled}:{enabled:boolean}){
 const [flights,setFlights]=useState<Flight[]>([]),sequence=useRef(0);
 useEffect(()=>{if(!enabled){setFlights([]);return;}const timers=new Set<ReturnType<typeof setTimeout>>(),frames=new Set<number>(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const clear=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();for(const frame of frames)cancelAnimationFrame(frame);frames.clear();setFlights([]);};
  const show=(kind:'task'|'focus',event:Event)=>{if(reduced.matches||document.hidden)return;const width=innerWidth,height=innerHeight,raw=(event as CustomEvent).detail as EffectPoint|undefined;
   const valid=raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.y);const start=valid?{x:Math.max(12,Math.min(width-12,raw.x)),y:Math.max(15,Math.min(height-85,raw.y))}:{x:width*.5,y:height*.45};
   const counter=document.querySelector('[data-completion-counter]')?.getBoundingClientRect();const end=counter&&counter.width>0&&counter.top>20&&counter.bottom<height-85?{x:counter.left+counter.width/2,y:counter.top+counter.height/2}:{x:width-90,y:100};
   const id=++sequence.current;setFlights(prev=>[...prev.slice(-2),{id,kind,start,end,count:width<761?7:14}]);const timer=setTimeout(()=>{timers.delete(timer);setFlights(prev=>prev.filter(f=>f.id!==id));},1800);timers.add(timer);
  };
  // Measure the updated counter after React has committed the removed task row.
  const queue=(kind:'task'|'focus',event:Event)=>{const frame=requestAnimationFrame(()=>{frames.delete(frame);show(kind,event);});frames.add(frame);};
  const task=(event:Event)=>queue('task',event),focus=(event:Event)=>queue('focus',event);const change=()=>{if(reduced.matches)clear();};
  window.addEventListener(TASK_CELEBRATION,task);window.addEventListener(FOCUS_CELEBRATION,focus);reduced.addEventListener('change',change);
  return()=>{window.removeEventListener(TASK_CELEBRATION,task);window.removeEventListener(FOCUS_CELEBRATION,focus);reduced.removeEventListener('change',change);for(const timer of timers)clearTimeout(timer);for(const frame of frames)cancelAnimationFrame(frame);};
 },[enabled]);
 if(!enabled)return null;
 return <div className="playful-overlay" aria-hidden="true">{flights.map(f=>f.kind==='task'?<div className="completion-flight" data-celebration="task" key={f.id}>{Array.from({length:f.count},(_,i)=><i className="completion-particle" key={i} style={{left:f.start.x,top:f.start.y,'--mid-x':((f.end.x-f.start.x)*.4+Math.sin(i*2.4)*75)+'px','--mid-y':((f.end.y-f.start.y)*.35-35-Math.cos(i*1.7)*50)+'px','--end-x':(f.end.x-f.start.x)+'px','--end-y':(f.end.y-f.start.y)+'px',animationDelay:(i*14)+'ms'} as CSSProperties}/>)}<div className="completion-arrival" style={{left:f.end.x,top:f.end.y}}><span>完成 +1</span></div></div>:<div key={f.id} className="focus-celebration" data-celebration="focus"><i/><i/><i/><span>这一轮，拿下了</span></div>)}</div>;
}
