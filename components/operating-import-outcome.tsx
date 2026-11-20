'use client';
import React from 'react';
import {importReceiptStage,operatingImportCounts,type OperatingImportReceipt as Receipt} from '../lib/workbench/operating-reimport';
import {operatingSheetNames} from '../lib/workbench/operating-work-queue';

const stages=[
 ['draft','草稿，待提交'],['returned','已退回，待补充'],['submitted','已提交，等待确认'],
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
 const needsReview=(item:Receipt)=>importReceiptStage(item)==='unresolved'||!!item.submitIssue;
 const review=receipts.filter(needsReview);
 const waiting=receipts.filter(item=>importReceiptStage(item)==='submitted').length;
 const approved=receipts.filter(item=>importReceiptStage(item)==='approved').length;
 const unit=!targets.length&&new Set(days.map(item=>item.date)).size===days.length?'天':'条';
 const missingFields=review.length>0&&review.every(item=>item.submitIssue?.startsWith('待补字段：'));
 const commonIssue=missingFields&&review.every(item=>item.submitIssue===review[0].submitIssue)?review[0].submitIssue:'';
 const headline=missingFields?review.length+' '+unit+'已保存，待补字段':review.length?review.length+' '+unit+'需核对':drafts.length?drafts.length+' '+unit+'草稿待提交':receipts.length&&waiting+approved===receipts.length?'本次无需再提交':'暂无导入结果';
 return <section className="op-import-outcome" aria-label="业务日期导入回执">
  <div role="status"><h4>{headline}</h4>
   {(waiting>0||approved>0)&&<p>{[waiting&&waiting+' '+unit+'等待确认',approved&&approved+' '+unit+'已确认'].filter(Boolean).join('，')}。</p>}
   {!!review.length&&<p>{commonIssue||'请查看下方记录中的原因。'}</p>}
  </div>
  {!!drafts.length&&<button type="button" className="co-primary op-receipt-submit" onClick={()=>onSubmit(drafts)}>提交这 {drafts.length} {unit}草稿</button>}
  {stages.map(([stage,label])=>{
   const group=days.filter(item=>stage==='unresolved'?needsReview(item):!needsReview(item)&&importReceiptStage(item)===stage);
   if(!group.length)return null;
   return <details key={stage} className="op-import-stage" open={group.some(needsReview)||undefined}>
    <summary><strong>{group.length} {unit}{stage==='unresolved'&&missingFields?'待补字段':label}</strong> · 查看这 {group.length} {unit}</summary>
    <ul>{group.map(item=><ReceiptRow key={item.sheet+item.date} item={item} onView={onView}/>)}</ul>
   </details>;
  })}
  {targets.length>0&&<div><strong>月目标</strong><ul>{targets.map(item=><li key={item.date}>{stages.find(([stage])=>stage===importReceiptStage(item))?.[1]}<ul><ReceiptRow item={item} onView={onView}/></ul></li>)}</ul></div>}
  <details className="op-receipt-counts"><summary>导入统计明细</summary><p aria-label="导入结果统计">新增 {counts.created} · 更新 {counts.updated} · 一致 {counts.unchanged}{counts.reconciled>0&&' · 重试核实 '+counts.reconciled} · 异常 {counts.errors}{counts.review>0&&' · 待核对 '+counts.review}{counts.skipped>0&&' · 跳过 '+counts.skipped}{counts.pending>0&&' · 未处理 '+counts.pending}</p></details>
 </section>;
}
