import {checkPrintedWeekday} from './operating-meituan-ocr.ts';
import {matchPrintedStore} from './operating-store-glyph.ts';
import {readRevenueGrid} from './operating-revenue-ocr.ts';
import {isIdentifierColumn} from './operating-field-dictionary.ts';
import {matchImportStore} from './operating-store-match.ts';
import type {OperatingSheet,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingFields} from './operating-data.ts';
import {platformImportField} from './operating-paste.ts';
import type {OcrBounds} from './operating-ocr.ts';
import {startOcrJob} from './operating-ocr-job.ts';
import {operatingImportDate} from './operating-import-layout.ts';

type Cell={row:number;column:number;bytes:Uint8Array};
const compact=(value:string)=>value.replace(/\s+/g,'');
const plainNumber=(s:string)=>/^\d+(?:\.\d+)?$/.test(s);
const subtotal=(s:string)=>/^(?:月度|合计|总计|小计|第[一二三四五六七八九十\d]+周(?:合计)?)$/.test(compact(s));

/** Re-read a ruled daily table using the source cells, including its printed date column. */
export async function readDailyGrid(file:File,rows:string[][],bounds:OcrBounds,reference:string,sheet:OperatingSheet,template:OperatingTemplate|undefined,stores:{id:string;name:string}[]|undefined,live:()=>boolean,register:(job:ReturnType<typeof startOcrJob>)=>void){
 const dateHeading=(s:string)=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(compact(s));
 let header=rows.findIndex((r,i)=>i>=bounds.prefix&&r.some(dateHeading));
 const last=bounds.prefix+bounds.y.length-2;
 if(bounds.x.length<3||last<bounds.prefix+1||bounds.y.length>72)return;
 const bitmap=await createImageBitmap(file);
 try{
  const sx=bitmap.width/bounds.width,sy=bitmap.height/bounds.height,width=bounds.x.length-1;
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('无法读取截图');ctx.drawImage(bitmap,0,0);
  async function crop(row:number,column:number,left:number,top:number,right:number,bottom:number,zoom=3):Promise<Cell>{
   const x=Math.max(0,Math.round(left)+2),y=Math.max(0,Math.round(top)+2);
   const w=Math.max(1,Math.round(right)-x-1),h=Math.max(1,Math.round(bottom)-y-1);
   const img=ctx!.getImageData(x,y,w,h),p=img.data;
   const light=(i:number)=>(p[i]+p[i+1]+p[i+2])/3,bg=light(0);
   for(let i=0;i<p.length;i+=4){const value=Math.max(0,255-255*Math.abs(light(i)-bg)/Math.max(60,bg>128?bg:255-bg));p[i]=p[i+1]=p[i+2]=value;}
   const small=document.createElement('canvas');small.width=w;small.height=h;small.getContext('2d')!.putImageData(img,0,0);
   const out=document.createElement('canvas');const scale=Math.min(zoom,2200/w,160/h);out.width=Math.ceil(w*scale)+20;out.height=Math.ceil(h*scale)+20;const g=out.getContext('2d')!;
   g.fillStyle='white';g.fillRect(0,0,out.width,out.height);g.drawImage(small,10,10,w*scale,h*scale);
   const blob=await new Promise<Blob>((yes,no)=>out.toBlob(b=>b?yes(b):no(Error('截图读取失败'))));
   return {row,column,bytes:new Uint8Array(await blob.arrayBuffer())};
  }
  function cell(row:number,column:number,zoom?:number){const y=row-bounds.prefix;return crop(row,column,bounds.x[column]*sx,bounds.y[y]*sy,bounds.x[column+1]*sx,bounds.y[y+1]*sy,zoom);}
  async function read(cells:Cell[],chinese:boolean,unrestricted=false,multiline=false){
   if(!cells.length||!live())return [];
   const base=new URL('/workbench/ocr/v7',location.origin).href;
   const job=startOcrJob(cells[0].bytes,{assetBase:base,remainingCells:cells.slice(1).map(c=>c.bytes),chineseCells:chinese,multilineCells:multiline,digitsOnly:!chinese&&!unrestricted,workerFactory:()=>new Worker(base+'/worker.min.js')});register(job);
   return (await job.promise).cellTexts||[];
  }
  let dateColumn=header<0?-1:rows[header].findIndex(dateHeading);
  if(header<0){
   // Whole-image OCR can miss an entire header cell even in a clearly ruled table.
   const candidates:Cell[]=[];
   for(let r=bounds.prefix;r<Math.min(last,bounds.prefix+5);r++)for(let c=0;c<width;c++)candidates.push(await cell(r,c,2));
   const scanned=await read(candidates,true);if(!live())return;
   const found=scanned.findIndex(dateHeading);if(found<0)return;
   header=candidates[found].row;dateColumn=candidates[found].column;
  }
  const first=header+1;if(first>last)return;
  const labels:Cell[]=[];
  const titleBottom=bounds.y[0]>5?bounds.y[0]:bounds.y[1];
  if(header>0&&titleBottom>5)labels.push(await crop(-1,-1,0,0,bitmap.width,titleBottom*sy));
  for(let c=0;c<width;c++)labels.push(await cell(header,c));
  for(let r=first;r<=(sheet==='targets'?Math.min(last,header+4):last);r++)labels.push(await cell(r,dateColumn));
  const results=await read(labels,true,false,sheet==='meituan');if(!live())return;
  if((sheet==='revenue'||sheet==='targets')&&dateColumn===0){
   const printedName=(column:number)=>{
    const x=Math.round(bounds.x[column]*sx)+2,y=Math.round(bounds.y[header-bounds.prefix]*sy)+2;
    return matchPrintedStore(ctx,x,y,Math.max(1,Math.round(bounds.x[column+1]*sx)-x-1),Math.max(1,Math.round(bounds.y[header-bounds.prefix+1]*sy)-y-1),(stores||[]).map(s=>s.name));
   };
   const revenue=await readRevenueGrid(rows,header,last,reference,stores||[],labels,results,cell,read,live,printedName,sheet==='targets');
   if(revenue||!live())return revenue;
  }
  const out=rows.map(r=>[...r]);let title='';
  const fields=operatingFields(sheet,template);
  const fieldOf=(s:string)=>{
   const label=compact(s).replace(/^[”/]+|\/+$/g,'');
   return platformImportField(sheet==='meituan'?label.replace(/[（(]元[|丨][）)]$/,'(元)').replace(/^cpc了曝光次数$/i,'cpc曝光次数'):label,sheet,fields);
  };
  const asDate=(s:string)=>{try{return operatingImportDate(s,reference);}catch{return '';}};
  const printedDate=(s:string)=>asDate(s)||asDate(s.trim().match(/^[^\d./-]{1,8}\s+(\d{1,2}\/\d{1,2}\/\d{4})$/)?.[1]||'');
  for(const [i,{row,column}] of labels.entries()){
   const clean=compact(results[i]||'');if(row<0){title=clean;continue;}
   if(row===header){const field=fieldOf(clean)||fieldOf(out[row][column]);if(field)out[row][column]=field.label;else if(clean)out[row][column]=clean;}
   else{const original=out[row][column];out[row][column]=printedDate(clean)||printedDate(original)||(subtotal(clean)?clean:original||clean);}
  }
  out[header][dateColumn]='日期';
  const uncertainHeaders=out[header].flatMap((s,c)=>c!==dateColumn&&!fieldOf(s)&&!/周|日期|率|ROI|范围|名称|备注|编号|代码|手机号/i.test(s)?[c]:[]);
  if(uncertainHeaders.length){
   const rereads:Cell[]=[];for(const c of uncertainHeaders)rereads.push(await cell(header,c,1.5));
   const alternate=await read(rereads,true);if(!live())return;
   for(const [i,c] of uncertainHeaders.entries()){
    const f=fieldOf(alternate[i]||'');
    if(f)out[header][c]=f.label;
   }
  }
  const checkedDates:string[]=[];
  if(sheet==='meituan'){
   // Compare independent readings of the printed date before accepting one.
   for(let r=first;r<=last;r++){
    const current=asDate(out[r][dateColumn]),original=printedDate(rows[r][dateColumn]);
    if(!current||!original||current===original)continue;
    const before=Date.parse(out[r-1]?.[dateColumn]+'T00:00:00Z'),after=Date.parse(out[r+1]?.[dateColumn]+'T00:00:00Z');
    const agreed=[current,original].find(day=>Date.parse(day+'T00:00:00Z')===before+86400000&&after===before+2*86400000);
    out[r][dateColumn]=agreed||current+'（两次日期识别不一致）';if(agreed)checkedDates.push(agreed);
   }
   const week=out[header].findIndex(v=>/^(周|星期)$/.test(compact(v)));
   if(week>=0)for(let r=first;r<=last;r++){
    const printed=out[r][dateColumn],checked=checkPrintedWeekday(printed,out[r][week],out[r-1]?.[dateColumn]||'',out[r+1]?.[dateColumn]||'');
    if(checked!==printed&&asDate(checked))checkedDates.push(checked);
    out[r][dateColumn]=checked;
   }
  }
  const numeric:Cell[]=[];const dated:number[]=[];
  for(let r=first;r<=last;r++){
   if(!asDate(out[r][dateColumn]))continue;
   dated.push(r);
   for(let c=0;c<width;c++){
    if(c===dateColumn||isIdentifierColumn(out[header][c])||/^(?:周|星期|门店|门店名称|渠道|范围)$/.test(out[header][c]))continue;
    if(!fieldOf(out[header][c])&&(!template||!out[header][c]||/率|ROI|编号|代码|日期|名称|备注|时间|手机|客户|姓名/i.test(out[header][c])))continue;
    numeric.push(await cell(r,c));
   }
  }
  if(stores?.length){
   const column=out[header].findIndex(s=>/^(?:门店(?:名称|名)?|店名|店铺(?:名称)?|渠道(?:名称)?|范围)$/.test(compact(s)));
   if(column>=0){
    const known=(s:string)=>{try{return matchImportStore(s.replace(/\s+/g,''),stores).name;}catch{return '';}};
    const cells:Cell[]=[];
    for(const r of dated)if(!known(out[r][column]))cells.push(await cell(r,column,2));
    const names=await read(cells,true);if(!live())return;
    for(const [i,{row}] of cells.entries()){
     const matched=known(names[i]||'');if(matched)out[row][column]=matched;
    }
   }
  }
  const knownCells=numeric.filter(c=>fieldOf(out[header][c.column])),unknownCells=numeric.filter(c=>!fieldOf(out[header][c.column]));
  // Unmapped text must not become a quantity just because the OCR engine restricts its alphabet to digits.
  const knownNumbers=await read(knownCells,false);if(!live())return;
  const rawUnknown=await read(unknownCells,true);if(!live())return;
  const readings=new Map<Cell,string>();
  knownCells.forEach((c,i)=>readings.set(c,knownNumbers[i]||''));unknownCells.forEach((c,i)=>readings.set(c,rawUnknown[i]||''));
  const numbers=numeric.map(c=>readings.get(c)||'');
  const uncertain:string[]=[];
  for(const [i,{row,column}] of numeric.entries()){
   const old=rows[row][column]?.trim()||'',fresh=numbers[i]?.trim()||'';
   if(plainNumber(fresh)&&(!plainNumber(old)||Number(fresh)===Number(old)))out[row][column]=fresh;
   else {out[row][column]=old;uncertain.push(row+':'+column);}
  }
  const unresolved=knownCells.filter(({row,column})=>!plainNumber(out[row][column])||uncertain.includes(row+':'+column));
  if(unresolved.length){
   const retry:Cell[]=[];for(const {row,column} of unresolved)retry.push(await cell(row,column,2));
   const again=await read(retry,false);if(!live())return;
   for(const [i,{row,column}] of retry.entries()){
    const value=again[i]?.trim()||'',original=rows[row][column]||'',first=numbers[numeric.findIndex(c=>c.row===row&&c.column===column)]?.trim()||'';
    if(plainNumber(value)&&(!plainNumber(original)&&!plainNumber(first)||[original,first].some(v=>plainNumber(v)&&Number(v)===Number(value))))out[row][column]=value;
    else out[row][column]='';
   }
  }
  const month=out.slice(first,last+1).find(row=>compact(row[dateColumn])==='月度');
  const discrepancies:string[]=[];
  if(month)for(let c=0;c<width;c++){
   const f=fieldOf(out[header][c]);if(!f||f.kind==='stars'||!plainNumber(month[c]))continue;
   const cents=(v:string)=>Math.round(Number(v)*100);
   const values=dated.map(r=>out[r][c]),expected=cents(month[c]),sum=values.reduce((n,v)=>n+(plainNumber(v)?cents(v):0),0);
   if(values.every(plainNumber)&&sum===expected)continue;
   // A total can corroborate a fresh pixel reading, but must never manufacture a missing value.
   const alternatives:Cell[]=[];
   for(const r of dated){
    const y=r-bounds.prefix,x0=bounds.x[c]*sx,x1=bounds.x[c+1]*sx,margin=out[r][c].length<=3?(x1-x0)*.18:0;
    alternatives.push(await crop(r,c,x0+margin,bounds.y[y]*sy,x1-margin,bounds.y[y+1]*sy,4));
   }
   const fresh=await read(alternatives,false,true);if(!live())return;

   const candidates=dated.flatMap((r,i)=>{
    const v=compact(fresh[i]||'').replace(/^[Iil|1]+$/,s=>'1'.repeat(s.length)),old=values[i];
    return plainNumber(v)&&v!==old&&(!plainNumber(old)||Number(old)!==Number(v))&&
     sum-(plainNumber(old)?cents(old):0)+cents(v)===expected&&values.every((s,j)=>j===i||plainNumber(s))?[{r,v}]:[];
   });
   if(candidates.length===1)out[candidates[0].r][c]=candidates[0].v;
   else discrepancies.push(f.label);
  }
  if(sheet==='douyin'&&title.includes('平台数据')&&out[header].includes('私信开口人数')&&out[header].includes('私信咨询人数'))title=title.replace('拌音','抖音');
  // Preserve unreadable rows for correction. Only a visibly labelled subtotal is excluded from preview.
  if(title&&header>0&&/平台数据/.test(title)&&/抖音|美团/.test(title)){
   for(let r=0;r<header;r++)out[r]=Array(width).fill('');
   out[0][0]=title;
  }
  return {rows:out,header,uncertain,days:dated.length,discrepancies,checkedDates};
 }finally{bitmap.close();}
}
