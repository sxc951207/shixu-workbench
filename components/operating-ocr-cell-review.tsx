'use client';
import React,{useState}from'react';
import{ArrowLeft,ArrowRight}from'lucide-react';
import{assertOcrSingleCell}from'../lib/workbench/operating-ocr-review';

export default function OperatingOcrCellReview({rows,header,uncertain,disabled,onEdit}:{rows:string[][];header:number;uncertain:string[];disabled:boolean;onEdit:(row:number,column:number,value:string)=>void}){
 const[selectedRow,setSelectedRow]=useState(0),[selectedColumn,setSelectedColumn]=useState(0);
 const[inputError,setInputError]=useState('');
 const columns=rows[0]?.length||0;if(!rows.length||!columns)return null;
 const row=Math.min(selectedRow,rows.length-1),column=Math.min(selectedColumn,columns-1),index=row*columns+column,total=rows.length*columns;
 const hasHeader=Number.isInteger(header)&&header>=0&&header<rows.length;
 const value=rows[row]?.[column]??'',caption=hasHeader?rows[header]?.[column]?.trim()||'空白表头':'待重新选择表头';
 function move(delta:number){const next=Math.max(0,Math.min(total-1,index+delta));setSelectedRow(Math.floor(next/columns));setSelectedColumn(next%columns);setInputError('');}
 return <section className="op-ocr-cell" aria-label="逐格核对截图">
  <div className="op-config-grid"><label>核对行<select aria-label="选择核对行" value={row} disabled={disabled} onChange={e=>{setSelectedRow(Number(e.target.value));setInputError('');}}>{rows.map((_,r)=><option key={r} value={r}>第{r+1}行{r===header?' · 表头':''}</option>)}</select></label><label>核对列<select aria-label="选择核对列" value={column} disabled={disabled} onChange={e=>{setSelectedColumn(Number(e.target.value));setInputError('');}}>{Array.from({length:columns},(_,c)=><option key={c} value={c}>第{c+1}列</option>)}</select></label></div>
  <p className="op-ocr-cell-position" role="status" aria-live="polite">第{row+1}行 · 第{column+1}列 · {!hasHeader?'表头待重选':row===header?'表头':row<header?'表头之前':'表头之后'} · {index+1}/{total}格</p>
  {!hasHeader&&<p className="co-error" role="alert">原表头已不在当前表格中，请重新选择表头行。</p>}
  <p className="op-ocr-cell-caption">本列表头：<strong>{caption}</strong></p>
  {uncertain.includes(row+':'+column)&&<p className="op-ocr-cell-warning">原识别把握较低，请重点对照截图核对。</p>}
  <label className="op-ocr-cell-label">完整内容<textarea aria-label="当前单元格完整内容" rows={3} maxLength={200} disabled={disabled} value={value} spellCheck={false} onChange={e=>{try{assertOcrSingleCell(e.target.value);onEdit(row,column,e.target.value);setInputError('');}catch(error){setInputError((error as Error).message);}}}/></label>
  {inputError&&<p className="co-error" role="alert">{inputError}</p>}
  {!value&&<p className="op-muted">此格为空白，尚未提供内容；确认实际为零时才填0。</p>}
  <div className="op-ocr-cell-nav"><button type="button" className="op-button" disabled={disabled||index===0} onClick={()=>move(-1)}><ArrowLeft size={16}/>上一格</button><button type="button" className="op-button" disabled={disabled||index===total-1} onClick={()=>move(1)}>下一格<ArrowRight size={16}/></button></div>
  <p className="op-muted">这里与表格共用内容，修改后需要重新勾选核对；切换或浏览单元格不代表已核实。</p>
 </section>;
}
