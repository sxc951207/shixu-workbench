'use client';
import React,{useEffect,useRef} from 'react';

export default function CompanyLightRibbon({duration=4000,still=false}:{duration?:number;still?:boolean}={}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const canvas=ref.current;
  if(!canvas)return;
  const context=canvas.getContext('2d');
  if(!context)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,last=-100,elapsed=0,visible=false;
  function paint(progress:number){
   const width=canvas!.clientWidth,height=canvas!.clientHeight;
   if(!width||!height)return;
   const dpr=Math.min(window.devicePixelRatio||1,2);
   if(canvas!.width!==Math.round(width*dpr)||canvas!.height!==Math.round(height*dpr)){
    canvas!.width=Math.round(width*dpr);canvas!.height=Math.round(height*dpr);
   }
   const ctx=context!;
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
   // Layer open contour lines across the banner, leaving breathing room above each crest.
   const ink=ctx.createLinearGradient(0,0,width,height*.15);
   ink.addColorStop(0,'rgba(95,136,195,0)');
   ink.addColorStop(.35,'rgba(145,170,227,.42)');
   ink.addColorStop(.62,'rgba(224,241,246,.85)');
   ink.addColorStop(.81,'rgba(120,210,200,.67)');
   ink.addColorStop(1,'rgba(111,181,199,.08)');
   const phase=progress*.32;
   const lines=Math.min(44,Math.max(22,Math.round(height/6)));
   ctx.strokeStyle=ink;
   for(let row=0;row<lines;row++){
    const t=row/(lines-1);
    ctx.beginPath();
    for(let step=0;step<=110;step++){
     const x=step/110;
     const fold=Math.exp(-Math.pow((x-.62+.15*t)/.21,2));
     const wave=Math.sin(x*7.1+t*1.7+phase);
     const y=.68-.13*x+.25*t-.34*fold+.12*wave-.10*Math.sin(x*4.2-t*3+phase);
     if(step===0)ctx.moveTo(0,height*y);
     else ctx.lineTo(width*x,height*y);
    }
    ctx.globalAlpha=.49+.41*t;
    ctx.lineWidth=row===lines-1?1.2:.72;
    ctx.stroke();
   }
   ctx.globalAlpha=1;
  }
  function tick(time:number){
   frame=0;
   if(!visible||document.hidden||reduced.matches)return;
   if(last<0)last=time-34;
   if(time-last>=32){elapsed=Math.min(duration,elapsed+Math.min(time-last,70));last=time;paint(1-Math.pow(1-elapsed/duration,2));}
   if(elapsed<duration)frame=requestAnimationFrame(tick);
  }
  function sync(){
   cancelAnimationFrame(frame);last=-100;
   if(document.hidden||!visible)return;
   if(still||reduced.matches||elapsed>=duration){paint(1);return;}
   frame=requestAnimationFrame(tick);
  }
  const resize=new ResizeObserver(()=>{if(visible)paint(still||reduced.matches?1:1-Math.pow(1-elapsed/duration,2));});
  resize.observe(canvas);
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();});
  observer.observe(canvas);reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();reduced.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[duration,still]);
 return <canvas className="co-light-ribbon" ref={ref} aria-hidden="true"/>;
}
