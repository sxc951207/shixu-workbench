'use client';
import React from 'react';
import {importReceiptStage,operatingImportCounts,type OperatingImportReceipt as Receipt} from '../lib/workbench/operating-reimport';
import {operatingSheetNames} from '../lib/workbench/operating-work-queue';

const stages=[
 ['draft','草稿，待提交'],['returned','已退回，待补充'],['submitted','已提交，等主管确认'],
 ['approved','已确认，领导可见'],['unresolved','需核对']
] as const;
const dateLabel=(item:Receipt)=>item.sheet==='targets'?item.date.slice(0,7)+' 门店月目标':item.date;

function ReceiptRow({item,onView}:{item:Receipt;onView:(item:Receipt)=>void}){
 const record=item.record;
 return <li>
  <strong>{dateLabel(item)}</strong> · {item.status}
  {record&&<> · V{record.version}
   {record.status!=='approved'&&(record.publishedVersion>0?' · 领导仍看已确认 V'+record.publishedVersion:' · 尚未进入领导汇总')}
   {item.submitIssue&&' · '+item.submitIssue}
   {' '}<button type="button" className="co-text" aria-label={'查看 '+dateLabel(item)+' '+(record.template?.name||operatingSheetNames[item.sheet]||'')+' 的记录'} onClick={()=>onView(item)}>查看记录</button>
  </>}
  {!!item.changes?.length&&<details><summary>{item.status} · {item.changes.length} 项差异</summary><ul>{item.changes.map((change,index)=><li key={index}>{change}</li>)}</ul></details>}
 </li>;
}

export default function OperatingImportOutcome({receipts,onView,onSubmit}:{receipts:Receipt[];onView:(item:Receipt)=>void;onSubmit:(receipts:Receipt[])=>void}){
 const days=receipts.filter(item=>item.sheet!=='targets'),targets=receipts.filter(item=>item.sheet==='targets');
 const counts=operatingImportCounts(receipts);
 const drafts=receipts.filter(item=>!item.submitIssue&&['draft','returned'].includes(importReceiptStage(item)));
 return <section className="op-import-outcome" aria-label="业务日期导入回执">
  <h4>{days.length?'本次识别了 '+new Set(days.map(item=>item.date)).size+' 个业务日':'本次月目标导入结果'}</h4>
  <p role="status" aria-label="导入结果统计">新增 {counts.created} · 更新 {counts.updated} · 一致 {counts.unchanged} {counts.reconciled>0&&' · 重试核实 '+counts.reconciled} · 异常 {counts.errors}{counts.review>0&&' · 待核对 '+counts.review}{counts.skipped>0&&' · 跳过 '+counts.skipped}{counts.pending>0&&' · 未处理 '+counts.pending}</p>
  {stages.map(([stage,label])=>{
   const group=days.filter(item=>importReceiptStage(item)===stage);
   if(!group.length)return null;
   return <details key={stage} className="op-import-stage" open={stage==='unresolved'||undefined}>
    <summary><strong>{group.length} 天{label}</strong> · 查看这 {group.length} 天</summary>
    <ul>{group.map(item=><ReceiptRow key={item.sheet+item.date} item={item} onView={onView}/>)}</ul>
   </details>;
  })}
  {targets.length>0&&<div><strong>月目标</strong><ul>{targets.map(item=><li key={item.date}>{stages.find(([stage])=>stage===importReceiptStage(item))?.[1]}<ul><ReceiptRow item={item} onView={onView}/></ul></li>)}</ul></div>}
  {!!drafts.length&&<button type="button" className="op-button" onClick={()=>onSubmit(drafts)}>勾选本次草稿并提交（{drafts.length}）</button>}
 </section>;
}
