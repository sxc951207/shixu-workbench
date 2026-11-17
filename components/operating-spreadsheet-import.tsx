'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import OperatingColumnReview,{type ColumnTask} from './operating-column-review';
import {identifyColumns} from '../lib/workbench/operating-column-map';
import {ClipboardPaste,FileSpreadsheet,ImagePlus,Upload,X} from 'lucide-react';
import {readOperatingFile,type OperatingFileSheet} from '../lib/workbench/operating-file';
import {normalizeDailyReportRows} from '../lib/workbench/operating-row-layout';
import {sourceBusinessDates} from '../lib/workbench/operating-source-date';
import type {OperatingSheet} from '../cloud/company/operating-model';
import {companyRequest} from '../cloud/company-root';
import {StoreMappingNeeded} from '../lib/workbench/operating-store-match';
import OperatingScreenshotImport from './operating-screenshot-import';
import {extractStoreTargets,findRevenueStoreHeader,revenueSourceDates,TargetMonthNeeded,transposeRevenueDays,type RevenueColumnContext,type RevenueMonthlyTargets} from '../lib/workbench/operating-import-layout';
import {inferOperatingTemplate} from '../lib/workbench/operating-template-inference';
import {projectReportLayout} from '../lib/workbench/operating-project-layout';

const screenshotTypes=['image/png','image/jpeg','image/webp'];
const pasteFallback='可以点一下填报窗口，按 Ctrl+V（Mac 用 ⌘V），或从相册选择截图。';

