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

type Active = () => boolean;
type Register = (job:ReturnType<typeof startOcrJob>) => void;
async function gridCellReader(file:File,bounds:OcrBounds,live:Active,register:Register){
 const bitmap=await createImageBitmap(file);
  const sx=bitmap.width/bounds.width,sy=bitmap.height/bounds.height,width=bounds.x.length-1;
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});try{if(!ctx)throw Error('无法读取截图');ctx.drawImage(bitmap,0,0);}finally{bitmap.close();}
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
  return {cell,crop,read,sx,sy,width,ctx,sourceWidth:canvas.width};
}

/** Recheck visible ink in missing numeric cells of unfamiliar dated tables. */
export async function recoverMissingDailyCells(file:File,rows:string[][],bounds:OcrBounds,live:Active,register:Register){
 const reader=await gridCellReader(file,bounds,live,register);
 const out=rows.map(row=>[...row]),cells:Cell[]=[],headCells:Cell[]=[];
 const axisOf=(row:string[])=>row.findIndex(v=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(compact(v)));
 const limit=Math.min(rows.length,bounds.prefix+bounds.y.length-1);
 for(let r=bounds.prefix;r<limit;r++){
  if(axisOf(out[r])<0)continue;
  for(let c=0;c<reader.width&&headCells.length<80;c++)if(!out[r][c])headCells.push(await reader.cell(r,c,2));
 }
 const headings=await reader.read(headCells,true);
 for(const [i,{row,column}] of headCells.entries()){
  const value=(headings[i]||'').replace(/\s/g,'');
  if(/[\u3400-\u9fff]{2}/.test(value))out[row][column]=value;
 }
 if(!live())return out;
 // Re-read printed dates even for an unfamiliar project. Do not interpolate missing days.
 const dateCells:Cell[]=[];
 const looksDate=(v:string)=>{try{operatingImportDate(compact(v),'2000-01-01');return true;}catch{return false;}};
 let axis=-1;
 for(let r=bounds.prefix;r<limit;r++){
  const col=axisOf(out[r]);if(col>=0){axis=col;continue;}
  if(axis<0||looksDate(out[r][axis]||'')||subtotal(out[r][axis]||''))continue;
  if(out[r].some((v,c)=>c!==axis&&plainNumber(compact(v)))&&dateCells.length<100)dateCells.push(await reader.cell(r,axis));
 }
 const dateTexts=await reader.read(dateCells,true);
 if(!live())return out;
 for(const [i,{row,column}] of dateCells.entries()){
  const text=compact(dateTexts[i]||'');
  if(looksDate(text)||subtotal(text))out[row][column]=text;
  else if(/^\s*\d{4,7}\s*$/.test(out[row][column]))out[row][column]='日期待核对';
 }
 let date=-1,labels:string[]=[];
 for(let r=bounds.prefix;r<limit;r++){
  const row=out[r];
  const axis=axisOf(row);
  if(axis>=0){labels=row;date=axis;continue;}
  if(date<0||!/^\d{1,4}[-/.年月]\d{1,2}/.test(compact(row[date]||'')))continue;
  for(let c=0;c<Math.min(labels.length,reader.width);c++){
   if(c===date||row[c]||!labels[c]||isIdentifierColumn(labels[c])||!/数|金额|消耗|花费|收入|成本|单价|销量|点击|曝光|业绩|率|ROI/i.test(labels[c]))continue;
   // Inspect the cell interior so ruling lines cannot turn a genuine blank into a zero.
   const left=Math.ceil(bounds.x[c]*reader.sx)+4,top=Math.ceil(bounds.y[r-bounds.prefix]*reader.sy)+4;
   const w=Math.floor(bounds.x[c+1]*reader.sx)-left-4,h=Math.floor(bounds.y[r-bounds.prefix+1]*reader.sy)-top-4;
   if(w<4||h<4)continue;
   const px=reader.ctx.getImageData(left,top,w,h).data;
   let ink=0,x0=w,y0=h,x1=0,y1=0;
   for(let i=0;i<px.length;i+=4){
    if(Math.abs(px[i]-px[0])+Math.abs(px[i+1]-px[1])+Math.abs(px[i+2]-px[2])<=240)continue;
    const x=i/4%w,y=Math.floor(i/4/w);
    ink++;x0=Math.min(x,x0);x1=Math.max(x,x1);y0=Math.min(y,y0);y1=Math.max(y,y1);
   }
   if(ink<4)continue;
   out[r][c]='待核对';
   if(live()&&cells.length<160)cells.push(await reader.crop(r,c,left+Math.max(-2,x0-6),top+Math.max(-2,y0-6),
    left+Math.min(w+1,x1+6),top+Math.min(h+1,y1+6),3));
  }
 }
 const texts=await reader.read(cells,false,true);
 for(const [i,cell] of cells.entries()){
  const value=(texts[i]||'').trim();
  if(/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(value))out[cell.row][cell.column]=value;
 }
 return out;
}

