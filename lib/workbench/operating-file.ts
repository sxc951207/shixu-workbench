import {platformImportField} from './operating-paste.ts';
import {douyinScreenshotPeriod} from './operating-source-date.ts';
import {isOperatingReportNote} from './operating-report-note.ts';
import {operatingFields,parseOperatingInput} from './operating-data.ts';
import {matchOperatingField,previewOperatingPaste,type OperatingPasteOptions} from './operating-paste.ts';
import {assertOperatingYuanUnit} from './operating-field-dictionary.ts';
import {operatingImportDate} from './operating-import-layout.ts';
import {operatingLeafLabels} from './operating-template-inference.ts';
export type OperatingFileSheet={sheet:string;data:unknown[][]};
const maxBytes=5*1024*1024;
export function assertSafeOperatingXlsx(buffer:ArrayBuffer){
 const data=new DataView(buffer);let end=-1;
 for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(data.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Excel文件不是有效的xlsx ZIP文件');
 const count=data.getUint16(end+10,true),start=data.getUint32(end+16,true),size=data.getUint32(end+12,true);
 if(data.getUint16(end+4,true)||data.getUint16(end+6,true)||count!==data.getUint16(end+8,true)||count<1||count>400||start+size!==end||end+22+data.getUint16(end+20,true)!==buffer.byteLength)throw Error('Excel压缩结构不支持或目录不完整');
 let pos=start,total=0;
 for(let n=0;n<count;n++){
  if(pos+46>start+size||data.getUint32(pos,true)!==0x02014b50)throw Error('Excel ZIP目录损坏');
  const flags=data.getUint16(pos+8,true),method=data.getUint16(pos+10,true),expanded=data.getUint32(pos+24,true),compressed=data.getUint32(pos+20,true),offset=data.getUint32(pos+42,true);
  total+=expanded;if(flags&1||![0,8].includes(method)||total>20*1024*1024||offset+compressed>buffer.byteLength)throw Error('Excel解压后过大、已加密或格式不支持，请拆成小表');
  pos+=46+data.getUint16(pos+28,true)+data.getUint16(pos+30,true)+data.getUint16(pos+32,true);
 }
 if(pos!==start+size)throw Error('Excel ZIP目录不完整');
}
function delimited(text:string,separator:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const push=()=>{row.push(cell);cell='';closed=false;if(row.length>60)throw Error('表格最多60列');};
 const line=()=>{push();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>5000)throw Error('表格最多5000行，请按期间拆分');};
 const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}if(c===separator){push();continue;}if(c==='\n'){line();continue;}if(c==='"'&&!cell&&!closed){quoted=true;continue;}if(c==='"'||closed&&c.trim())throw Error('表格引号未正确闭合');if(!closed)cell+=c;}
 if(quoted)throw Error('表格引号未闭合');if(cell||row.length||closed)line();return rows;
}
export async function readOperatingFile(file:Pick<File,'name'|'size'|'arrayBuffer'|'text'>):Promise<OperatingFileSheet[]>{
 if(file.size>maxBytes)throw Error('文件不能超过5MiB，请按期间拆分');
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(ext==='xlsx'){
  const buffer=await file.arrayBuffer();assertSafeOperatingXlsx(buffer);
  const {default:read}=await import('read-excel-file/universal');const sheets=await read(buffer);
  if(!sheets.length||sheets.length>30)throw Error('请选择包含1至30个工作表的文件');
  let cells=0;for(const sheet of sheets){if(sheet.data.length>5000||sheet.data.some(row=>row.length>60))throw Error('每张表最多5000行、60列');cells+=sheet.data.reduce((sum,row)=>sum+row.length,0);}
  if(cells>100000)throw Error('文件数据较多，请拆分后导入');return sheets;
 }
 if(!['csv','tsv','txt'].includes(ext||''))throw Error('请选择xlsx、csv、tsv或txt格式；旧xls请另存为xlsx');
 return[{sheet:file.name,data:delimited(await file.text(),ext==='csv'?',':'\t')}];
}
export function operatingTableText(rows:unknown[][]):string{
 return rows.map(row=>row.map(cell=>{const raw=cell==null?'':cell instanceof Date?cell.toISOString().slice(0,10):String(cell);return /["\t\r\n]/.test(raw)?'"'+raw.replace(/"/g,'""')+'"':raw;}).join('\t')).join('\n');
}
const dimensionHeader=/^(门店|门店名称|门店全称|门店名|店名|门店编号|范围|渠道(?:名称)?|账号(?:名称)?|店铺(?:名称)?|项目|store|storeName|storeId)$/;
export function isBrandedPlatformTotal(matrix:unknown[][],header:number,sheet:string){
 if(sheet!=='meituan'&&sheet!=='douyin')return false;
 const title=matrix.slice(0,header).flat().join(''),labels=operatingLeafLabels(matrix,header);
 return title.includes(sheet==='meituan'?'美团':'抖音')&&/平台(?:数据|总盘|汇总)/.test(title)&&labels.includes('日期')&&!labels.some(s=>dimensionHeader.test(s)||s==='名称');
}
export function prepareOperatingFileRows(matrix:unknown[][],headerRow:number,options:OperatingPasteOptions,sourceRows?:ReadonlyMap<unknown[],number>){
 if(!matrix[headerRow]?.length)throw Error('请选择正确表头行');
 const header=operatingLeafLabels(matrix,headerRow);
 header.forEach(assertOperatingYuanUnit);
 const dateHeader=/^(日期|填报日期|业务日期|统计日期|数据日期|发生日期|成交日期|date)$/i;
 const dates=header.map((h,index)=>dateHeader.test(h)?index:-1).filter(i=>i>=0);
 if(dates.length>1)throw Error('存在多个日期列，请只保留本次汇报的业务日期列');
 const dateIndex=dates[0]??-1,explicitDimension=header.findIndex(h=>dimensionHeader.test(h));
 const dimensionIndex=explicitDimension>=0?explicitDimension:options.sheet==='douyin-stores'?header.indexOf('名称'):-1;
 for(const h of header)if(!dateHeader.test(h)&&/日期|时间|月份|月度|周期|截止|截至|周次|period|month|week/i.test(h))throw Error('源表包含期间或累计截止列“'+h+'”，请明确为单日业务日期或改用对应累计明细表，不能忽略后当作当日数据');
 const platform=options.sheet==='meituan'||options.sheet==='douyin';
 if(platform&&dimensionIndex<0&&(options.stores.length!==1||options.stores[0].id!=='all'))throw Error('源表没有门店列。如为平台日总盘，请选择「只有平台总数」后导入。');
 const douyinLabels:Record<string,string>={'成交金额':'下单金额','成交券数':'下单券数','退款券数':'退款订单数','新增好评数':'新增好评','新增中差评数':'新增中差评','消耗':'推广花费'};
 const sharedIndex=options.sheet==='douyin-stores'?header.indexOf('全平台累计消耗'):-1;
 let sharedAdSpend:number|undefined;
 const fields=operatingFields(options.sheet,options.template),ignoredColumns:string[]=[],columns:{index:number;label:string;count:boolean}[]=[];
 header.forEach((label,index)=>{if(index===dateIndex||index===dimensionIndex||index===sharedIndex)return;const name=label.replace(/[（(]元[）)]$/,'').trim();const field=matchOperatingField(label,fields)??(options.sheet==='douyin-stores'&&Object.hasOwn(douyinLabels,name)?matchOperatingField(douyinLabels[name],fields):undefined)??(platform?platformImportField(label,options.sheet,fields):undefined);if(field)columns.push({index,label:field.label,count:field.kind==='count'});else if(label)ignoredColumns.push(label);});
 if(!columns.length){
  const sample=header.filter(Boolean).slice(0,6).join('、')||'空白';
  throw Error('第'+(headerRow+1)+'行读到“'+sample+'”，没有匹配当前模板。请选有“'+fields.slice(0,5).map(f=>f.label).join('、')+'”等指标的那一行。若识别结果是乱码或金额缺小数点，请对照原图修改，或改用 Excel。');
 }
 let skippedOtherDates=0,skippedSummaryRows=0,skippedNotes=0;const rows:unknown[][]=[];

 const rowNumbers:number[]=[];
 for(const [index,row] of matrix.slice(headerRow+1).entries()){
  const rowNumber=sourceRows?.get(row)??headerRow+index+2;
  if(!row.some(v=>v!=null&&String(v).trim()))continue;
  if(isOperatingReportNote(row)){skippedNotes++;continue;}
  const token=String(row[dimensionIndex>=0?dimensionIndex:dateIndex>=0?dateIndex:0]??'').trim();
  const onlyLabel=row.filter(v=>v!=null&&String(v).trim());
  if(dateIndex>=0&&!String(row[dateIndex]??'').trim()&&onlyLabel.length===1&&/^(合计|总计|小计|汇总)$/.test(String(onlyLabel[0]).trim())&&!options.stores.some(s=>s.name===onlyLabel[0])){skippedSummaryRows++;continue;}
  const configuredSummary=options.stores.some(s=>s.id===token||s.name===token);
  if(!configuredSummary&&[token,...(dateIndex>=0?[String(row[dateIndex]??'').trim()]:[])].some(s=>/^(?:合计|总计|小计|月度|汇总|第\s*(?:\d+|[一二三四五六七八九十]+)\s*周(?:小计|合计)?)$/.test(s))){if(sharedIndex>=0){const amount=parseOperatingInput(String(row[sharedIndex]??''),'money');if(amount==null||sharedAdSpend!==undefined)throw Error('请核对合计行的全平台累计消耗');sharedAdSpend=amount;}skippedSummaryRows++;continue;}
  if(sharedIndex>=0&&String(row[sharedIndex]??'').trim())throw Error('全平台累计消耗只填写在合计行，不能同时计入某家门店。');
  if(dateIndex>=0){let businessDate:string;try{businessDate=operatingImportDate(row[dateIndex],options.date);}catch{throw Error('预览表第'+rowNumber+'行日期列的「'+(String(row[dateIndex]??'').trim().slice(0,50)||'空白')+'」无法识别，请核对这行的业务日期。');}if(businessDate!==options.date){skippedOtherDates++;continue;}}
  if(platform&&dateIndex>=0&&columns.every(c=>!String(row[c.index]??'').trim()))continue;
  const rawDimension=dimensionIndex>=0?row[dimensionIndex]:options.template?.dimension==='total'?'全项目':options.stores.length===1?options.stores[0].name:undefined;
  const dimension=options.template?.dimension==='total'&&['全平台','全项目','all'].includes(String(rawDimension).trim())?'全项目':rawDimension;
  if(dimension===undefined)throw Error('按门店或渠道填写时，源表须包含对应名称列');
  if(platform&&['全平台','全项目','all'].includes(String(dimension).trim())&&!options.stores.some(s=>s.id==='all'))throw Error('这张表是平台总数，请切换「只有平台总数」再导入。');
  rowNumbers.push(rowNumber);
  rows.push([dimension,...columns.map(c=>{const v=row[c.index];return c.count&&typeof v==='string'&&/^\d+\.0+$/.test(v.trim())?v.trim().split('.')[0]:v;})]);
 }
 if(!rows.length)throw Error('表格中没有所选日期的数据，请核对日期');
 if(dimensionIndex<0&&rows.length>1)throw Error('没有门店或日期区分的多行数据不能自动合并为单日累计，请整理后导入');
 let prefix=matrix.slice(0,headerRow).flat().filter(v=>v!=null).map(String).join(' ');
 if(options.sheet==='douyin-stores'){const period=douyinScreenshotPeriod(prefix,options.date);if(period){assertOperatingYuanUnit(prefix);prefix='抖音门店累计 '+period.start+' 至 '+period.end;}}
 if(platform&&dateIndex>=0){
  const coverage=/^每日(?:数据|明细)\s*(\d{4}-\d{2}-\d{2})\s*(?:至|到)\s*(\d{4}-\d{2}-\d{2})(?:\s*[（(]来源[:：][^（）()\n]+[）)])?$/.exec(prefix.trim());
  if(coverage){assertOperatingYuanUnit(prefix);const start=operatingImportDate(coverage[1]),end=operatingImportDate(coverage[2]);if(options.date<start||options.date>end)throw Error('所选业务日期不在每日明细的标题区间内');prefix='填报日期 '+options.date;}

  prefix=prefix.replace(/(?:(\d{4})年)?(\d{1,2})月(?=平台数据)/g,(_,year,month)=>{if((year&&year!==options.date.slice(0,4))||Number(month)!==Number(options.date.slice(5,7)))throw Error('表题月份与业务日期不一致');return '';});
 }
 const table:unknown[][]=[...(prefix?[[prefix]]:[]),['范围',...columns.map(c=>c.label)],...rows];
 if(sharedIndex>=0&&sharedAdSpend===undefined)throw Error('请保留合计行的全平台累计消耗。');
 if(sharedAdSpend!==undefined)table.push(['全平台累计消耗（元）',(sharedAdSpend/100).toFixed(2)]);
 let text=operatingTableText(table);const preview=previewOperatingPaste(text,options,rowNumbers);
 if(preview.storeMatches?.length){const names=new Map(preview.storeMatches.map(s=>[s.source,s.target]));for(const row of rows)row[0]=names.get(String(row[0]).trim())??row[0];text=operatingTableText(table);}
 return{text,sharedAdSpend,skippedNotes,storeMatches:preview.storeMatches??[],ignoredColumns:[...new Set(ignoredColumns)],skippedOtherDates,skippedSummaryRows};
}
