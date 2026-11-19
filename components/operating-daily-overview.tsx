import React from 'react';
import type {OperatingRecord} from '../cloud/company/operating-model';
import {commonOperatingDefinition,operatingFields} from '../lib/workbench/operating-data';
import {formatOperatingMoney,operatingTableTotals} from '../lib/workbench/operating-paste';

export default function OperatingDailyOverview({record,records}:{record:OperatingRecord;records:OperatingRecord[]}) {
 if(record.status!=='approved'||record.sheet==='targets'||record.sheet.endsWith('-stores'))return null;
 const yesterday=new Date(Date.parse(record.date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 const priorRecord=records.find(r=>r.companyId===record.companyId&&r.projectId===record.projectId&&r.sheet===record.sheet&&r.date===yesterday);
 const prior=priorRecord?.published??(priorRecord?.status==='approved'?priorRecord:null);
 const keys=(r:typeof prior)=>JSON.stringify(r?.rows.map(row=>row.storeId).sort());
 const comparable=prior&&keys(prior)===keys(record)&&(!record.template&&!prior.template||commonOperatingDefinition([record,prior]));
 const fields=operatingFields(record.sheet,record.template).filter(f=>f.kind!=='stars');
 const preferred=['orderAmount','verifiedAmount','refundAmount'];
 const orderedFields=[...preferred.flatMap(key=>fields.filter(f=>f.key===key)),...fields.filter(f=>!preferred.includes(f.key))];
 try {
  const today=operatingTableTotals(record.rows,fields,true);
  const previous=comparable?operatingTableTotals(prior.rows,fields,true):{};
  const visible=orderedFields.filter(f=>today[f.key]!=null).slice(0,3);
  if(!visible.length)return null;
  return <section className="op-readout" aria-label="当日经营概览"><h4>当日概览</h4><div className="op-readout-grid">{visible.map(f=>{
   const value=today[f.key]!,before=previous[f.key],change=before==null?null:value-before;
   const fmt=(v:number)=>f.kind==='money'?formatOperatingMoney(v)+' 元':v.toLocaleString('zh-CN');
   return <article key={f.key}><span>{f.label}</span><strong>{fmt(value)}</strong><small>{change===null?'暂无可比的前一日数据':change===0?'与前一日持平':'较前一日'+(change>0?'增加 ':'减少 ')+fmt(Math.abs(change))}</small></article>;
  })}</div></section>;
 }catch{return null;}
}
