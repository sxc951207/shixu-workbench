'use client';
import {useEffect} from 'react';
import type {RefObject} from 'react';

export default function WorkspaceEffects({rootRef,enabled,cardSelector='.panel,.stat-card,.project-card,.focus-hero',atmosphere=true}:{rootRef:RefObject<HTMLDivElement|null>;enabled:boolean;cardSelector?:string;atmosphere?:boolean}){
 useEffect(()=>{
  const root=rootRef.current;if(!root)return;
  const fine=window.matchMedia('(hover: hover) and (pointer: fine)'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,card:HTMLElement|null=null,pointer:{x:number;y:number;target:Element|null}|null=null;
  const resetCard=()=>{if(!card)return;delete card.dataset.spotlit;for(const p of ['--card-x','--card-y','--tilt-x','--tilt-y'])card.style.removeProperty(p);card=null;};
  const paint=()=>{frame=0;if(!pointer)return;root.style.setProperty('--cursor-x',pointer.x+'px');root.style.setProperty('--cursor-y',pointer.y+'px');root.dataset.pointerActive='true';
   const next=pointer.target?.closest<HTMLElement>(cardSelector)||null;
   if(next!==card)resetCard();if(!next||!root.contains(next))return;card=next;
   const b=card.getBoundingClientRect(),x=pointer.x-b.left,y=pointer.y-b.top;
   card.dataset.spotlit='true';card.style.setProperty('--card-x',x+'px');card.style.setProperty('--card-y',y+'px');
   card.style.setProperty('--tilt-x',((.5-y/Math.max(1,b.height))*.9).toFixed(2)+'deg');card.style.setProperty('--tilt-y',((x/Math.max(1,b.width)-.5)*.9).toFixed(2)+'deg');
  };
  const move=(event:PointerEvent)=>{if(event.pointerType!=='mouse'&&event.pointerType!=='pen')return;pointer={x:event.clientX,y:event.clientY,target:event.target instanceof Element?event.target:null};if(!frame)frame=requestAnimationFrame(paint);};
  const leave=()=>{if(frame)cancelAnimationFrame(frame);frame=0;pointer=null;resetCard();delete root.dataset.pointerActive;root.style.removeProperty('--cursor-x');root.style.removeProperty('--cursor-y');};
  const stop=()=>{root.removeEventListener('pointermove',move);root.removeEventListener('pointerleave',leave);window.removeEventListener('blur',leave);leave();};
  const configure=()=>{stop();if(enabled&&fine.matches&&!reduced.matches){root.addEventListener('pointermove',move,{passive:true});root.addEventListener('pointerleave',leave);window.addEventListener('blur',leave);}};
  configure();fine.addEventListener('change',configure);reduced.addEventListener('change',configure);
  return()=>{fine.removeEventListener('change',configure);reduced.removeEventListener('change',configure);stop();};
 },[rootRef,enabled,cardSelector]);
 if(!atmosphere)return null;
 return <div className="workspace-atmosphere" aria-hidden="true"><div className="ambient-aurora aurora-blue"/><div className="ambient-aurora aurora-violet"/><div className="ambient-grid"><div/></div><div className="ambient-stars"/><div className="cursor-halo"/></div>;
}
