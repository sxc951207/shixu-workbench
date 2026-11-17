import React from 'react';
import CompanyLightRibbon from './company-light-ribbon';
import {ArrowDown} from 'lucide-react';
import '../app/company-leader-brief.css';

export default function CompanyLeadHeader({confirmedProjects,supervised=false}:{confirmedProjects?:number;supervised?:boolean}){
 return <header className="co-brief"><CompanyLightRibbon/>
  <div className="co-brief-copy">
   <h1>{supervised?'主管项目总览':'项目经营总览'}</h1>
   <span className="co-brief-scope">{supervised?'我负责或担任确认主管的项目 · 仅已确认数据':'仅已确认数据'}</span>
  </div>
  {confirmedProjects!==undefined&&<a className="co-brief-count" href="#co-confirmed-projects" aria-label={'查看已确认进度的 '+confirmedProjects+' 个项目'}>
   <span>已确认进度</span>
   <strong>{confirmedProjects.toLocaleString('zh-CN')}<small> 个项目</small></strong>
   <ArrowDown size={17} aria-hidden="true"/>
  </a>}
 </header>;
}
