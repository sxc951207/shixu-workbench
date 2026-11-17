import type {OcrBounds} from './operating-ocr.ts';
import {startOcrJob} from './operating-ocr-job.ts';
import {douyinScreenshotPeriod} from './operating-source-date.ts';

const headings=['门店名称','成交金额','成交券数','核销金额','核销券数','核销率','退款金额','退款券数','退款率','评分','新增好评数','好评率','新增中差评数','消耗','成交ROI','核销ROI'];
const numeric=[1,2,3,4,6,7,9,10,12];
const tidy=(text='')=>text.replace(/[\s”"“]/g,'');
const aliases=[['名称','门店','店名','门店名','店铺名称','门店全称','店铺'],['下单金额'],['下单券数'],[],[],[],[],['退款订单数','退单量'],['退单率'],['星级评分','星级'],['新增好评'],['有效好评率'],['新增中差评'],['广告消耗','推广消耗','推广花费'],['下单ROI'],[]];
function layout(row:string[]){
 const keys=row.map(s=>headings.findIndex((h,k)=>[h,...aliases[k]].some(a=>tidy(s).toLowerCase()===a.toLowerCase())));
 if(row.length===16&&[0,1,2,3,4,7,9,10,12,14,15].every(i=>keys[i]===i)&&keys.every((k,i)=>k===-1||k===i))return headings.map((_,i)=>i);
 if(![0,1,2,3,4].every(k=>keys.includes(k))||new Set(keys.filter(k=>k>=0)).size!==keys.filter(k=>k>=0).length)return;
 return keys;
}
export function douyinStoreLayout(rows:string[][]){
 return rows.findIndex(row=>layout(row));
}
export function checkDouyinScreenshot(rows:string[][],header:number){
 const h=rows[header]||[];
 if(h.some(s=>tidy(s)==='消耗范围待核对'||tidy(s)==='消耗'))throw Error('请对照原图核对消耗范围。分店数据的表头填「推广花费」；合并的全平台数填在合计行，表头填「全平台累计消耗」。');
 const name=h.findIndex(s=>[headings[0],...aliases[0]].includes(tidy(s)));
 if(name<0)return;
 const total=rows.findIndex((r,i)=>i>header&&/^(合计|总计|汇总)$/.test(tidy(r[name])));
 if(total<0)return;
 for(const [c,label] of h.entries()){
  const key=headings.findIndex((v,i)=>[v,...aliases[i]].includes(tidy(label)));
  if(!numeric.includes(key)||key===9)continue;
  const amount=[1,3,6].includes(key),pattern=amount?/^\d+(?:\.\d{1,2})?$/:/^\d+$/;
  const norm=(s='')=>s.trim().replace(/^(\d{1,3}(?:,\d{3})+)(\.\d+)?$/,(_,whole,decimal)=>whole.replaceAll(',','')+(decimal||''));
  const expected=norm(rows[total][c]);if(!pattern.test(expected)){if(rows.slice(header+1,total).some(row=>tidy(row[c])))throw Error('请对照原图核对合计行的「'+label+'」。');continue;}
  let sum=0;
  for(const row of rows.slice(header+1,total)){
   if(row.every(v=>!v.trim()))continue;
   const raw=norm(row[c]);if(!pattern.test(raw))throw Error(row[name]+'的「'+label+'」还需核对，请对照原图补全。');
   sum+=Math.round(Number(raw)*(amount?100:1));
  }
  if(sum!==Math.round(Number(expected)*(amount?100:1)))throw Error('「'+label+'」分店合计 '+sum/(amount?100:1)+'，与原图合计 '+expected+' 不一致，请核对这一列。');
 }
}
export async function refineDouyinScreenshot(file:File,rows:string[][],bounds:OcrBounds,header:number,reference:string,live:()=>boolean,register:(job:ReturnType<typeof startOcrJob>)=>void){
 const keys=layout(rows[header]);if(!keys||bounds.x.length!==keys.length+1)return;
 const store=keys.indexOf(0),spend=keys.indexOf(13);
 const total=rows.findIndex((r,i)=>i>header&&/^(合计|总计|汇总)$/.test(tidy(r[store])));
 if(total<=header+1||total-header>31)return;
 const period=douyinScreenshotPeriod(rows.slice(0,header).flat().join(' '),reference);
 const bitmap=await createImageBitmap(file);
 try{
  const sx=bitmap.width/bounds.width,sy=bitmap.height/bounds.height;
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('无法读取原图');
  ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const x=(i:number)=>Math.round(bounds.x[i]*sx),y=(i:number)=>Math.round(bounds.y[i-bounds.prefix]*sy);
  if(!Number.isFinite(y(header+1))||!Number.isFinite(y(total+1)))return;
  function ruled(r:number,c:number){
   const left=x(c)+3,right=x(c+1)-3;let best=0;
   for(let dy=-1;dy<=1;dy++){let count=0;for(let px=left;px<right;px++){const i=((y(r)+dy)*canvas.width+px)*4;if(pixels[i]+pixels[i+1]+pixels[i+2]<380)count++;}best=Math.max(best,count);}
   return best>(right-left)*.65;
  }
  // Only treat the right side as a platform total if the original pixels show a continuous merged area.
  const boundaries=Array.from({length:total-header-1},(_,i)=>header+2+i);
  const merged=spend>=0&&boundaries.length>0&&boundaries.every(r=>!ruled(r,spend)&&ruled(r,keys.indexOf(1)));
  const cells:{r:number;c:number;bytes:Uint8Array}[]=[];
  async function crop(r:number,c:number,scale=3,pad=10){
   const left=x(c)+2,top=y(r)+2,w=x(c+1)-left-2,h=y(r+1)-top-2;if(w<4||h<4)throw Error('截图网格不完整');
   const img=ctx!.getImageData(left,top,w,h),p=img.data;
   const red=p[0]>190&&p[1]<100&&p[2]<100;
   for(let i=0;i<p.length;i+=4){const v=red?255-Math.min(p[i+1],p[i+2]):Math.min(p[i],p[i+1],p[i+2]);p[i]=p[i+1]=p[i+2]=v;}
   const small=document.createElement('canvas');small.width=w;small.height=h;small.getContext('2d')!.putImageData(img,0,0);
   const out=document.createElement('canvas');out.width=w*scale+2*pad;out.height=h*scale+2*pad;const g=out.getContext('2d')!;g.fillStyle='white';g.fillRect(0,0,out.width,out.height);g.drawImage(small,pad,pad,w*scale,h*scale);
   const blob=await new Promise<Blob>((res,rej)=>out.toBlob(b=>b?res(b):rej(Error('截图处理失败'))));return {r,c,bytes:new Uint8Array(await blob.arrayBuffer())};
  }
  for(let r=header+1;r<=total;r++)for(let c=0;c<keys.length;c++){if(!live())return;if(numeric.includes(keys[c]))cells.push(await crop(r,c));}
  if(!live())return;
  const job=startOcrJob(cells[0].bytes,{remainingCells:cells.slice(1).map(cell=>cell.bytes),digitsOnly:true,assetBase:new URL('/workbench/ocr/v7',location.origin).href,workerFactory:()=>new Worker('/workbench/ocr/v7/worker.min.js')});register(job);
  const {cellTexts}=await job.promise;if(!live())return;
  const output=rows.map(r=>[...r]);output[header]=keys.map((k,i)=>headings[k]??rows[header][i]);if(period&&header>0){output[0]=Array(keys.length).fill('');output[0][0]='抖音门店累计 '+period.start+' 至 '+period.end;}
  for(const [i,{r,c}] of cells.entries()){
   const pattern=[1,3,6,9].includes(keys[c])?/^\d+(?:\.\d{1,2})?$/:/^\d+$/;
   const fresh=cellTexts?.[i]?.trim()||'',old=output[r][c].trim();
   output[r][c]=pattern.test(fresh)&&(!pattern.test(old)||Number(fresh)===Number(old))?fresh:pattern.test(old)&&!pattern.test(fresh)?old:'';
  }
  // Re-read a missing count at a different scale; accept only an independently
  // recognized number that also reconciles the column to its printed total.
  const retries:{r:number;c:number;bytes:Uint8Array;expected:number}[]=[];
  for(const k of [2,4,7,10,12]){
   const c=keys.indexOf(k);if(c<0||!/^\d+$/.test(output[total][c]))continue;
   const detail=output.slice(header+1,total).map(r=>r[c]),missing=detail.flatMap((v,i)=>v===''?[i]:[]);
   if(missing.length!==1)continue;
   const expected=Number(output[total][c])-detail.reduce((sum,v)=>sum+Number(v),0),r=header+1+missing[0];
   for(const scale of [2,4])retries.push({...await crop(r,c,scale,5),expected});
  }
  if(retries.length&&live()){
   const retry=startOcrJob(retries[0].bytes,{remainingCells:retries.slice(1).map(v=>v.bytes),digitsOnly:true,assetBase:new URL('/workbench/ocr/v7',location.origin).href,workerFactory:()=>new Worker('/workbench/ocr/v7/worker.min.js')});register(retry);
   const read=await retry.promise;if(!live())return;
   retries.forEach(({r,c,expected},i)=>{const s=read.cellTexts?.[i]?.trim()||'';if(/^\d+$/.test(s)&&Number(s)===expected)output[r][c]=s;});
  }
  if(merged){
   for(const c of [spend,...[14,15].map(k=>keys.indexOf(k)).filter(c=>c>=0&&boundaries.every(r=>!ruled(r,c)))]){
    const values=output.slice(header+1).map(r=>r[c].trim()).filter(Boolean);
    for(const row of output.slice(header+1))row[c]='';
    output[total][c]=values.length===1?values[0]:'';
   }
   output[header][spend]='全平台累计消耗';
  }else if(spend>=0&&boundaries.some(r=>!ruled(r,spend))){
   output[header][spend]='消耗范围待核对';
  }else if(spend>=0){
   output[header][spend]='推广花费';
  }
  return output;
 }finally{bitmap.close();}
}
