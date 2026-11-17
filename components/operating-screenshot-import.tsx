'use client';
import React,{useEffect,useRef,useState}from'react';
import{ImagePlus,ScanLine,Upload,X,Plus,Trash2}from'lucide-react';
import{cleanOcrGrid,detectOcrGrid,ocrImageInfo,ocrProcessingSize,ocrTable,reviewedOcrRows}from'../lib/workbench/operating-ocr';
import {checkRevenueOcrTotals} from '../lib/workbench/operating-revenue-ocr';
import {readDailyGrid} from '../lib/workbench/operating-daily-grid';
import{startOcrJob}from'../lib/workbench/operating-ocr-job';
import{mergeOcrHeaders,removeOcrRow,removeOcrColumn,suggestOcrHeader,replaceOcrCell,type OcrReviewState}from'../lib/workbench/operating-ocr-review';
import {operatingImportDate} from '../lib/workbench/operating-import-layout';
import {meituanDailyPreview,meituanDailyColumns,meituanDayCandidate} from '../lib/workbench/operating-meituan-ocr';
import {checkDouyinScreenshot,douyinStoreLayout,refineDouyinScreenshot} from '../lib/workbench/operating-douyin-ocr';
import MeituanDayReview,{readMeituanDates} from './operating-meituan-day-review';
import OperatingOcrCellReview from'./operating-ocr-cell-review';

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
type Result=ReturnType<typeof ocrTable>;
export default function OperatingScreenshotImport({meituanDate,dailyReference,dailySheet,dailyTemplate,dailyStores,douyinStoreDate,onUse,purpose='data',disabled=false,confirmationNote='',confirmationKey='',initialFile,onSelect}:{dailyStores?:{id:string;name:string}[];dailySheet?:import('../cloud/company/operating-model').OperatingSheet;dailyTemplate?:import('../cloud/company/operating-model').OperatingTemplate;dailyReference?:string;meituanDate?:string;douyinStoreDate?:string;initialFile?:File;onSelect?:()=>void;onUse:(rows:unknown[][],headerRow:number,source:string)=>void;purpose?:'data'|'template';disabled?:boolean;confirmationNote?:string;confirmationKey?:string}){
 const input=useRef<HTMLInputElement>(null),job=useRef<ReturnType<typeof startOcrJob>|null>(null),generation=useRef(0),currentUrl=useRef('');
 const[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[working,setWorking]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null),[rows,setRows]=useState<string[][]>([]),[header,setHeader]=useState(0),[checked,setChecked]=useState(false),[over,setOver]=useState(false),[checkedFor,setCheckedFor]=useState('');
 const [revenueMatrix,setRevenueMatrix]=useState(false),[selectedImportDay,setSelectedImportDay]=useState('');
 const normalizedDaily=!!meituanDate&&header===0&&rows[0]?.length===2+meituanDailyColumns.length&&rows[0][0]==='日期'&&rows[0][1]==='范围'&&meituanDailyColumns.every((f,i)=>rows[0][i+2]===f.label);

 const [confirmedOrder,setConfirmedOrder]=useState(false);
 const canCheckOrder=!!meituanDate&&!!dailyReference&&!!result?.bounds&&result.bounds.x.length===19&&rows.length===result.rows.length&&rows[header]?.[0]==='日期'&&rows.slice(0,header).some(row=>row.some(cell=>cell.includes('美团')));
 const approvalKey=confirmationKey+'|'+confirmationNote,approved=checked&&checkedFor===approvalKey;
 const[reviewMode,setReviewMode]=useState<'table'|'cell'>('table');
 useEffect(()=>()=>{generation.current++;job.current?.cancel();if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);},[]);
 function reset(){setSourceDay('');setReviewMode('table');generation.current++;job.current?.cancel();job.current=null;if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);currentUrl.current='';setFile(null);setUrl('');setResult(null);setRows([]);setChecked(false);setWorking(false);setError('');setProgress('');}
 async function pick(next:File|undefined){if(!next||disabled||working)return;onSelect?.();reset();const id=generation.current;try{if(next.size>10*1024*1024)throw Error('图片不能超过10MiB，请裁剪表格区域');ocrImageInfo(new Uint8Array(await next.arrayBuffer()),next.name,next.size);if(id!==generation.current)return;const nextUrl=URL.createObjectURL(next);currentUrl.current=nextUrl;setUrl(nextUrl);setFile(next);}catch(e){if(id===generation.current)setError((e as Error).message);}}
 useEffect(()=>{if(initialFile)void pick(initialFile);},[initialFile]);
 async function recognize(){if(!file||working||disabled)return;const id=++generation.current;setWorking(true);setError('');setChecked(false);setResult(null);setRows([]);setProgress('正在处理图片…');
  try{
   setSelectedImportDay('');setConfirmedOrder(false);setRevenueMatrix(false);const image=await prepare(file,purpose);if(id!==generation.current)return;
   const base=new URL('/workbench/ocr/v7',window.location.origin).href;
   const next=startOcrJob(image.bytes,{assetBase:base,singleLine:image.singleLine,sparseCells:purpose==='template'&&image.grid.x.length>=3,workerFactory:()=>new Worker(base+'/worker.min.js'),onProgress:(status,p)=>{if(id===generation.current)setProgress((statuses[status]||'正在准备识别')+(status==='recognizing text'?' '+Math.round(p*100)+'%':'…'));}});job.current=next;
   const recognized=await next.promise;if(id!==generation.current)return;const value=ocrTable(recognized.words,image.grid);let reviewed=value.rows;const header=douyinStoreDate?douyinStoreLayout(reviewed):-1;
   if(dailyReference&&dailySheet&&value.bounds){
    setProgress('正在按原图逐格核对日期、表头和数值…');
    const daily=await readDailyGrid(file,value.rows,value.bounds,dailyReference,dailySheet,dailyTemplate,dailyStores,()=>id===generation.current,j=>{job.current=j;});
    if(id!==generation.current)return;
    if(daily&&dailySheet==='meituan'&&meituanDate&&!('revenueMatrix' in daily)){
     const matrix=meituanDailyPreview(daily.rows,daily.header);
     if(matrix){
      const uncertain=matrix.flatMap((row,r)=>r?row.flatMap((v,c)=>v===''?[r+':'+c]:[]):[]);
      setResult({...value,rows:matrix,bounds:undefined,uncertain,lowConfidence:uncertain.length});setRows(matrix);setHeader(0);
      setProgress('已读取 '+(matrix.length-1)+' 个业务日期、11 个填报指标。月度和周合计行已排除。'+(daily.checkedDates?.length?'已用原表星期和相邻日期交叉核对：'+daily.checkedDates.join('、')+'。':'')+(uncertain.length?uncertain.length+' 个数字需要对照原图补填。':'')+(daily.discrepancies.length?'请核对月度合计：'+daily.discrepancies.join('、')+'。':''));return;
     }
    }
    if(daily){const revenue='revenueMatrix' in daily;setRevenueMatrix(revenue);const uncertain=revenue?daily.uncertain:[...new Set([...value.uncertain,...daily.uncertain])];setResult({...value,rows:daily.rows,uncertain,lowConfidence:uncertain.length});setRows(daily.rows);setHeader(daily.header);setProgress(revenue&&dailySheet==='targets'?(daily.discrepancies.length?'请核对月目标行与原图合计。':'已读到各门店月目标，请核对月份和金额。'):'已读到 '+daily.days+' 个业务日期。原图只写月日时按 '+dailyReference.slice(0,4)+' 年预览。'+(daily.discrepancies.length?(revenue?'以下行请与原图合计核对：':'日明细与月度行待核对：')+daily.discrepancies.join('、')+'。':'请核对日期和金额。'));return;}
   }
   if(header>=0&&value.bounds&&douyinStoreDate){setProgress('正在逐格读取抖音门店券数与金额…');reviewed=await refineDouyinScreenshot(file,reviewed,value.bounds,header,douyinStoreDate,()=>id===generation.current,j=>{job.current=j;})??reviewed;}
   if(id!==generation.current)return;setResult(value);setRows(reviewed);setHeader(header>=0?header:suggestOcrHeader(reviewed));setProgress(dailyReference&&dailySheet==='meituan'?'未能可靠定位美团日表的日期和表头。请对照原图修正，或只截表格后重试；有原 Excel 也可直接导入。':'识别完成，请逐格核对');
  }catch(e){if(id===generation.current){setError((e as Error).message);setProgress('');}}
  finally{if(id===generation.current){job.current=null;setWorking(false);}}
 }
 function change(next:string[][],structural=true){setConfirmedOrder(false);setRows(next);setChecked(false);setError('');if(structural){setResult(old=>old?{...old,uncertain:[],lowConfidence:0}:old);setProgress('已重新分列表格，原识别风险标记已清除，请逐格核对');}}
 function use(){try{const matrix=reviewedOcrRows(rows,header,approved,purpose);if(revenueMatrix)checkRevenueOcrTotals(matrix,header);if(douyinStoreDate)checkDouyinScreenshot(matrix,header);if(normalizedDaily&&selectedImportDay){
  const selected=matrix.slice(1).filter(row=>row[0]===selectedImportDay);
  if(selected.length!==1)throw Error('这个日期已变化或重复，请重新选择业务日期');
  onUse([matrix[0],selected[0]],0,file?.name||'报表截图');
 }else onUse(matrix,header,file?.name||'报表截图');setChecked(false);setError('');if(purpose==='template')reset();}catch(e){setError((e as Error).message);}}
 function onUseDay(matrix:unknown[][],h:number){onUse(matrix,h,file?.name||'报表截图');setError('');}
 function edit(r:number,c:number,value:string){reviewEdit(state=>replaceOcrCell(state,r,c,value));}
 function reviewEdit(edit:(state:OcrReviewState)=>OcrReviewState){try{const next=edit({rows,header,uncertain:result?.uncertain||[],checked:approved});setRows(next.rows);setHeader(next.header);setChecked(false);setError('');setResult(old=>old?{...old,uncertain:next.uncertain,lowConfidence:next.uncertain.length}:old);}catch(e){setError((e as Error).message);}}
 const columns=rows[0]?.length||0;
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
 return <section className={'op-screenshot '+(over?'dragging':'')} aria-label="截图识别" onDragOver={e=>{e.preventDefault();e.stopPropagation();if(!working&&!disabled)setOver(true);}} onDragLeave={e=>{e.stopPropagation();setOver(false);}} onDrop={e=>{e.preventDefault();e.stopPropagation();setOver(false);if(e.dataTransfer.files.length!==1){setError('每次请拖入一张截图');return;}void pick(e.dataTransfer.files[0]);}}>
  <div className="op-file-import-title"><ScanLine size={22}/><div><strong>截图识别</strong><p>图片在本设备识别，不上传。PNG / JPG / WebP，最大10MiB；先裁剪清晰表格区域。</p></div><button type="button" className="op-button" disabled={disabled||working} onClick={()=>input.current?.click()}><Upload size={16}/>选择截图</button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="上传报表截图" onChange={e=>{void pick(e.target.files?.[0]);e.target.value='';}}/></div>
  {file&&<><div className="op-panel-title"><strong>{file.name}</strong><button type="button" className="op-close" disabled={disabled} aria-label="清除当前截图" onClick={reset}><X size={17}/></button></div><details className="op-ocr-source" open><summary>对照原截图</summary><a href={url} target="_blank" rel="noreferrer">放大原图（新标签页）</a><img src={url} alt="待核对的原始报表截图"/></details><div className="op-ocr-actions"><button type="button" className="op-button" disabled={disabled||working} onClick={()=>void recognize()}><ImagePlus size={16}/>{result?'重新识别':'开始本机识别'}</button>{working&&<button type="button" className="op-button" onClick={()=>{generation.current++;job.current?.cancel();job.current=null;setWorking(false);setProgress('已取消，可重新识别');}}>取消识别</button>}<p className="op-muted" role="status" aria-live="polite" data-import-reading={working||undefined}>{progress||'首次识别需加载字库，速度取决于设备和网络；关闭面板会停止识别。'}</p></div></>}
  {result&&rows.length>0&&<div className="op-ocr-review"><p className="op-note">这是待核对的候选表格。{result.lowConfidence?'有 '+result.lowConfidence+' 格识别把握较低，已用橙色提示；':''}{purpose==='template'?'请核对表头、字段单位和分行名称。用于生成模板时可以只提供表头。':'请检查每个数字、小数点、表头、单位和日期。空白保持空白，不自动填0。'}</p>{!result.structured&&<p className="co-error">未找到清晰网格，当前仅按文字行保留。请用下面的制表符编辑区整理成列，或换一张带完整表格线的清晰截图。</p>}{result.inferredBorders&&<p className="op-note">截图外侧边框不完整，已按文字位置补候选边列，请重点核对首列和末列。</p>}
   {canCheckOrder&&<details className="op-note"><summary>部分表头不清楚 · 对照原图确认列序</summary><p>依次核对填报列：{meituanDailyColumns.map(f=>'第'+(f.index+1)+'列 '+f.label).join('、')}。如有不同，请直接修正下方表头。</p><label><input type="checkbox" checked={confirmedOrder} onChange={e=>setConfirmedOrder(e.target.checked)}/> 原图的列序与上述清单一致，按此列序逐格读取</label></details>}
   {normalizedDaily&&rows.length>2&&<label>要填报的日期<select aria-label="选择截图填报日期" value={selectedImportDay} disabled={working||disabled} onChange={e=>{setSelectedImportDay(e.target.value);setChecked(false);}}><option value="">全部 {rows.length-1} 个业务日期</option>{rows.slice(1).map((r,i)=><option key={i} value={r[0]}>{r[0]}</option>)}</select></label>}
   {meituanDate&&availableDays.length>1&&result.bounds&&<button type="button" className="op-button" disabled={disabled||working} onClick={()=>void reviewEveryDay()}>读取图中全部 {availableDays.length} 个业务日期</button>}
   {meituanDate&&availableDays.length>0&&<label>按截图里的日期填报<select aria-label="截图业务日期" value={selectedDay} onChange={e=>setSourceDay(e.target.value)}>{availableDays.map(d=><option key={d}>{d}</option>)}</select><small>当前页面日期 {meituanDate}，可选择图中其他日期。</small></label>}
   {meituanDate&&selectedDay&&result.bounds&&<MeituanDayReview key={url+selectedDay} date={selectedDay} url={url} bounds={result.bounds} rows={rows} disabled={disabled} onUse={onUseDay}/>}
   <details open={!dayReview} key={String(dayReview)} className="op-full-grid"><summary>{dayReview?'其他表格格式 / 查看整张识别表':'整张表格核对'}</summary><div className="op-ocr-actions"><label>表头行<select aria-label="截图表头行" value={header} onChange={e=>{setHeader(Number(e.target.value));setChecked(false);}}>{rows.map((_,i)=><option key={i} value={i}>第{i+1}行</option>)}</select></label><button type="button" className="op-button" disabled={disabled||columns>=40} onClick={()=>change(rows.map(row=>[...row,'']),false)}><Plus size={15}/>增加列</button><button type="button" className="op-button" disabled={disabled||rows.length>=100} onClick={()=>change([...rows,Array.from({length:columns},()=> '')],false)}><Plus size={15}/>增加行</button><button type="button" className="op-button" disabled={disabled||header+1>=rows.length} onClick={()=>reviewEdit(mergeOcrHeaders)}>合并本行与下一行表头</button><span className="op-muted">{rows.length}行 · {columns}列 · {header+1}行作表头</span></div>
   <div className="op-ocr-mode" role="group" aria-label="截图核对方式"><button type="button" disabled={disabled} aria-pressed={reviewMode==='table'} onClick={()=>setReviewMode('table')}>表格核对</button><button type="button" disabled={disabled} aria-pressed={reviewMode==='cell'} onClick={()=>setReviewMode('cell')}>逐格核对</button></div>
   {reviewMode==='cell'&&<OperatingOcrCellReview rows={rows} header={header} uncertain={result.uncertain} disabled={disabled} onEdit={edit}/>}
   <div className="op-ocr-grid" hidden={reviewMode!=='table'} tabIndex={0} aria-label="可编辑截图识别结果"><table><thead><tr><th>行</th>{Array.from({length:columns},(_,c)=><th key={c}>{normalizedDaily?rows[0][c]:'第'+(c+1)+'列'} <button type="button" disabled={disabled||columns<=1} aria-label={'删除截图第'+(c+1)+'列'} onClick={()=>reviewEdit(state=>removeOcrColumn(state,c))}><Trash2 size={13}/></button></th>)}<th>操作</th></tr></thead><tbody>{rows.map((row,r)=><tr key={r} className={r===header?'op-ocr-header':''}><th>{r+1}{r===header?' 表头':''}</th>{row.map((cell,c)=><td key={c} className={result.uncertain.includes(r+':'+c)?'uncertain':''}><input aria-label={'截图第'+(r+1)+'行第'+(c+1)+'列'} title={result.uncertain.includes(r+':'+c)?'原识别把握较低，请核对':'请对照截图核对'} value={cell} disabled={disabled} maxLength={200} onChange={e=>edit(r,c,e.target.value)}/></td>)}<td><button type="button" disabled={disabled||rows.length<=1} aria-label={'删除截图第'+(r+1)+'行'} onClick={()=>reviewEdit(state=>removeOcrRow(state,r))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>
   <details><summary>用制表符整理表头和分列</summary><p className="op-muted">列之间用Tab，行之间换行。保留日期/累计标题供后续核验；复杂合并表头请自行整理成一行字段名，不要把多日累计标作单日。</p><textarea aria-label="截图识别制表符编辑" rows={6} value={rows.map(row=>row.join('\t')).join('\n')} onChange={e=>{const lines=e.target.value.split('\n').map(line=>line.split('\t'));if(lines.length>100||lines.some(row=>row.length>40||row.some(cell=>cell.length>200))){setError('最多100行40列，每格200字');return;}const width=Math.max(...lines.map(row=>row.length));change(lines.map(row=>[...row,...Array.from({length:width-row.length},()=> '')]));}}/></details>
   <label className="op-ocr-check"><input type="checkbox" disabled={disabled} checked={approved} onChange={e=>{setCheckedFor(approvalKey);setChecked(e.target.checked);}}/><span>{purpose==='template'?'我已对照原图，核对表头、字段单位和分行名称':'我已逐项对照原图，核对表头、金额单位、日期、空白与0及全部数字'}{confirmationNote&&<strong>{confirmationNote}</strong>}</span></label><p className="op-muted">{purpose==='template'?'下一步只生成模板候选，仍需确认字段口径。':'下一步进入原填报预览，不会直接保存或确认。'}截图原图不进入云端备份。</p><button type="button" className="co-primary" disabled={disabled||!approved} onClick={use}>{purpose==='template'?'用已核对截图生成候选字段':'读取到填报预览'}</button></details>
  </div>}
  {error&&<p className="co-error" role="alert">{error}</p>}
 </section>;
}
