'use client';
import React,{useEffect,useState} from 'react';
import {meituanCellValue,verifiedMeituanCell,meituanDailyColumns,meituanDayCandidate} from '../lib/workbench/operating-meituan-ocr';
import {startOcrJob} from '../lib/workbench/operating-ocr-job';
import type {OcrBounds} from '../lib/workbench/operating-ocr';

type Props={rows:string[][];bounds:OcrBounds;date:string;url:string;disabled:boolean;onUse:(rows:unknown[][],header:number)=>void};
export async function readMeituanDates(rows:string[][],bounds:OcrBounds,url:string,dates:string[],active:()=>boolean,register:(job:ReturnType<typeof startOcrJob>)=>void){
    const img=new Image();img.src=url;await img.decode();if(!active())return;
    const sx=img.naturalWidth/bounds.width,sy=img.naturalHeight/bounds.height;
 const candidates=dates.map(date=>meituanDayCandidate(rows,date));
 if(candidates.some(day=>!day))throw Error('原截图中有重复或无效的业务日期，请核对日期列');
 const cells=candidates.flatMap(day=>meituanDailyColumns.map(field=>({row:day!.index,field})));
 async function crop(cell:typeof cells[number],zoom:number){
  const gridRow=cell.row-bounds.prefix,y=bounds.y[gridRow],x=bounds.x[cell.field.index];
  const h=(bounds.y[gridRow+1]-y)*sy-4,w=(bounds.x[cell.field.index+1]-x)*sx-4;
  if(!(h>0&&w>0))throw Error('原截图网格不完整');
  const scale=Math.min(zoom,140/h,440/w);
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*scale)+24;canvas.height=Math.ceil(h*scale)+24;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('原图像素读取失败');
  ctx.imageSmoothingQuality='high';ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,x*sx+2,y*sy+2,w,h,12,12,w*scale,h*scale);
  const blob=await new Promise<Blob>((yes,no)=>canvas.toBlob(b=>b?yes(b):no(Error('无法读取原图')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
 }
 async function read(indices:number[],zoom:number,digitsOnly:boolean){
  const crops:Uint8Array[]=[];
  for(const i of indices){if(!active())return [];crops.push(await crop(cells[i],zoom));}
  if(!active()||!crops.length)return [];
  const base=new URL('/workbench/ocr/v7',location.origin).href;
  const job=startOcrJob(crops[0],{remainingCells:crops.slice(1),digitsOnly,assetBase:base,workerFactory:()=>new Worker(base+'/worker.min.js')});register(job);
  return (await job.promise).cellTexts||[];
 }
 const indices=cells.map((_,i)=>i),first=await read(indices,3,false);if(!active())return;
 const values=cells.map(({row,field},i)=>verifiedMeituanCell(rows[row][field.index],first[i],'money' in field));
 const missing=indices.filter(i=>!values[i]);
 if(missing.length){
  const second=await read(missing,2,true);if(!active())return;
  missing.forEach((i,j)=>{
   const {row,field}=cells[i],money='money' in field;
   const candidate=meituanCellValue(second[j]||'',money);
   if(candidate&&[first[i],rows[row][field.index]].some(v=>meituanCellValue(v,money)===candidate))values[i]=candidate;
  });
 }
 return candidates.map((_,i)=>values.slice(i*meituanDailyColumns.length,(i+1)*meituanDailyColumns.length));

}
export default function MeituanDayReview({rows,bounds,date,url,disabled,onUse}:Props){
 const day=meituanDayCandidate(rows,date);
 const [open,setOpen]=useState(false),[values,setValues]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[reading,setReading]=useState(false);
 const gridRow=(day?.index??-1)-bounds.prefix;
 const y0=bounds.y[gridRow],y1=bounds.y[gridRow+1];
 const valid=!!day&&bounds.x.length===19&&y1>y0;
 useEffect(()=>{
  if(!open||!valid)return;
  let live=true,job:ReturnType<typeof startOcrJob>|undefined;
  async function read(){
   setReading(true);setError('');
   try{
    const result=await readMeituanDates(rows,bounds,url,[date],()=>live,next=>{job=next;});if(live&&result)setValues(result[0]);
   }catch{if(live){setValues(meituanDailyColumns.map(()=>''));setError('逐格细读未完成，请按右侧原图填写。');}}
   finally{if(live)setReading(false);}
  }
  void read();return()=>{live=false;job?.cancel();};
 },[open,valid,url,date,bounds,gridRow,y0,y1]);
 if(!valid)return <p className="op-note">当前填报日期为 {date}。逐日核对需要在 18 列美团日报中唯一读出这一天。请核对所选日期；图中没有这一天时，请返回选择有数据的日期。</p>;
 return <section className="op-note" aria-label="美团平台日报逐格核对"><strong>美团平台日报 · {date}</strong>
 {!open?<p><button type="button" className="op-button" disabled={disabled} onClick={()=>{setValues(day.values);setOpen(true);}}>按这一天逐格读取</button> 适用于原图从「日期、周、下单金额、核销金额」开始的 18 列日报。</p>:<>
 <p>请逐项核对列名、右侧原图和金额小数点。整表和逐格读数有分歧时留空，请按原图补填。第 12、14、15、16 列分别对应 CPC 曝光次数、在线咨询人数、在线咨询留资人数、推广消耗。</p>
 {reading&&<p role="status">正在放大并单独识别这一天的数字…</p>}
 <div className="op-day-cells">{meituanDailyColumns.map((f,i)=>{
 const x=bounds.x[f.index],width=bounds.x[f.index+1]-x;
 return <label key={f.index}><span>{f.label}<small>原图第 {f.index+1} 列{'money' in f?' · 元':''}</small></span><input aria-label={f.label+'核对值'} disabled={reading||disabled} inputMode={'money' in f?'decimal':'numeric'} value={values[i]??''} placeholder="对照右侧填写" onChange={e=>{setConfirmed(false);setError('');setValues(v=>v.map((old,j)=>j===i?e.target.value:old));}}/><svg width="106" height="39" viewBox={[x,y0,width,y1-y0].join(' ')} aria-label={f.label+'原图'} role="img"><image href={url} width={bounds.width} height={bounds.height}/></svg></label>;})}</div>
 <label className="op-ocr-check"><input type="checkbox" checked={confirmed} disabled={disabled||reading} onChange={e=>setConfirmed(e.target.checked)}/>我核对过原图的日期、列顺序和本日数值</label>
 <button type="button" className="co-primary" disabled={!confirmed||disabled||reading} onClick={()=>{try{if(values.some((v,i)=>!v.trim()&&(i<6||i===10)))throw Error('请对照原图补全金额、券数和退款订单数，确为零时填 0。');onUse([['日期','范围',...meituanDailyColumns.map(f=>f.label)],[date,'全平台',...values]],0);setError('');setConfirmed(false);}catch(e){setError((e as Error).message);}}}>预览这一天的美团数据</button>{error&&<p className="co-error" role="alert">{error}</p>}</>}</section>;
}
