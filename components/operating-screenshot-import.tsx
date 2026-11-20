'use client';
import {operatingFields} from '../lib/workbench/operating-data';
import OperatingVideoFrame,{isReportVideo,reportMediaAccept} from './operating-video-frame';
import React,{useEffect,useRef,useState}from'react';
import{ImagePlus,ScanLine,Upload,X,Plus,Trash2}from'lucide-react';
import{cleanOcrGrid,detectOcrGrid,ocrImageInfo,ocrProcessingSize,ocrTable,reviewedOcrRows}from'../lib/workbench/operating-ocr';
import {screenshotReviewKey,screenshotPixelKey,readReviewedImage,writeScreenshotReview,type ScreenshotReview} from '../lib/workbench/operating-screenshot-draft';
import {checkRevenueOcrTotals,recalculateRevenueTotals} from '../lib/workbench/operating-revenue-ocr';
import {readDailyGrid,readTemplateHeader,recoverMissingDailyCells} from '../lib/workbench/operating-daily-grid';
import{startOcrJob}from'../lib/workbench/operating-ocr-job';
import{mergeOcrHeaders,removeOcrRow,removeOcrColumn,suggestOcrHeader,replaceOcrCell,type OcrReviewState}from'../lib/workbench/operating-ocr-review';
import {operatingImportDate} from '../lib/workbench/operating-import-layout';
import {meituanDailyReview,meituanDailyColumns,meituanDayCandidate} from '../lib/workbench/operating-meituan-ocr';
import {checkDouyinScreenshot,douyinStoreLayout,refineDouyinScreenshot} from '../lib/workbench/operating-douyin-ocr';
import MeituanDayReview,{readMeituanDates} from './operating-meituan-day-review';
import {OriginalCell,nextUncertain} from './operating-ocr-source-cell';
import OperatingOcrCellReview from'./operating-ocr-cell-review';
import {describeScreenshot,reviewPriorities,type PriorityCell,screenshotChecks,screenshotLayoutProblem} from '../lib/workbench/operating-ocr-checks';