export default function OperatingSpreadsheetImport({onUse,onTemplate,template,meituanDate,period,aliasScope,aliasStores,onSourceChange,onAliasesLoaded,purpose='template',disabled=false,revenueContext}:{template?:import('../cloud/company/operating-model').OperatingTemplate;aliasScope?:{companyId:string;projectId:string;sheet:OperatingSheet};aliasStores?:{id:string;name:string}[];onSourceChange?:()=>void;onAliasesLoaded?:(aliases:ReadonlyMap<string,string>)=>void;period?:{date:string;sheet:OperatingSheet};meituanDate?:string;onTemplate?:(result:ReturnType<typeof inferOperatingTemplate>,source:string,candidateName?:string)=>void;onUse:(rows:unknown[][],headerRow:number,storeAliases?:ReadonlyMap<string,string>,dates?:string[],targets?:RevenueMonthlyTargets)=>void;purpose?:'template'|'data';disabled?:boolean;revenueContext?:RevenueColumnContext}){
 const [columnTask,setColumnTask]=useState<ColumnTask|null>(null);
 const [monthTask,setMonthTask]=useState<{matrix:unknown[][];header:number;dates?:string[];months:string[];choice:string}|null>(null);
 const input=useRef<HTMLInputElement>(null),request=useRef(0);
 const [sheets,setSheets]=useState<(OperatingFileSheet&{normalized?:boolean})[]>([]),[selected,setSelected]=useState(0),[header,setHeader]=useState(0),[name,setName]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[over,setOver]=useState(false);
 const [layout,setLayout]=useState<'auto'|'rows'|'store-columns'>('auto'),[dailyConfirmed,setDailyConfirmed]=useState(false),[layoutNote,setLayoutNote]=useState(''),[reviewRevision,setReviewRevision]=useState(0);
 const [manualHeader,setManualHeader]=useState<number>(),[adopted,setAdopted]=useState<number[]>([]),[candidateName,setCandidateName]=useState<string|null>(null);
 const screenshotId=useId(),[screenshotOpen,setScreenshotOpen]=useState(false);
 const [incoming,setIncoming]=useState<{file:File;sequence:number}|null>(null),dropSequence=useRef(0);
 const [imageCandidate,setImageCandidate]=useState<{result:ReturnType<typeof inferOperatingTemplate>;source:string;name:string}|null>(null);
 const [aliases,setAliases]=useState(new Map<string,string>()),[missing,setMissing]=useState<StoreMappingNeeded|null>(null);
 const [aliasBusy,setAliasBusy]=useState(!!aliasScope),[aliasError,setAliasError]=useState(''),[aliasReload,setAliasReload]=useState(0);
 useEffect(()=>{onAliasesLoaded?.(aliases);},[aliases,onAliasesLoaded]);
 const aliasVersion=useRef(0);
 useEffect(()=>{
  const version=++aliasVersion.current;setAliases(new Map());setMissing(null);setAliasError('');
  if(!aliasScope){setAliasBusy(false);return;}
  setAliasBusy(true);void companyRequest({...aliasScope,action:'ops.storeAlias.list'}).then(r=>{if(aliasVersion.current===version)setAliases(new Map(r.aliases));}).catch(e=>{if(aliasVersion.current===version)setAliasError(e.message);}).finally(()=>{if(aliasVersion.current===version)setAliasBusy(false);});
  return()=>{aliasVersion.current++;};
 },[aliasScope?.companyId,aliasScope?.projectId,aliasScope?.sheet,aliasReload]);
 async function remember(source:string,storeId:string|null){
  if(disabled||aliasBusy)return;
  const version=aliasVersion.current,previous=aliases.get(source)??null;
  try{
   if(aliasScope){
    setAliasBusy(true);const r=await companyRequest({...aliasScope,action:'ops.storeAlias.save',source,storeId,previous});
    if(version!==aliasVersion.current)return;setAliases(new Map(r.aliases));
   }else{const next=new Map(aliases);if(storeId)next.set(source,storeId);else next.delete(source);setAliases(next);}
   onSourceChange?.();setMissing(null);setAliasError('');setError('');
   setLayoutNote(storeId?(aliasScope?'已记住本项目的门店对应，下次自动沿用。':'已指定本次门店对应。')+'请再点「读取到填报预览」核对。':'已取消这条门店对应，下次可重新选择。');
  }catch(e){if(version===aliasVersion.current)setAliasError((e as Error).message);}
  finally{if(version===aliasVersion.current)setAliasBusy(false);}
 }
 function resetMatches(){setLayout('auto');setLayoutNote('');setDailyConfirmed(false);setColumnTask(null);setMonthTask(null);setIncludeOptional(false);onSourceChange?.();setDateChoice('');if(!aliasScope)setAliases(new Map());setMissing(null);}
 const data=sheets[selected]?.data;
 const [dateChoice,setDateChoice]=useState('');
 const [includeOptional,setIncludeOptional]=useState(false);
 const targetsOnly=period?.sheet==='targets';
 const revenueSource=purpose==='data'?revenueContext:undefined;
 const revenueAliases=useMemo(()=>new Map([...(revenueSource?.storeAliases??[]),...aliases]),[revenueSource?.storeAliases,aliases]);
 function horizontal(rows:unknown[][],index:number){
  if(!revenueSource)return false;
  return layout==='store-columns'||layout==='auto'&&findRevenueStoreHeader(rows,{...revenueSource,storeAliases:revenueAliases},index)>=0;
 }
 const horizontalFile=!!data&&horizontal(data,header);
 const detectedDates=useMemo(()=>{if(!data||!period||horizontalFile&&targetsOnly)return {facts:[],all:[]};try{if(horizontalFile){const all=revenueSourceDates(data,header,period.date);return {facts:all,all};}return {facts:sourceBusinessDates(data,header,period.sheet,period.date,false),all:sourceBusinessDates(data,header,period.sheet,period.date)};}catch{return {facts:[],all:[]};}},[data,header,horizontalFile,period?.sheet,period?.date]);
 const dates=includeOptional?detectedDates.all:detectedDates.facts;
 const sheetYear=/^(\d{2}|\d{4})年\d{1,2}月/.exec(sheets[selected]?.sheet||'')?.[1];
 const yearConflict=sheetYear&&dates.some(d=>d.slice(0,4)!==(sheetYear.length===2?'20'+sheetYear:sheetYear));
 const picked=dateChoice||(dates.length>1?'all':dates[0]||period?.date||'');
 function toggleScreenshot(){setMonthTask(null);setColumnTask(null);onSourceChange?.();if(screenshotOpen)setIncoming(null);setScreenshotOpen(open=>!open);}
 function drop(file:File|undefined){
  if(!file||disabled)return;
  if(/\.(?:png|jpe?g|webp)$/i.test(file.name)||/^image\/(png|jpeg|webp)$/i.test(file.type)){
   ++request.current;setLoading(false);resetMatches();setSheets([]);setError('');setImageCandidate(null);setIncoming({file,sequence:++dropSequence.current});setScreenshotOpen(true);return;
  }
  void read(file);
 }
 function acceptClipboardImage(blob:Blob){
  const ext=blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1];
  const file=blob instanceof File&&/\.(png|jpe?g|webp)$/i.test(blob.name)?blob:new File([blob],'粘贴的截图.'+ext,{type:blob.type});
  const details=input.current?.closest('details');
  if(details)details.open=true;
  drop(file);
 }
 useEffect(()=>{
  const element=input.current,scope=element?.closest('dialog')??element?.closest('section.op-file-import');
  if(!scope||!element)return;
  function paste(event:Event){
   const data=(event as ClipboardEvent).clipboardData,target=event.target;
   if(!data||event.defaultPrevented||element?.matches(':disabled')||!(target instanceof Element))return;
   if(target.closest('dialog')!==element?.closest('dialog'))return;
   if(target.closest('input,textarea,[contenteditable="true"]')&&data.getData('text/plain'))return;
   const files=data.files.length?Array.from(data.files):Array.from(data.items).map(i=>i.kind==='file'?i.getAsFile():null).filter((f):f is File=>f!==null);
   if(!files.some(f=>f.type.startsWith('image/')))return;
   event.preventDefault();
   const details=element?.closest('details');if(details)details.open=true;
   if(files.length!==1){setError('请一次粘贴一张截图。');return;}
   if(!screenshotTypes.includes(files[0].type)){setError('请粘贴 PNG、JPG 或 WebP 截图。');return;}
   acceptClipboardImage(files[0]);
  }
  scope.addEventListener('paste',paste);
  return()=>scope.removeEventListener('paste',paste);
 });
 async function pasteFromClipboard(){
  const ticket=++request.current;
  setLoading(false);
  const current=()=>ticket===request.current&&!!input.current&&!input.current.matches(':disabled');
  if(!navigator.clipboard?.read){setError('浏览器未提供粘贴按钮所需的权限。'+pasteFallback);return;}
  try{
   const items=await navigator.clipboard.read();
   if(!current())return;
   const images=items.filter(item=>item.types.some(type=>type.startsWith('image/')));
   if(images.length!==1){setError(images.length?'请一次复制一张截图。':'剪贴板里没有图片，请先截图或选择「复制图片」。');return;}
   const type=screenshotTypes.find(type=>images[0].types.includes(type));
   if(!type){setError('请复制 PNG、JPG 或 WebP 图片。');return;}
   const image=await images[0].getType(type);
   if(current())acceptClipboardImage(image);
  }catch{if(current())setError('浏览器未能读取剪贴板。'+pasteFallback);}
 }
 const inferTemplate=!!onTemplate;
 const candidate=useMemo(()=>{
  if(!data||!inferTemplate)return null;
  try{return {result:inferOperatingTemplate(data,manualHeader)};}
  catch(e){return {error:(e as Error).message};}
 },[data,manualHeader,inferTemplate]);
 const suggestedName=candidate?.result?.suggestedName||sheets[selected]?.sheet.replace(/\.(xlsx|csv|tsv|txt)$/i,'')||'表格生成的汇报';
 const proposedName=candidateName??suggestedName.slice(0,60);
 const displayedHeader=candidate?.result?.headerRow??manualHeader??header;
 async function read(file:File|undefined){if(!file||disabled)return;setScreenshotOpen(false);setIncoming(null);setImageCandidate(null);const id=++request.current;setLoading(true);resetMatches();setError('');setSheets([]);setManualHeader(undefined);setCandidateName(null);setAdopted([]);setLayoutNote('');setDailyConfirmed(false);try{const originals=await readOperatingFile(file);if(id!==request.current)return;
  const result=originals.map(source=>{
   try{const normalized=sourceRows(source.data,guess(source.data));return normalized.rows===source.data?source:{...source,data:normalized.rows,normalized:true};}
   catch{return source;} // Keep other worksheets selectable. The selected source explains any layout error on preview.
  });
  const layouts=result.map(sheet=>{
   const storeHeader=revenueSource?findRevenueStoreHeader(sheet.data,{...revenueSource,storeAliases:revenueAliases}):-1;
   if(storeHeader>=0)return {header:storeHeader,matches:1,horizontal:true};
   return {...projectReportLayout(sheet.data,period?.sheet,template),horizontal:false};
  });
  const matches=period&&purpose==='data'&&result.length>1?result.flatMap((sheet,i)=>{
   const detected=layouts[i];
   try{
    const days=detected.horizontal?revenueSourceDates(sheet.data,detected.header,period.date):sourceBusinessDates(sheet.data,detected.header,period.sheet,period.date);
    return days.some(d=>d.slice(0,7)===period.date.slice(0,7))?[i]:[];
   }catch{return [];}
  }):[];
  const max=Math.max(...layouts.map(l=>l.matches));
  const candidates=layouts.flatMap((l,i)=>max>0&&l.matches===max?[i]:[]);
  const index=candidates.find(i=>matches.includes(i))??candidates[0]??matches[0]??0;
  setName(file.name);setSheets(result);setSelected(index);setHeader(layouts[index].header);
 }catch(e){setError((e as Error).message);}finally{if(id===request.current)setLoading(false);}}
 function guess(rows:unknown[][]){
  const storeHeader=revenueSource?findRevenueStoreHeader(rows,{...revenueSource,storeAliases:revenueAliases}):-1;
  return storeHeader>=0?storeHeader:projectReportLayout(rows,period?.sheet,template).header;
 }
 function sourceRows(matrix:unknown[][],header:number){
  if(purpose==='data'&&period&&(period.sheet==='douyin'||period.sheet==='meituan'||template?.dimension==='total'))return normalizeDailyReportRows(matrix,header,period.date);
  return {rows:matrix,header};
 }
 function useRows(matrix:unknown[][],row:number,confirmed:boolean,sourceDates?:string[],targetMonth?:string){
  setColumnTask(null);setMonthTask(null);
  if(revenueSource&&horizontal(matrix,row)){
   if(aliasBusy)throw Error('正在读取或保存门店对应，请稍候再预览。');
   try{
    if(targetsOnly){
     if(!confirmed)throw Error('请确认原图的月份、门店和目标金额。');
     const target=extractStoreTargets(matrix,row,{...revenueSource,storeAliases:revenueAliases,targetMonth});
     const targetMatrix=[['门店','月目标'],...target.rows.map(r=>[r.storeName,r.target===null?'':(r.target/100).toFixed(2)])];
     onUse(targetMatrix,0,revenueAliases,[target.date]);
     setMissing(null);setLayoutNote('已读取 '+target.date.slice(0,7)+' 的门店月目标。');return;
    }
    const converted=transposeRevenueDays(matrix,row,{...revenueSource,storeAliases:revenueAliases,confirmedDaily:confirmed,targetMonth},sourceDates);
    onUse(converted.matrix,converted.headerRow,revenueAliases,converted.dates,converted.targets);
    setMissing(null);
    const notes=['已识别 '+converted.dates.length+' 天的门店业绩。'];
    if(converted.skippedOtherDates)notes.push('另有 '+converted.skippedOtherDates+' 个日期为空或未选中。');
    if(converted.targets)notes.push('已读取 '+converted.targets.date.slice(0,7)+' 的门店月目标。');
    if(converted.skippedNonDailyRows.length)notes.push('已略过行：'+converted.skippedNonDailyRows.join('、')+'。');
    if(converted.ignoredColumns.length)notes.push('未计入门店的列：'+converted.ignoredColumns.join('、')+'。');
    setLayoutNote(notes.join(''));
   }catch(e){
    if(e instanceof TargetMonthNeeded){
     onSourceChange?.();setLayoutNote('');
     setMonthTask({matrix,header:row,dates:sourceDates,months:e.months,choice:''});
     return;
    }
    if(e instanceof StoreMappingNeeded)setMissing(e);throw e;
   }
   return;
  }
  const normalized=sourceRows(matrix,row);matrix=normalized.rows;row=normalized.header;
  if(aliasScope&&period&&purpose==='data'){
   const info=identifyColumns(matrix,row,period.sheet,template);
   if(info){setColumnTask({matrix,header:row,info,confirmed,dates:sourceDates});return;}
  }
  commitRows(matrix,row,confirmed,sourceDates);
 }
 function commitRows(matrix:unknown[][],row:number,confirmed:boolean,sourceDates?:string[]){
  if(aliasBusy)throw Error('正在读取或保存门店对应，请稍候再预览。');
  if(!sourceDates&&period){const detected=sourceBusinessDates(matrix,row,period.sheet,period.date);if(detected.length)sourceDates=detected;}
  const useDates=sourceDates?.length?sourceDates:undefined;
  try{onUse(matrix,row,aliases,useDates);setMissing(null);setLayoutNote('');}catch(e){if(e instanceof StoreMappingNeeded)setMissing(e);throw e;}
 }
 function use(){try{
  if(onTemplate&&candidate?.result){
   if(!proposedName.trim())throw Error('请填写候选模板名称。');
   onTemplate(candidate.result,sheets[selected].sheet,proposedName.trim());setAdopted(list=>[...list,selected]);setError('');return;
  }
  useRows(sheets[selected].data,header,!horizontalFile||dailyConfirmed,period?(picked==='all'?dates:horizontalFile&&!dates.length?undefined:[picked]):undefined);setError('');if(purpose==='template')setSheets([]);}catch(e){setError((e as Error).message);}}
 return <section className={'op-file-import '+(over?'dragging':'')} aria-label={purpose==='template'?'从表格生成模板':'导入本次填报表格'} onDragOver={e=>{e.preventDefault();if(!disabled)setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(e.dataTransfer.files.length!==1){setError('每次请选择一份表格或一张截图。');return;}drop(e.dataTransfer.files[0]);}}>
  {purpose==='data'&&revenueContext&&<div className="op-import-layout"><label>原表怎么排<select aria-label="总业绩源表方向" disabled={disabled||loading} value={layout} onChange={e=>{resetMatches();setLayout(e.target.value as typeof layout);setDailyConfirmed(false);setLayoutNote('');setReviewRevision(v=>v+1);}}><option value="auto">自动识别</option><option value="rows">每个门店一行（普通表）</option><option value="store-columns">门店横着排，日期竖着排（总业绩表）</option></select></label>{(horizontalFile||layout==='store-columns')&&<p className="op-note">{targetsOnly?'仅提取各门店的月目标，日业绩在总业绩页录入。':'已选用横排门店格式。按原表日期读取各店业绩，同表的月目标可一起预览。'}</p>}</div>}
  <div className="op-file-import-title"><FileSpreadsheet size={22}/><div><strong>{purpose==='template'?'拖入已有 Excel，生成指标草案':'拖入同格式表格，预览本次数据'}</strong><p>{purpose==='template'?'表格可直接拖入；也可拖入截图或选择下方截图识别。':'按原表业务日期生成预览，可一起导入多天。'} xlsx / csv / tsv / txt，最大5MiB。</p></div><button className="op-button" type="button" data-import-reading={loading||undefined} disabled={disabled||loading} onClick={()=>input.current?.click()}><Upload size={16}/>{loading?'正在读取表格…':'选择表格'}</button><input ref={input} hidden type="file" aria-label="上传汇报表格" accept=".xlsx,.csv,.tsv,.txt" disabled={disabled||loading} onChange={e=>{void read(e.target.files?.[0]);e.target.value='';}}/></div>
  <div className="op-clipboard-actions"><button type="button" className="op-button op-image-toggle" aria-expanded={screenshotOpen} aria-controls={screenshotId} disabled={disabled} onClick={toggleScreenshot}><ImagePlus size={16}/>{purpose==='template'?'用报表截图生成':'用截图导入数据'}</button><button className="op-button" type="button" disabled={disabled||loading} onClick={()=>void pasteFromClipboard()}><ClipboardPaste size={16}/>粘贴截图</button><small>也可直接按 Ctrl+V / ⌘V</small></div>
  <div id={screenshotId} hidden={!screenshotOpen} onChangeCapture={()=>{setMonthTask(null);setColumnTask(null);setImageCandidate(null);}} onClickCapture={e=>{if((e.target as Element).closest('button')){setMonthTask(null);setColumnTask(null);setImageCandidate(null);onSourceChange?.();}}}>
   {screenshotOpen&&<OperatingScreenshotImport key={incoming?.sequence||0} meituanDate={meituanDate} dailySheet={targetsOnly?'targets':revenueSource?'revenue':period?.sheet} dailyTemplate={revenueSource?undefined:template} dailyStores={revenueSource?.stores??aliasStores} dailyReference={period&&(revenueSource||period.sheet==='douyin'||period.sheet==='meituan'||template)?period.date:undefined} douyinStoreDate={period?.sheet==='douyin-stores'?period.date:undefined} initialFile={incoming?.file} onSelect={()=>{++request.current;setLoading(false);setSheets([]);resetMatches();setImageCandidate(null);}} purpose={purpose} disabled={disabled} confirmationKey={String(reviewRevision)} confirmationNote={revenueSource&&layout!=='rows'?(targetsOnly?'我已核对月份、门店名称和月目标金额。':'我已确认各日期行填写当日业绩，并核对了原图中的月目标。'):''} onUse={(matrix,row,source)=>{
    if(onTemplate){const result=inferOperatingTemplate(matrix,row);setImageCandidate({result,source,name:(result.suggestedName||source.replace(/\.(png|jpe?g|webp)$/i,'')||'报表截图').slice(0,60)});}
    else useRows(matrix,row,true);
    setError('');
   }}/>}
  </div>
  {imageCandidate&&onTemplate&&<section className="op-template-designer" aria-label="已核对截图的指标草案"><h4>截图指标草案</h4><p>{imageCandidate.source} · {imageCandidate.result.analysis.fields.map(f=>f.label).join('、')}</p>{imageCandidate.result.notes.map(note=><p className="op-muted" key={note}>{note}</p>)}
   <label>截图模板名称<input maxLength={60} value={imageCandidate.name} disabled={disabled} onChange={e=>{setImageCandidate({...imageCandidate,name:e.target.value});setError('');}}/></label>
   <button type="button" className="op-button" disabled={disabled||!imageCandidate.name.trim()} onClick={()=>{try{onTemplate(imageCandidate.result,imageCandidate.source,imageCandidate.name.trim());setImageCandidate(null);setError('');}catch(e){setError((e as Error).message);}}}>将截图字段加入指标方案</button></section>}
  {data&&sheets[selected]?.normalized&&<p className="op-note">已按原表业务日期整理，请核对下方的日期和指标。</p>}{data&&detectedDates.all.length>detectedDates.facts.length&&<label className="op-note"><input type="checkbox" checked={includeOptional} onChange={e=>{setColumnTask(null);setIncludeOptional(e.target.checked);setDateChoice('');onSourceChange?.();}}/> 包含另外 {detectedDates.all.length-detectedDates.facts.length} 个仅有选填指标、交易字段全空的日期</label>}{data&&dates.length>0&&<p className="op-note">工作表「{sheets[selected].sheet}」 · 原表业务日期 {dates[0]} 至 {dates.at(-1)}，共 {dates.length} 天。{yearConflict&&<strong>工作表名称与日期列年份不同，将按日期列保存，请核对年份。</strong>}</p>}{data&&<div className="op-import-preview" onChangeCapture={()=>setMonthTask(null)}><div className="op-panel-title"><strong>{name}</strong><button className="op-close" aria-label="清除待导入表格" type="button" onClick={()=>{resetMatches();setSheets([]);setError('');setLayoutNote('');}}><X size={16}/></button></div><div className="op-config-grid"><label>工作表<select value={selected} onChange={e=>{const index=Number(e.target.value);setSelected(index);resetMatches();setError('');setManualHeader(undefined);setCandidateName(null);setHeader(guess(sheets[index].data));setDailyConfirmed(false);}}>{sheets.map((s,i)=><option value={i} key={i}>{s.sheet}</option>)}</select></label><label>表头在哪一行<select aria-label="表头行" value={displayedHeader} onChange={e=>{resetMatches();setError('');setManualHeader(Number(e.target.value));setCandidateName(null);setHeader(Number(e.target.value));setDailyConfirmed(false);}}>{data.slice(0,30).map((row,i)=><option key={i} value={i}>第{i+1}行 · {row.map(v=>String(v??'')).filter(Boolean).join(' / ').slice(0,90)}</option>)}</select></label></div><div className="op-table-wrap"><table className="op-table"><thead><tr>{data[displayedHeader]?.map((cell,i)=><th key={i}>{String(cell??'')}</th>)}</tr></thead><tbody>{data.slice(displayedHeader+1,displayedHeader+4).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell instanceof Date?cell.toISOString().slice(0,10):String(cell??'')}</td>)}</tr>)}</tbody></table></div>{candidate?.result&&<section aria-label="自动识别的指标草案"><h4>此工作表的指标草案</h4><label>候选模板名称<input value={proposedName} maxLength={60} disabled={disabled||adopted.includes(selected)} onChange={e=>{setCandidateName(e.target.value);setError('');}}/></label><p>填报字段：{candidate.result.analysis.fields.map(f=>f.label).join('、')||'未识别到'}。</p>
   {!!candidate.result.metrics.length&&<p>计算指标：{candidate.result.metrics.map(m=>m.label).join('、')}。</p>}
   {candidate.result.analysis.dimension&&<p>按{candidate.result.analysis.dimension.label}分行：{candidate.result.analysis.dimension.names.join('、')}。</p>}
   {candidate.result.notes.map(note=><p className="op-muted" key={note}>{note}</p>)}</section>}
   {candidate?.error&&<p className="co-error" role="alert">{candidate.error} 可改选工作表或表头行。</p>}
   {!onTemplate&&<p className="op-muted">请核对表头、日期和范围，再读取到预览。</p>}
   {period&&!(horizontalFile&&targetsOnly)&&<label className="op-note">按原表业务日期导入{dates.length?<select aria-label="导入业务日期" value={picked} onChange={e=>{setColumnTask(null);setDateChoice(e.target.value);setDailyConfirmed(false);}}>{dates.length>1&&<option value="all">全部 {dates.length} 个业务日期</option>}{dates.map(d=><option key={d}>{d}</option>)}</select>:<input aria-label="确认表格业务日期" type="date" value={picked} onChange={e=>{setColumnTask(null);setDateChoice(e.target.value);}}/>}<small>页面所选日期为 {period.date}。{dates.length?'按上面选择的原表日期生成预览。':'表里没有可确定的日期，请核对或修改。'}</small></label>}
   {adopted.includes(selected)&&<p className="op-note" role="status">此工作表已核对，可在下方查看对应模板，或选择另一张工作表继续。</p>}{horizontalFile&&<label className="op-daily-confirm"><input type="checkbox" checked={dailyConfirmed} disabled={disabled} onChange={e=>setDailyConfirmed(e.target.checked)}/>{targetsOnly?'我已核对月份、门店名称和月目标金额。':'我已确认所选日期行填写当日业绩，并核对了表中的月目标'}</label>}<button className="op-button" type="button" disabled={disabled||horizontalFile&&!dailyConfirmed||!!onTemplate&&(!candidate?.result?.analysis.fields.length||adopted.includes(selected))} onClick={use}>{onTemplate?'将此工作表加入指标方案':purpose==='template'?'识别这些字段':'读取到填报预览'}</button></div>}
  {columnTask&&aliasScope&&<OperatingColumnReview task={columnTask} scope={aliasScope} disabled={disabled} onInvalidate={()=>onSourceChange?.()} onPreview={matrix=>commitRows(matrix,columnTask.header,columnTask.confirmed,columnTask.dates)}/>}
  {monthTask&&<div className="op-config-grid" role="group" aria-label="核对目标月份">
   <label>{monthTask.months.length?'原表跨月，请选择月目标所属月份':'原表没有明确月份，请填写月目标所属月份'}
    {monthTask.months.length?<select aria-label="月目标所属月份" value={monthTask.choice} onChange={e=>setMonthTask({...monthTask,choice:e.target.value})}><option value="">请选择月份</option>{monthTask.months.map(month=><option key={month}>{month}</option>)}</select>
     :<input type="month" aria-label="月目标所属月份" min="1970-01" max="2100-12" value={monthTask.choice} onChange={e=>setMonthTask({...monthTask,choice:e.target.value})}/>}
   </label>
   <button type="button" className="op-button" disabled={disabled||aliasBusy||!monthTask.choice} onClick={()=>{
    try{useRows(monthTask.matrix,monthTask.header,true,monthTask.dates,monthTask.choice);setError('');}
    catch(e){setError((e as Error).message);}
   }}>按所选月份生成预览</button>
  </div>}
  {error&&<p className="co-error" role="alert">{error}</p>}
  {missing&&<label className="op-note">表里的「{missing.sourceName}」对应项目里的哪家门店？<select aria-label="选择对应的项目门店" value="" disabled={aliasBusy||disabled} onChange={e=>void remember(missing.sourceName,e.target.value)}><option value="" disabled>选择已有门店</option>{missing.choices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><small>确为新店时，在项目指标设置的「分行名称」中增加门店。</small></label>}
  {aliasError&&<p role="alert" className="co-error">门店对应尚未同步：{aliasError} <button type="button" className="op-button" disabled={aliasBusy} onClick={()=>setAliasReload(n=>n+1)}>重新读取</button></p>}
  {aliasScope&&aliases.size>0&&<details><summary>已记住的门店对应（{aliases.size}）</summary>{[...aliases].map(([source,id])=><p key={source}>{source} → {aliasStores?.find(s=>s.id===id)?.name||id} <button aria-label={'取消对应：'+source} disabled={aliasBusy||disabled} className="op-button" type="button" onClick={()=>void remember(source,null)}>取消对应</button></p>)}</details>}
  {layoutNote&&<p className="op-note" role="status">{layoutNote}</p>}

 </section>;
}
