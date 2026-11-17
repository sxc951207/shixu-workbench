import React,{useState} from 'react';
import {Pause,Play} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import CompanyLightRibbon from './company-light-ribbon';
import '../app/workspace-material.css';

export function WorkspaceBrand({companyName}:{companyName?:string}){
 return <span className="zb-brand" title={companyName?`${companyName} · 拾序`:"拾序"}><i aria-hidden="true"/><strong>{companyName||"拾序"}</strong>{companyName&&<><span aria-hidden="true">/</span><b>拾序</b></>}</span>;
}

export function BrandScene({still=false,compact=false,companyName}:{still?:boolean;compact?:boolean;companyName?:string}){
 const [paused,setPaused]=useState(false);
 return <div className={'zb-scene'+(compact?' zb-scene-compact':'')} data-still={still||paused}>
  <WorkspaceBrand companyName={companyName}/><CompanyLightRibbon duration={10000} still={still||paused}/>
  {!still&&<button className="zb-motion" type="button" aria-label={paused?'播放品牌动效':'静止显示品牌图形'} title={paused?'播放品牌动效':'静止显示品牌图形'} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={14}/>:<Pause size={14}/>}</button>}
 </div>;
}

export function SectionMark({icon:Icon}:{icon:LucideIcon}){
 return <span className="zb-section-mark" aria-hidden="true"><Icon size={23} strokeWidth={1.6}/></span>;
}