export async function readTemplateHeader(file:File,rows:string[][],bounds:OcrBounds,header:number,live:Active,register:Register){
 if(header<bounds.prefix||header>=bounds.prefix+bounds.y.length-1||bounds.x.length<3||bounds.x.length>45||rows.length<3)return;
 const {cell,crop,read,width,sourceWidth,sy,ctx}=await gridCellReader(file,bounds,live,register);
 const cells:Cell[]=[];
 for(let column=0;column<width;column++)cells.push(await cell(header,column,2));
 // A full-width title may sit above the table grid or in its first merged row.
 const title=rows.findIndex((r,i)=>i<header&&r.filter(Boolean).length===1&&r.some(v=>v.length>=4));
 if(title>=0){
  const top=title<bounds.prefix?0:bounds.y[title-bounds.prefix]*sy;
  const bottom=bounds.y[Math.max(0,title-bounds.prefix+1)]*sy;
  if(bottom-top>=8){
   // Avoid window chrome and the thin white gutter above a colored title.
   const y=Math.floor((top+bottom)/2), edge=Math.floor(sourceWidth*.06);
   const color=ctx.getImageData(edge,y,1,1).data;
   const column=ctx.getImageData(edge,Math.floor(top),1,Math.ceil(bottom)-Math.floor(top)).data;
   const same=(at:number)=>Math.abs(color[0]-column[at*4])+Math.abs(color[1]-column[at*4+1])+Math.abs(color[2]-column[at*4+2])<48;
   let a=y-Math.floor(top),b=a;while(a>0&&same(a-1))a--;while(b+1<column.length/4&&same(b+1))b++;
   if(b-a>=8)cells.push(await crop(title,-1,0,Math.floor(top)+a,sourceWidth,Math.floor(top)+b+1));
  }
 }
 const texts=await read(cells,true);if(!live())return;
 const out=rows.map(row=>[...row]);
 for(const [i,{row,column}] of cells.entries()){
  const text=(texts[i]||'').trim().replace(/\s*([\u3400-\u9fff])\s*/g,'$1');
  if(!text)continue;
  if(column<0)out[row][0]=text;
  else if(/[\u3400-\u9fff]/.test(text)||!/[\u3400-\u9fff]/.test(out[row][column]||''))out[row][column]=text;
 }
 const labels=out[header];
 const privateTraffic=labels.some(v=>v.includes('私信开口'))&&labels.some(v=>v.includes('门店访问'));
 const exposure=labels.some(v=>v.includes('自然曝光'))&&labels.some(v=>/cpc.*曝光|付费曝光/i.test(v));
 if(privateTraffic||exposure){
  const sheet=privateTraffic?'douyin':'meituan',fields=operatingFields(sheet);
  const match=(v:string)=>platformImportField(compact(v).replace(/[|/]+$/,''),sheet,fields);
  const retry:Cell[]=[];
  for(let c=0;c<width;c++){
   const found=match(labels[c]);
   if(found)labels[c]=found.label;
   else if(privateTraffic&&/私信/.test(labels[c]))retry.push(await cell(header,c,4));
  }
  if(retry.length){
   const alternate=await read(retry,true);if(!live())return;
   const multiline=[];
   for(const {column} of retry)multiline.push(await cell(header,column,3));
   const third=await read(multiline,true,false,true);if(!live())return;
   for(const [i,{column}] of retry.entries()){
    const readings=[labels[column],compact(alternate[i]||''),compact(third[i]||'')];
    const leadHeading=/^私信线[索泰率]人(?:数)?$/;
    const matches=new Set(readings.map(v=>match(v)?.label).filter(Boolean));
    if(matches.size===1)labels[column]=[...matches][0]!;
    else if(matches.size===0&&readings.filter(v=>leadHeading.test(v)).length>=2)
     labels[column]='私信留资人数';
   }
  }
  if(privateTraffic&&title>=0)out[title][0]=out[title][0].replace(/[(（]拌音[）)]/,'（抖音）');
 }
 return out;
}

/** Re-read a ruled daily table using the source cells, including its printed date column. */
export async function readDailyGrid(file:File,rows:string[][],bounds:OcrBounds,reference:string,sheet:OperatingSheet,template:OperatingTemplate|undefined,stores:{id:string;name:string}[]|undefined,live:()=>boolean,register:(job:ReturnType<typeof startOcrJob>)=>void){
 const dateHeading=(s:string)=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(compact(s));
 let header=rows.findIndex((r,i)=>i>=bounds.prefix&&r.some(dateHeading));
 const last=bounds.prefix+bounds.y.length-2;
 if(bounds.x.length<3||last<bounds.prefix+1||bounds.y.length>72)return;
 const {cell,crop,read,sx,sy,width,ctx,sourceWidth}=await gridCellReader(file,bounds,live,register);
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
  if(header>0&&titleBottom>5)labels.push(await crop(-1,-1,0,0,sourceWidth,titleBottom*sy));
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
  if(sheet==='douyin'){
   const week=out[header].findIndex(v=>/^(周|星期)$/.test(compact(v)));
   if(week>=0){
    // Weekday is a display dimension: derive it only for a validated calendar date.
    out[header][week]='星期';
    for(let r=first;r<=last;r++){const d=asDate(out[r][dateColumn]);if(d)out[r][week]='星期'+'日一二三四五六'[new Date(d+'T00:00:00Z').getUTCDay()];}
   }
  }
  const numeric:Cell[]=[];const dated:number[]=[];
  for(let r=first;r<=last;r++){
   if(asDate(out[r][dateColumn]))dated.push(r);
   else if(sheet!=='douyin'||!subtotal(out[r][dateColumn]))continue;
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
}