const platformLabels=[...new Set(['meituan','douyin'].flatMap(sheet=>operatingFields(sheet as 'meituan'|'douyin').map(f=>f.label)))];
async function prepare(file:File,purpose:'data'|'template'){
 if(file.size>10*1024*1024)throw Error('图片不能超过10MiB');
 const bytes=new Uint8Array(await file.arrayBuffer());ocrImageInfo(bytes,file.name,file.size);
 if(typeof createImageBitmap!=='function')throw Error('此浏览器暂不支持本机识别，请更新浏览器或使用Excel导入');
 const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');
 try{
  if(bitmap.width*bitmap.height>12_000_000)throw Error('图片超过1200万像素，请裁剪表格');
  const size=ocrProcessingSize(bitmap.width,bitmap.height);canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('此浏览器无法处理图片，请换新版浏览器');
  function draw(width:number,height:number){
   canvas.width=width;canvas.height=height;
   context!.fillStyle='#ffffff';context!.fillRect(0,0,width,height);context!.drawImage(bitmap,0,0,width,height);
   const pixels=context!.getImageData(0,0,width,height);
   return {pixels,grid:detectOcrGrid(pixels)};
  }
  let {pixels,grid}=draw(size.width,size.height);
  const singleLine=purpose==='template'&&grid.x.length>=3&&grid.y.length===2&&
   grid.y[1]-grid.y[0]>=size.height*.8&&bitmap.width>=bitmap.height*3;
  if(singleLine&&(grid.y[1]-grid.y[0])*bitmap.height/size.height>=90){
   const scale=Math.min(.65,size.height/bitmap.height);
   ({pixels,grid}=draw(Math.max(1,Math.floor(bitmap.width*scale)),Math.max(1,Math.floor(bitmap.height*scale))));
  }
  pixels.data.set(cleanOcrGrid(pixels,grid));context.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片处理失败')),'image/png'));
  return{bytes:new Uint8Array(await blob.arrayBuffer()),grid,singleLine};
 }finally{bitmap.close();canvas.width=canvas.height=0;}
}
const statuses:Record<string,string>={'loading tesseract core':'正在加载识别引擎','initializing tesseract':'正在准备本机引擎','loading language traineddata':'正在加载中文与数字字库','initializing api':'正在准备中文与数字识别','recognizing text':'正在识别表格文字'};
type Result=ReturnType<typeof ocrTable>&{reviewBounds?:import('../lib/workbench/operating-ocr').OcrBounds};
export default function OperatingScreenshotImport({reviewScope,autoRecognize=false,routing=false,meituanDate,dailyReference,dailySheet,dailyTemplate,dailyStores,douyinStoreDate,onUse,purpose='data',disabled=false,confirmationNote='',confirmationKey='',initialFile,onSelect}:{reviewScope?:string;autoRecognize?:boolean;routing?:boolean;dailyStores?:{id:string;name:string}[];dailySheet?:import('../cloud/company/operating-model').OperatingSheet;dailyTemplate?:import('../cloud/company/operating-model').OperatingTemplate;dailyReference?:string;meituanDate?:string;douyinStoreDate?:string;initialFile?:File;onSelect?:()=>void;onUse:(rows:unknown[][],headerRow:number,source:string,file?:File,reviewEdited?:boolean)=>void;purpose?:'data'|'template';disabled?:boolean;confirmationNote?:string;confirmationKey?:string}){
 const [videoName,setVideoName]=useState('');
 const [locatedCell,setLocatedCell]=useState('');
 const reviewPanel=useRef<HTMLDivElement>(null);
 const [manualReview,setManualReview]=useState(false);
 const input=useRef<HTMLInputElement>(null),job=useRef<ReturnType<typeof startOcrJob>|null>(null),generation=useRef(0),currentUrl=useRef('');
 const[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[working,setWorking]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null),[rows,setRows]=useState<string[][]>([]),[header,setHeader]=useState(0),[checked,setChecked]=useState(false),[over,setOver]=useState(false),[checkedFor,setCheckedFor]=useState('');
 const [revenueMatrix,setRevenueMatrix]=useState(false),[selectedImportDay,setSelectedImportDay]=useState('');
 const normalizedDaily=!!meituanDate&&header===0&&rows[0]?.length===2+meituanDailyColumns.length&&rows[0][0]==='日期'&&rows[0][1]==='范围'&&meituanDailyColumns.every((f,i)=>rows[0][i+2]===f.label);

 const reviewKey=useRef(''),edited=useRef(false);
 const [cacheNotice,setCacheNotice]=useState('');
 function keepReview(next:ScreenshotReview){
  edited.current=true;
  if(!reviewKey.current){if(reviewScope)setCacheNotice('此浏览器未能保留核对修改，请在当前页面继续。');return;}
  try{writeScreenshotReview(localStorage,reviewKey.current,next);setCacheNotice('核对修改已保存在本机，同一张截图再次上传时可继续。');}
  catch{setCacheNotice('本机未能保留这次修改，请在当前页面继续。');}
 }
 function saveEdit(nextRows:string[][],nextHeader:number,nextResult:Result){
  const {rows:original,...metadata}=nextResult;
  keepReview({rows:nextRows,header:nextHeader,metadata,revenueMatrix});
 }
 const [confirmedOrder,setConfirmedOrder]=useState(false);
 const canCheckOrder=!!meituanDate&&!!dailyReference&&!!result?.bounds&&result.bounds.x.length===19&&rows.length===result.rows.length&&rows[header]?.[0]==='日期'&&rows.slice(0,header).some(row=>row.some(cell=>cell.includes('美团')));
 const approvalKey=confirmationKey+'|'+confirmationNote,approved=checked&&checkedFor===approvalKey;
 const[reviewMode,setReviewMode]=useState<'table'|'cell'>('table');
 useEffect(()=>()=>{generation.current++;job.current?.cancel();if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);},[]);
 function reset(){setVideoName('');reviewKey.current='';edited.current=false;setCacheNotice('');setRevenueMatrix(false);setSelectedImportDay('');setConfirmedOrder(false);setEditingPriority(null);setExpandedPriority(false);setLocatedCell('');setManualReview(false);setSourceDay('');setReviewMode('table');generation.current++;job.current?.cancel();job.current=null;if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);currentUrl.current='';setFile(null);setUrl('');setResult(null);setRows([]);setChecked(false);setWorking(false);setError('');setProgress('');}
 async function pick(next:File|undefined){if(!next||disabled||working)return;onSelect?.();reset();const id=generation.current;try{
  if(isReportVideo(next)){
   if(!next.size||next.size>200*1024*1024)throw Error('录屏为空或超过 200 MiB。请截取一小段，或上传表格截图。');
   currentUrl.current=URL.createObjectURL(next);setUrl(currentUrl.current);setVideoName(next.name||'报表录屏');return;
  }
  if(next.size>10*1024*1024)throw Error('图片不能超过10MiB，请裁剪表格区域');const bytes=await next.arrayBuffer();ocrImageInfo(new Uint8Array(bytes),next.name,next.size);
  let saved:ScreenshotReview|undefined,key='';
  if(reviewScope)try{
   const bytesKey=await screenshotReviewKey(reviewScope,bytes);
   const pixelsKey=await screenshotPixelKey(reviewScope,next,()=>id===generation.current).catch(()=>'');
   if(id!==generation.current)return;
   key=pixelsKey||bytesKey;saved=readReviewedImage(localStorage,pixelsKey,bytesKey);
  }catch{/* reading the image still works when storage is unavailable */}
  if(id!==generation.current)return;
  reviewKey.current=key;
  if(saved){autoRead.current=next;edited.current=true;setRows(saved.rows);setHeader(saved.header);setResult({...saved.metadata,rows:saved.rows});setRevenueMatrix(saved.revenueMatrix);setProgress('已恢复这张截图上次核对的内容。请检查剩余提示后继续。');}
  const nextUrl=URL.createObjectURL(next);currentUrl.current=nextUrl;setUrl(nextUrl);setFile(next);}catch(e){if(id===generation.current)setError((e as Error).message);}}
 useEffect(()=>{if(initialFile)void pick(initialFile);},[initialFile]);
 const autoRead=useRef<File|null>(null);
 useEffect(()=>{
  if(autoRecognize&&file&&autoRead.current!==file&&!disabled&&!working){
   autoRead.current=file;void recognize();
  }
 },[autoRecognize,file,disabled,working]);
 async function recognize(){if(!file||working||disabled)return;const id=++generation.current;setEditingPriority(null);setExpandedPriority(false);setWorking(true);setLocatedCell('');setManualReview(false);setError('');setChecked(false);setResult(null);setRows([]);setProgress('正在处理图片…');
  try{
   setSelectedImportDay('');setConfirmedOrder(false);setRevenueMatrix(false);const image=await prepare(file,purpose);if(id!==generation.current)return;
   const base=new URL('/workbench/ocr/v7',window.location.origin).href;
   const next=startOcrJob(image.bytes,{assetBase:base,singleLine:image.singleLine,sparseCells:(purpose==='template'||routing)&&image.grid.x.length>=3,workerFactory:()=>new Worker(base+'/worker.min.js'),onProgress:(status,p)=>{if(id===generation.current)setProgress((statuses[status]||'正在准备识别')+(status==='recognizing text'?' '+Math.round(p*100)+'%':'…'));}});job.current=next;
   const recognized=await next.promise;if(id!==generation.current)return;const value=ocrTable(recognized.words,image.grid);let reviewed=value.rows;const header=douyinStoreDate?douyinStoreLayout(reviewed):-1;
   if((purpose==='template'||routing)&&value.bounds){
    setProgress('正在逐列读取原图表头…');
    const chosen=suggestOcrHeader(reviewed);
    reviewed=await readTemplateHeader(file,reviewed,value.bounds,chosen,()=>id===generation.current,j=>{job.current=j;})??reviewed;
    if(id!==generation.current)return;
   }
   if((routing||dailyTemplate)&&value.bounds){
    setProgress('正在复核原图中漏读的数字…');
    reviewed=await recoverMissingDailyCells(file,reviewed,value.bounds,()=>id===generation.current,j=>{job.current=j;});
    if(id!==generation.current)return;
    value.uncertain=[...new Set([...value.uncertain,...reviewed.flatMap((row,r)=>row.flatMap((v,c)=>v==='待核对'?[r+':'+c]:[]))])];
    value.lowConfidence=value.uncertain.length;
   }
   const routedDouyin=routing&&reviewed.some(row=>row.some(v=>v.trim()==='日期')&&row.some(v=>/核销金额/.test(v))&&row.some(v=>/私信/.test(v))&&row.some(v=>/券数/.test(v)));
   const routedMeituan=routing&&reviewed.some(row=>row.some(v=>/核销/.test(v))&&row.some(v=>/曝光/.test(v))&&(row.some(v=>/咨询|留资/.test(v))||row.some(v=>/自然曝光/.test(v))&&row.some(v=>/cpc.*曝光|推广通曝光/i.test(v))));
   const routedStores=routing&&dailyStores?.length&&reviewed.some(row=>row.some(v=>v.trim()==='日期')&&row.filter(v=>dailyStores.some(s=>s.name===v.trim())).length>=2);
   const sheetToRead=dailySheet??(routedStores?'revenue':routedDouyin?'douyin':routedMeituan?'meituan':undefined);
   if(dailyReference&&sheetToRead&&value.bounds){
    setProgress('正在按原图逐格核对日期、表头和数值…');
    const daily=await readDailyGrid(file,reviewed,value.bounds,dailyReference,sheetToRead,dailyTemplate,dailyStores,()=>id===generation.current,j=>{job.current=j;});
    if(id!==generation.current)return;
    if(daily&&dailySheet==='meituan'&&meituanDate&&!('revenueMatrix' in daily)){
     const review=meituanDailyReview(daily.rows,daily.header,[...value.uncertain,...daily.uncertain]);
     if(review){
      const {matrix,sourceRows,sourceColumns,uncertain}=review;
      setResult({...value,rows:matrix,bounds:undefined,reviewBounds:{...value.bounds,sourceRows,sourceColumns},uncertain,lowConfidence:uncertain.length});setRows(matrix);setHeader(0);
      setProgress('已读取 '+(matrix.length-1)+' 个业务日期、11 个填报指标。月度和周合计行已排除。'+(daily.checkedDates?.length?'已用原表星期和相邻日期交叉核对：'+daily.checkedDates.join('、')+'。':'')+(uncertain.length?uncertain.length+' 处读数需要对照原图核对。':'')+(daily.discrepancies.length?'请核对月度合计：'+daily.discrepancies.join('、')+'。':''));return;
     }
    }
    if(daily){const revenue='revenueMatrix' in daily;setRevenueMatrix(revenue);const uncertain=revenue?daily.uncertain:[...new Set([...value.uncertain,...daily.uncertain])];setResult({...value,rows:daily.rows,reviewBounds:revenue?{...value.bounds,sourceRows:daily.sourceRows}:undefined,uncertain,lowConfidence:uncertain.length});setRows(daily.rows);setHeader(daily.header);setProgress(revenue&&dailySheet==='targets'?(daily.discrepancies.length?'请核对月目标行与原图合计。':'已读到各门店月目标，请核对月份和金额。'):'已读到 '+daily.days+' 个业务日期。原图只写月日时按 '+dailyReference.slice(0,4)+' 年预览。'+(daily.discrepancies.length?(revenue?'以下行请与原图合计核对：':'日明细与小计或月度合计待核对：')+daily.discrepancies.join('、')+'。':'请核对日期和金额。'));return;}
   }
   if(header>=0&&value.bounds&&douyinStoreDate){setProgress('正在逐格读取抖音门店券数与金额…');reviewed=await refineDouyinScreenshot(file,reviewed,value.bounds,header,douyinStoreDate,()=>id===generation.current,j=>{job.current=j;})??reviewed;}
   if(id!==generation.current)return;setResult(value);setRows(reviewed);setHeader(header>=0?header:suggestOcrHeader(reviewed));setProgress(dailyReference&&dailySheet==='meituan'?'未能可靠定位美团日表的日期和表头。请对照原图修正，或只截表格后重试；有原 Excel 也可直接导入。':'已完成表格识别，请查看下方识别结果。');
  }catch(e){if(id===generation.current){setError((e as Error).message);setProgress('');}}
  finally{if(id===generation.current){job.current=null;setWorking(false);}}
 }
 function change(next:string[][],structural=true){setEditingPriority(null);setLocatedCell('');setConfirmedOrder(false);setRows(next);setChecked(false);setError('');if(result){const updated=structural?{...result,uncertain:[],lowConfidence:0,bounds:undefined,reviewBounds:undefined,structured:(next[0]?.length||0)>=2}:result;saveEdit(next,header,updated);setResult(updated);}if(structural){setProgress('已重新分列表格，原识别风险标记已清除，请逐格核对');}}
 const checks=React.useMemo(()=>screenshotChecks(rows,header,dailyReference,result?.uncertain,revenueMatrix),[rows,header,dailyReference,result?.uncertain,revenueMatrix]);
 const priorities=React.useMemo(()=>reviewPriorities(rows,header,result?.uncertain||[],checks,purpose==='template'&&!routing,dailyTemplate?dailyTemplate.fields.map(f=>f.label):platformLabels),[rows,header,result,checks,purpose,routing,dailyTemplate]);
 const [editingPriority,setEditingPriority]=useState<PriorityCell|null>(null);
 const [expandedPriority,setExpandedPriority]=useState(false);
 const visiblePriority=expandedPriority?priorities.slice():priorities.slice(0,3);
 if(editingPriority&&!visiblePriority.some(p=>p.row===editingPriority.row&&p.column===editingPriority.column))visiblePriority.unshift(editingPriority);
 const layoutProblem=React.useMemo(()=>result?screenshotLayoutProblem(rows,header,result.structured,result.uncertain):'',[result,rows,header]);
 const description=React.useMemo(()=>result?describeScreenshot(rows,header,result.structured,result.uncertain):null,[result,rows,header]);
 const firstProblem=React.useMemo(()=>{
  for(let r=header+1;r<rows.length;r++){
   const c=rows[r].findIndex((v,col)=>v==='待核对'||v==='日期待核对'||(/^\d{5,7}$/.test(v)&&/^(?:业务|统计|数据|发生|成交|填报)?日期$/.test(rows[header]?.[col]?.trim())));
   if(c>=0)return {row:r,column:c,name:rows[header]?.[c]||'第 '+(c+1)+' 列'};
  }
  return null;
 },[rows,header]);
 const mobileTarget=priorities[0]||firstProblem||checks.suspects[0]||checks.totals[0];
 function finishCell(){
  setLocatedCell('');
  const check=reviewPanel.current?.querySelector<HTMLInputElement>('.op-ocr-check input');
  check?.focus({preventScroll:true});check?.scrollIntoView({block:'center',inline:'nearest'});
 }
 function locateCell(row:number,column:number){
  setLocatedCell(row+':'+column);
  setReviewMode('table');
  const details=reviewPanel.current?.querySelector<HTMLDetailsElement>('.op-full-grid');if(details)details.open=true;
  requestAnimationFrame(()=>{const cell=reviewPanel.current?.querySelector<HTMLInputElement>('[aria-label="截图第'+(row+1)+'行第'+(column+1)+'列"]');cell?.focus();cell?.select();});
 }
 function use(){try{
  if(layoutProblem)throw Error(layoutProblem);
  if(checks.errors.length)throw Error(checks.errors[0]);
  const unresolved=rows.findIndex(row=>row.includes('待核对'));
  if(unresolved>=0)throw Error('第 '+(unresolved+1)+' 行第 '+(rows[unresolved].indexOf('待核对')+1)+' 列有字迹但数字未读清。请对照原图补上数字，确为空白可清空该格。');
  const matrix=reviewedOcrRows(rows,header,approved,purpose);if(revenueMatrix)checkRevenueOcrTotals(matrix,header);if(douyinStoreDate)checkDouyinScreenshot(matrix,header);if(normalizedDaily&&selectedImportDay){
  const selected=matrix.slice(1).filter(row=>row[0]===selectedImportDay);
  if(selected.length!==1)throw Error('这个日期已变化或重复，请重新选择业务日期');
  onUse([matrix[0],selected[0]],0,file?.name||'报表截图');
 }else onUse(matrix,header,file?.name||'报表截图',file??undefined,edited.current);setChecked(false);setError('');if(purpose==='template'||routing)reset();}catch(e){setError((e as Error).message);}}
 function onUseDay(matrix:unknown[][],h:number){onUse(matrix,h,file?.name||'报表截图');setError('');}
 function edit(r:number,c:number,value:string){
  reviewEdit(state=>{
   const next=replaceOcrCell(state,r,c,value);
   if(value!==state.rows[r][c])next.uncertain=next.uncertain.filter(key=>key!==r+':'+c);
   return next;
  });
 }
 function reviewEdit(edit:(state:OcrReviewState)=>OcrReviewState){try{const next=edit({rows,header,uncertain:result?.uncertain||[],checked:approved});if(next.rows.length!==rows.length||next.rows[0]?.length!==rows[0]?.length){setLocatedCell('');setEditingPriority(null);}setRows(next.rows);setHeader(next.header);setChecked(false);setError('');if(result){const sameShape=next.rows.length===rows.length&&next.rows[0]?.length===rows[0]?.length;
  const updated={...result,bounds:sameShape?result.bounds:undefined,reviewBounds:sameShape?result.reviewBounds:undefined,uncertain:next.uncertain,lowConfidence:next.uncertain.length};
  saveEdit(next.rows,next.header,updated);setResult(updated);}}catch(e){setError((e as Error).message);}}
 const columns=rows[0]?.length||0;
 const [activeRow,activeColumn]=locatedCell.split(':').map(Number);
 const following=locatedCell&&result?nextUncertain(result.uncertain,activeRow,activeColumn):undefined;
 const sourceBounds=result?.reviewBounds??(revenueMatrix?undefined:result?.bounds);
 const [sourceDay,setSourceDay]=useState('');
 const availableDays=React.useMemo(()=>{const days=new Set<string>();for(const row of rows)if((!dailyReference||canCheckOrder&&confirmedOrder)&&row.length===18){try{days.add(operatingImportDate(row[0]));}catch{}}return [...days].sort();},[rows,dailyReference,canCheckOrder,confirmedOrder]);
 async function reviewEveryDay(){
  if(!result?.bounds||working||disabled||!availableDays.length)return;
  const id=++generation.current;setWorking(true);setChecked(false);setError('');setProgress('正在按原图日期逐格读取…');
  try{
   const values=await readMeituanDates(rows,result.bounds,url,availableDays,()=>id===generation.current,next=>{job.current=next;});if(id!==generation.current||!values)return;
   const matrix=[['日期','范围',...meituanDailyColumns.map(f=>f.label)],...values.map((cells,i)=>[availableDays[i],'全平台',...cells])];
   const uncertain=matrix.flatMap((row,r)=>r?row.flatMap((v,c)=>v===''?[r+':'+c]:[]):[]);
   setRows(matrix);setHeader(0);setReviewMode('table');setResult({...result,rows:matrix,bounds:undefined,uncertain,lowConfidence:uncertain.length});
   setProgress('已按原图读取 '+values.length+' 个业务日期。请核对下方日期与数字，留空的格子可对照原图补填。');
  }catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current){job.current=null;setWorking(false);}}
 }
 const selectedDay=availableDays.includes(sourceDay)?sourceDay:meituanDate&&availableDays.includes(meituanDate)?meituanDate:availableDays.at(-1)||meituanDate;
 const dayReview=!!meituanDate&&!!selectedDay&&!!result?.bounds&&!!meituanDayCandidate(rows,selectedDay);
 return <section className={'op-screenshot '+(over?'dragging':'')} aria-label="截图识别" onDragOver={e=>{e.preventDefault();e.stopPropagation();if(!working&&!disabled)setOver(true);}} onDragLeave={e=>{e.stopPropagation();setOver(false);}} onDrop={e=>{e.preventDefault();e.stopPropagation();setOver(false);if(e.dataTransfer.files.length!==1){setError('每次请拖入一张截图或一段录屏');return;}void pick(e.dataTransfer.files[0]);}}>
  <div className="op-file-import-title"><ScanLine size={22}/><div><strong>截图识别</strong><p>支持 PNG、JPG、WebP（10 MiB 以内），也可从本地录屏选一帧。</p></div><button type="button" className="op-button" disabled={disabled||working} onClick={()=>input.current?.click()}><Upload size={16}/>选择截图或录屏</button><input ref={input} hidden type="file" accept={reportMediaAccept} aria-label="上传报表截图" onChange={e=>{void pick(e.target.files?.[0]);e.target.value='';}}/></div>
  {videoName&&<OperatingVideoFrame key={url} url={url} name={videoName} disabled={disabled} onClear={reset} onFrame={image=>void pick(image)}/>}
  {file&&<><div className="op-panel-title"><strong>{file.name}</strong><button type="button" className="op-close" disabled={disabled} aria-label="清除当前截图" onClick={reset}><X size={17}/></button></div><details className="op-ocr-source" open={!result}><summary>对照原截图</summary><a href={url} target="_blank" rel="noreferrer">放大原图（新标签页）</a><img src={url} alt="待核对的原始报表截图"/></details><div className="op-ocr-actions">{mobileTarget&&result&&!layoutProblem&&!working&&<button type="button" className="op-button op-mobile-review" disabled={disabled} onClick={()=>locateCell(mobileTarget.row,mobileTarget.column)}>核对{checks.dateColumn>=0?' '+rows[mobileTarget.row][checks.dateColumn]:('第 '+(mobileTarget.row+1)+' 行')} · {rows[header][mobileTarget.column]} · {rows[mobileTarget.row][mobileTarget.column]}</button>}<button type="button" className="op-button" disabled={disabled||working} onClick={()=>void recognize()}><ImagePlus size={16}/>{result?'重新识别':'开始本机识别'}</button>{working&&<button type="button" className="op-button" onClick={()=>{generation.current++;job.current?.cancel();job.current=null;setWorking(false);setProgress('已取消，可重新识别');}}>取消识别</button>}<p className="op-muted" role="status" aria-live="polite" data-import-reading={working||undefined}>{(layoutProblem?'识别需要处理':progress)||'首次识别需加载字库，速度取决于设备和网络；关闭面板会停止识别。'}</p></div></>}
  {revenueMatrix&&edited.current&&result&&<button type="button" className="op-button" disabled={disabled||working} onClick={()=>{try{const next=recalculateRevenueTotals(rows,header);change(next,false);setProgress('已按核对后的逐店明细更新行合计和列合计，请核对后继续。');}catch(e){setError((e as Error).message);}}}>按已核对的门店明细重算合计</button>}
  {cacheNotice&&<p role="status" className="op-muted">{cacheNotice}</p>}
  {description&&<section aria-label="这张图读到了什么" className="op-note">
   <strong>{revenueMatrix?'按门店和日期排列的业绩表':description.type}</strong>
   {layoutProblem?<p>{description.anchors.length?'可辨认的文字：'+description.anchors.slice(0,5).join('、')+'。':''}暂不能提取明细。{description.dashboard?'请只截门店明细那块，保留列名、日期和完整数据行。':!result?.structured?'画面中的文字无法可靠对应到每一行、每一列。':'请先核对表头。'}</p>:
    <><p>{description.headers.length?'已读到的列名：'+description.headers.slice(0,5).join('、')+(description.headers.length>5?'等 '+description.headers.length+' 项。':'。'):'列名需要对照原图确认。'}</p>
    <p>{priorities.length?'优先查看下面 '+Math.min(3,priorities.length)+' 处，原因和原图放在一起。':'可以继续核对预览。请确认业务日期、单位和关键金额。'}</p></>}
  </section>}
  {layoutProblem&&<div className="co-warning" role="alert"><strong>截图未能生成可用表格</strong><p>{layoutProblem}</p><button type="button" className="op-button" disabled={disabled} onClick={()=>input.current?.click()}>更换截图</button> <button type="button" className="op-button" disabled={disabled} onClick={()=>setManualReview(v=>!v)}>{manualReview?'收起手动整理':'手动选择表头或整理分列'}</button></div>}
  {result&&rows.length>0&&(!layoutProblem||manualReview)&&<div className="op-ocr-review" ref={reviewPanel}>
   {visiblePriority.length>0&&<section className="op-note" aria-label="优先核对"><strong>优先核对</strong><p>按日期、合计差额和数字字迹排序。对照旁边的原图直接改，核对后可进入预览。</p>{visiblePriority.map(cell=>{
    const {row,column,reason}=cell,label=rows[header]?.[column]||'第 '+(column+1)+' 列',day=checks.dateColumn>=0?rows[row]?.[checks.dateColumn]:'';
    return <div key={row+':'+column} className="op-priority-cell"><label><span>{day&&row!==header?day:'第 '+(row+1)+' 行'} · {label}</span><input aria-label={'优先核对第'+(row+1)+'行第'+(column+1)+'列'} value={rows[row]?.[column]??''} disabled={disabled} maxLength={200} onFocus={()=>setEditingPriority(cell)} onChange={e=>edit(row,column,e.target.value)}/><small>{reason}</small></label>{cell.suggested&&<button type="button" className="op-button" disabled={disabled} onClick={()=>edit(row,column,cell.suggested!)}>采用「{cell.suggested}」</button>}<OriginalCell url={url} bounds={sourceBounds} row={row} column={column}/></div>;
   })}{priorities.length>3&&<button type="button" className="op-button" onClick={()=>setExpandedPriority(v=>!v)}>{expandedPriority?'收起其他候选':'再看其余 '+(priorities.length-3)+' 处'}</button>}</section>}
   {firstProblem&&<div className="co-warning" role="alert"><strong>第 {firstProblem.row+1} 行 · {firstProblem.name}</strong><p>这格有字迹，但未能读出有效的{firstProblem.name.includes('日期')?'日期':'数值'}。请对照上方原图修正。</p><button type="button" className="op-button" onClick={()=>locateCell(firstProblem.row,firstProblem.column)}>定位到这格</button></div>}<p className="op-note">这是待核对的候选表格。{result.lowConfidence?'橙色标记共 '+result.lowConfidence+' 格，包含表头和说明。可展开整表查看；':''}{purpose==='template'?'请核对表头、字段单位和分行名称。用于生成模板时可以只提供表头。':'请检查每个数字、小数点、表头、单位和日期。空白保持空白，不自动填0。'}</p>{!result.structured&&<p className="co-error">未找到清晰网格，当前仅按文字行保留。请用下面的制表符编辑区整理成列，或换一张带完整表格线的清晰截图。</p>}{result.inferredBorders&&<p className="op-note">截图外侧边框不完整，已按文字位置补候选边列，请重点核对首列和末列。</p>}
   {canCheckOrder&&<details className="op-note"><summary>部分表头不清楚 · 对照原图确认列序</summary><p>依次核对填报列：{meituanDailyColumns.map(f=>'第'+(f.index+1)+'列 '+f.label).join('、')}。如有不同，请直接修正下方表头。</p><label><input type="checkbox" checked={confirmedOrder} onChange={e=>setConfirmedOrder(e.target.checked)}/> 原图的列序与上述清单一致，按此列序逐格读取</label></details>}
   {normalizedDaily&&rows.length>2&&<label>要填报的日期<select aria-label="选择截图填报日期" value={selectedImportDay} disabled={working||disabled} onChange={e=>{setSelectedImportDay(e.target.value);setChecked(false);}}><option value="">全部 {rows.length-1} 个业务日期</option>{rows.slice(1).map((r,i)=><option key={i} value={r[0]}>{r[0]}</option>)}</select></label>}
   {meituanDate&&availableDays.length>1&&result.bounds&&<button type="button" className="op-button" disabled={disabled||working} onClick={()=>void reviewEveryDay()}>读取图中全部 {availableDays.length} 个业务日期</button>}
   {meituanDate&&availableDays.length>0&&<label>按截图里的日期填报<select aria-label="截图业务日期" value={selectedDay} onChange={e=>setSourceDay(e.target.value)}>{availableDays.map(d=><option key={d}>{d}</option>)}</select><small>当前页面日期 {meituanDate}，可选择图中其他日期。</small></label>}
   {meituanDate&&selectedDay&&result.bounds&&<MeituanDayReview key={url+selectedDay} date={selectedDay} url={url} bounds={result.bounds} rows={rows} disabled={disabled} onUse={onUseDay}/>}
   <details open={!dayReview&&!priorities.length} key={String(dayReview)} className="op-full-grid"><summary>{dayReview?'其他表格格式 / 查看整张识别表':'整张表格核对'}</summary><div className="op-ocr-actions"><label>表头行<select aria-label="截图表头行" value={header} onChange={e=>{setEditingPriority(null);setHeader(Number(e.target.value));saveEdit(rows,Number(e.target.value),result);setChecked(false);}}>{rows.map((_,i)=><option key={i} value={i}>第{i+1}行</option>)}</select></label><button type="button" className="op-button" disabled={disabled||columns>=40} onClick={()=>change(rows.map(row=>[...row,'']),false)}><Plus size={15}/>增加列</button><button type="button" className="op-button" disabled={disabled||rows.length>=100} onClick={()=>change([...rows,Array.from({length:columns},()=> '')],false)}><Plus size={15}/>增加行</button><button type="button" className="op-button" disabled={disabled||header+1>=rows.length} onClick={()=>reviewEdit(mergeOcrHeaders)}>合并本行与下一行表头</button><span className="op-muted">{rows.length}行 · {columns}列 · {header+1}行作表头</span></div>
   <div className="op-ocr-mode" role="group" aria-label="截图核对方式"><button type="button" disabled={disabled} aria-pressed={reviewMode==='table'} onClick={()=>setReviewMode('table')}>表格核对</button><button type="button" disabled={disabled} aria-pressed={reviewMode==='cell'} onClick={()=>setReviewMode('cell')}>逐格核对</button></div>
   {checks.errors.length>0&&<aside className="co-warning" aria-label="日期待核对"><ul>{checks.errors.map(s=><li key={s}>{s}</li>)}</ul></aside>}
   {reviewMode==='cell'&&<OperatingOcrCellReview url={url} bounds={sourceBounds} rows={rows} header={header} uncertain={result.uncertain} disabled={disabled} onEdit={edit}/>}
   <div className="op-ocr-grid" hidden={reviewMode!=='table'} tabIndex={0} aria-label="可编辑截图识别结果"><table><thead><tr><th>行</th>{Array.from({length:columns},(_,c)=><th key={c}>{normalizedDaily?rows[0][c]:'第'+(c+1)+'列'} <button type="button" disabled={disabled||columns<=1} aria-label={'删除截图第'+(c+1)+'列'} onClick={()=>reviewEdit(state=>removeOcrColumn(state,c))}><Trash2 size={13}/></button></th>)}<th>操作</th></tr></thead><tbody>{rows.map((row,r)=><tr key={r} className={r===header?'op-ocr-header':''}><th>{r+1}{r===header?' 表头':''}</th>{row.map((cell,c)=><td key={c} className={result.uncertain.includes(r+':'+c)?'uncertain':''}><input onFocus={()=>setLocatedCell(r+':'+c)} onClick={()=>setLocatedCell(r+':'+c)} aria-label={'截图第'+(r+1)+'行第'+(c+1)+'列'} title={result.uncertain.includes(r+':'+c)?'原识别把握较低，请核对':'请对照截图核对'} value={cell} disabled={disabled} maxLength={200} onChange={e=>edit(r,c,e.target.value)}/>{locatedCell===r+':'+c&&<><OriginalCell url={url} bounds={sourceBounds} row={r} column={c}/>{following&&<button type="button" className="op-button" onClick={()=>locateCell(following[0],following[1])}>下一处待核对</button>}<button type="button" className="op-mobile-review" onClick={finishCell}>完成并返回核对</button></>}</td>)}<td><button type="button" disabled={disabled||rows.length<=1} aria-label={'删除截图第'+(r+1)+'行'} onClick={()=>reviewEdit(state=>removeOcrRow(state,r))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>
   <details><summary>用制表符整理表头和分列</summary><p className="op-muted">列之间用Tab，行之间换行。保留日期/累计标题供后续核验；复杂合并表头请自行整理成一行字段名，不要把多日累计标作单日。</p><textarea aria-label="截图识别制表符编辑" rows={6} value={rows.map(row=>row.join('\t')).join('\n')} onChange={e=>{const lines=e.target.value.split('\n').map(line=>line.split('\t'));if(lines.length>100||lines.some(row=>row.length>40||row.some(cell=>cell.length>200))){setError('最多100行40列，每格200字');return;}const width=Math.max(...lines.map(row=>row.length));change(lines.map(row=>[...row,...Array.from({length:width-row.length},()=> '')]));}}/></details>
   </details>
   {checks.warnings.length>0?<aside className="co-warning" aria-label="原表核对"><strong>确认前，请核对原图</strong>{checks.warnings.length>0&&<><ul>{checks.warnings.map((s,i)=><li key={i}>{s} <button type="button" className="op-button" onClick={()=>locateCell(checks.totals[i].row,checks.totals[i].column)}>查看该列合计</button></li>)}</ul><small>合计差额只能定位到这一列。请核对可见明细和原图合计。</small></>}</aside>
    :(purpose==='data'||(routing&&rows.length>header+1))&&<p className="op-note" aria-label="截图核对提醒"><strong>确认前看一眼原图。</strong> 有合计时核对合计；没有合计时，重点核对关键数字、小数点和单位。</p>}
   <label className="op-ocr-check"><input type="checkbox" disabled={disabled} checked={approved} onChange={e=>{setCheckedFor(approvalKey);setChecked(e.target.checked);}}/><span>{purpose==='template'?'我已对照原图，核对表头、字段单位和分行名称':'我已核对提示项和关键数据，继续查看填报预览'}{confirmationNote&&<strong>{confirmationNote}</strong>}</span></label><p className="op-muted">{purpose==='template'?'下一步只生成模板候选，仍需确认字段口径。':'下一步进入原填报预览，不会直接保存或确认。'}截图原图不进入云端备份。</p><button type="button" className="co-primary" disabled={disabled||!approved||!!layoutProblem||!!firstProblem||!!checks.errors.length} onClick={use}>{routing?'识别这张表的用途':purpose==='template'?'用已核对截图生成候选字段':'读取到填报预览'}</button>
  </div>}
  {error&&<p className="co-error" role="alert">{error}</p>}
 </section>;
}
