'use client';
import {useEffect,useRef,useState} from 'react';
import {companyRequest} from '../cloud/company-root';
import {readReviewReminder,type ReviewReminder} from '../lib/workbench/review-reminder';

export function useReviewReminder(scope:string,companyId:string,revision?:number){
 const cache=useRef<{scope:string;value:ReviewReminder}|null>(null);
 const [display,setDisplay]=useState<{scope:string;value:ReviewReminder}|null>(null);
 useEffect(()=>{
  if(!scope){cache.current=null;setDisplay(null);return;}
  let live=true,running=false,again=false;
  async function refresh(){
   if(!live||document.hidden)return;
   if(running){again=true;return;}
   running=true;
   try{
    const previous=cache.current?.scope===scope?cache.current.value:null;
    const value=await readReviewReminder(companyRequest,companyId,previous,()=>live&&!document.hidden);
    if(live&&value){cache.current={scope,value};setDisplay(cache.current);}
   }catch{
    if(live){cache.current=null;setDisplay(null);}
   }finally{
    running=false;
    if(again&&live){again=false;void refresh();}
   }
  }
  const changed=(event:Event)=>{if((event as CustomEvent).detail===companyId)void refresh();};
  void refresh();
  const timer=window.setInterval(refresh,60000);
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
  document.addEventListener('visibilitychange',refresh);window.addEventListener('company-review-changed',changed);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('company-review-changed',changed);};
 },[scope,companyId,revision]);
 const count=display?.scope===scope?display.value.count:0;
 return {label:count>=100?'99+':count?String(count):'',checkedRevision:display?.scope===scope?display.value.revision:0};
}
