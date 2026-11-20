import {isOperatingReportNote} from './operating-report-note.ts';
import {matchImportStore} from './operating-store-match.ts';
import type {OperatingSheet,OperatingStore,OperatingRow,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingDate,operatingFields,operatingRatios,operatingTemplateMetrics,parseOperatingInput} from './operating-data.ts';
import {assertOperatingYuanUnit} from './operating-field-dictionary.ts';
import type {OperatingMetricValue} from './operating-templates.ts';

export type OperatingPasteOptions={sheet:OperatingSheet;date:string;stores:OperatingStore[];template?:OperatingTemplate;storeAliases?:ReadonlyMap<string,string>};
export type OperatingPastePreview={sharedAdSpend?:number;rows:OperatingRow[];columns:string[];missingStores:string[];storeMatches?:{source:string;target:string}[];ignoredColumns?:string[];skippedSummaryRows?:number};
const aliases:Record<string,string[]>={revenue:['总业绩','门店总业绩','营业额','业绩'],target:['月目标','目标'],orderedCoupons:['下单券数','下单数量'],orderAmount:['下单金额'],verifiedCoupons:['核销券数','核销数量'],verifiedAmount:['核销金额'],refundOrders:['退款订单数','退款订单量','退款单数','退款订单','退单量'],refundAmount:['退款金额'],adSpend:['推广花费','推广消耗','推广通消耗金额','广告花费','推广费','广告费'],positiveReviews:['新增好评','新增好评数'],stars:['星级','星级评分','美团星级']};
const headerUnit=/[（(]\s*(元|张|单|次|人|个|条|星)\s*[）)]$/;
const headerName=(value:string)=>value.trim().replace(/^'(?=[=+@-])/,'').replace(headerUnit,'').trim();
const meituanColumnNames:Record<string,string>={'商家优惠后核销额':'核销金额','下单售价金额':'下单金额','退款售价金额':'退款金额','退单量':'退款订单数','自然曝光次数':'自然曝光','cpc曝光次数':'付费曝光','在线咨询人数':'咨询数','在线咨询留资人数':'线索数'};
const douyinStoreColumns:Record<string,string>={'成交金额':'下单金额','成交券数':'下单券数','退款券数':'退款订单数','新增好评数':'新增好评','新增中差评数':'新增中差评','消耗':'推广花费'};
const douyinColumnNames:Record<string,string>={'门店访问':'进店次数','门店访问次数':'进店次数','门店访问/次':'进店次数','门店访问人':'进店人数','门店访问人数':'进店人数','进入私信人':'私信咨询人数','进入私信人数':'私信咨询人数','私信开口人':'私信开口人数','私信线索人':'私信留资人数','私信线索人数':'私信留资人数'};
function singlePlatform(text:string){
 const brands=['抖音','美团'].filter(brand=>text.includes(brand));
 return brands.length===1?brands[0]:undefined;
}
export function importPlatformConflict(matrix:unknown[][],header:number,sheet:OperatingSheet,template?:OperatingTemplate,tab=''){
 const titles=matrix.slice(0,header).map(row=>row.filter(v=>String(v??'').trim())).filter(row=>row.length===1).flat().join(' ');
 const source=singlePlatform(/美团|抖音/.test(titles)?titles:tab);
 const target=sheet.startsWith('douyin')?'抖音':sheet.startsWith('meituan')?'美团':singlePlatform(template?.name??'');
 if(source&&target&&source!==target)return '原表标明「'+source+'」，当前选的是「'+target+'」。请返回选择同平台的报表，再读取预览。';
}
export function platformImportField(label:string,sheet:string,fields:ReturnType<typeof operatingFields>){
 const direct=matchOperatingField(label,fields);if(direct)return direct;
 const name=label.replace(/\s/g,'').replace(/[（(]元[）)]$/,'').toLowerCase();
 if(sheet==='douyin-stores'&&Object.hasOwn(douyinStoreColumns,name))return matchOperatingField(douyinStoreColumns[name],fields);
 if(sheet==='douyin'&&Object.hasOwn(douyinColumnNames,name))return matchOperatingField(douyinColumnNames[name],fields);
 if((sheet==='meituan'||sheet==='meituan-stores')&&Object.hasOwn(meituanColumnNames,name))return matchOperatingField(meituanColumnNames[name],fields);
}
export function matchOperatingField(label:string,fields:ReturnType<typeof operatingFields>){
 assertOperatingYuanUnit(label);
 const name=headerName(label),exact=fields.filter(f=>f.key===name||headerName(f.label)===name);
 const matches=exact.length?exact:fields.filter(f=>(aliases[f.key]||[]).includes(name));
 if(matches.length>1)throw Error('列名“'+label+'”匹配多个字段，请修改模板或表头以消除歧义');
 const field=matches[0],unit=label.trim().match(headerUnit)?.[1];
 if(field&&unit){
  const kind=unit==='元'?'money':unit==='星'?'stars':'count';
  if(kind!==field.kind)throw Error('表头“'+label+'”的单位与字段“'+field.label+'”不一致，请核对单位后导入');
 }
 return field;
}
const storeHeaders=new Set(['门店','门店名称','门店名','门店编号','范围','渠道','账号','店铺','项目','store','storeName','storeId']);
const platformMetricColumns=[{key:'verificationRate',label:'核销率',aliases:['核销率'],format:'percent' as const},{key:'refundRate',label:'退单率',aliases:['退单率','退款率'],format:'percent' as const},{key:'positiveRate',label:'有效好评率',aliases:['有效好评率','好评率'],format:'percent' as const},{key:'verifiedRoi',label:'核销ROI',aliases:['核销ROI','核销投产','核销投产比'],format:'ratio' as const},{key:'orderRoi',label:'下单ROI',aliases:['下单ROI','下单投产','下单投产比'],format:'ratio' as const}];
function computedHeaders(sheet:OperatingSheet,template?:OperatingTemplate){
 if(template)return new Set(template.metrics.flatMap(metric=>[metric.key,headerName(metric.label)]));
 if(!['meituan','douyin','meituan-stores','douyin-stores'].includes(sheet))return new Set<string>();
 return new Set(platformMetricColumns.filter(metric=>metric.key!=='positiveRate'||sheet.startsWith('meituan')||sheet==='douyin-stores').flatMap(metric=>[metric.key,...metric.aliases]));
}
function tabular(text:string):string[][]{
 const out:string[][]=[];let line:string[]=[],cell='',quoted=false,closed=false;
 const pushCell=()=>{line.push(cell);cell='';closed=false;};
 const pushLine=()=>{pushCell();if(line.some(v=>v.trim()))out.push(line);line=[];};
 const input=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(let i=0;i<input.length;i++){
  const char=input[i];
  if(quoted){if(char==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
  if(char==='\t'){pushCell();continue;}if(char==='\n'){pushLine();continue;}
  if(char==='"'&&!cell&&!closed){quoted=true;continue;}
  if(closed&&char.trim())throw Error('引号后的内容格式不正确');
  if(char==='"')throw Error('引号格式不正确');
  if(!closed)cell+=char;
 }
 if(quoted)throw Error('引号未闭合，请重新复制完整表格');
 if(cell||line.length||closed)pushLine();
 return out;
}
export function hasOperatingTitleRange(skeleton:string){return /DATE\s*(?:至|到|[-~—–～]|(?:to|until|through)\b)|(?:至|到|从|\bfrom\b|\bto\b|\buntil\b)\s*DATE/i.test(skeleton);}
export function checkTitleDate(title:string,date:string,sheet:OperatingSheet){
 if(!title.trim())return;
 assertOperatingYuanUnit(title);
 if(/(?:金额)?单位\s*[：:]?\s*(?:人民币)?(?:分|角)(?![\u4e00-\u9fff])/.test(title))throw Error('当前金额单位统一为元，请先换算并核对标题');
 const pattern=/(\d{4})\s*(?:[-/.年])\s*(\d{1,2})\s*(?:[-/.月])\s*(\d{1,2})\s*日?/g;
 const found=[...title.matchAll(pattern)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`),skeleton=title.replace(pattern,'DATE');
 const cumulative=/累计|月报|周报|本月|本周|截至|截止|区间|日期范围|时间范围/.test(title);
 const rangeMention=cumulative||hasOperatingTitleRange(skeleton);
 if(!found.length&&(/\d/.test(title)||rangeMention))throw Error('标题日期或范围无法核对，请写明完整起止日期，或仅复制无标题的数据表后核对预览');
 if(rangeMention&&found.length!==2)throw Error('标题累计范围缺少完整起止日期，请核对后再导入');
 if(found.length>2)throw Error('标题含多个日期范围，无法确认本次导入日期');
 found.forEach(d=>operatingDate(d));
 if(found.length===1&&found[0]!==date)throw Error('标题日期与所选截止日期不符');
 if(found.length===2){
  if(sheet.endsWith('-stores')){if(found[0]!==date.slice(0,7)+'-01'||found[1]!==date)throw Error('累计表标题范围必须从月初到所选截止日期，日期不符');}
  else if(found[0]!==date||found[1]!==date)throw Error('当前为单日事实表，不能导入多天累计范围；请改选对应门店累计表或复制当日数据');
 }
}
/** Returns a preview only. The caller must show the selected period and explicitly confirm before writing. */
export function previewOperatingPaste(text:string,{sheet,date,stores,template,storeAliases}:OperatingPasteOptions,sourceRowNumbers?:number[]):OperatingPastePreview{
 operatingDate(date);
 const generic=sheet.startsWith('tpl_');
 if(generic&&(!template||template.id!==sheet))throw Error('模板字段快照不完整，请重新打开表单');
 if(generic&&template?.dimension==='total')stores=[{id:'all',name:'全项目'}];
 if((sheet==='meituan'||sheet==='douyin')&&stores.length===1&&stores[0].id==='all')stores=[{id:'all',name:'全平台'}];
 if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>1048576)throw Error('表格不能超过1MiB，请分批复制数据');
 const lines=tabular(text);if(!lines.length)throw Error('请先从 Excel 复制包含表头的表格');
 const headerIndex=lines.findIndex(row=>storeHeaders.has(headerName(row[0]||'')));
 if(headerIndex<0||headerIndex>3)throw Error('首列须为“门店”，并包含字段表头');
 checkTitleDate(lines.slice(0,headerIndex).map(row=>row.join(' ')).join(' '),date,sheet);
 const fields=operatingFields(sheet,template),header=lines[headerIndex].map(label=>label.trim());
 if(header.length<2)throw Error('请同时复制门店与数据列');
 const ignoredColumns:string[]=[],knownMetrics=computedHeaders(sheet,template),seenColumns=new Set<string>(),columns=header.slice(1).map((label,index)=>{
  const field=matchOperatingField(label,fields);
  if(!field){if(knownMetrics.has(headerName(label))){ignoredColumns.push(label);return null;}throw Error('未知列：'+(label||'空白表头'));}
  if(seenColumns.has(field.key))throw Error('重复列：'+label);seenColumns.add(field.key);return{field,index:index+1};
 }).filter((column):column is {field:ReturnType<typeof operatingFields>[number];index:number}=>column!==null);
 if(!columns.length)throw Error('表格没有可导入的原始字段，请同时复制财务或数量字段');
 const byName=new Map<string,OperatingStore>(),byId=new Map<string,OperatingStore>();
 for(const store of stores){const name=store.name.trim();if(byName.has(name))throw Error('配置存在重名门店，名称不唯一，请使用不重复名称后再导入');byName.set(name,store);byId.set(store.id,store);}
 const storeMatches:{source:string;target:string}[]=[];
 const seenStores=new Set<string>(),rows:OperatingRow[]=[];let skippedSummaryRows=0;
 let sharedAdSpend:number|undefined;const data=lines.slice(headerIndex+1);if(!data.length)throw Error('表格里没有门店数据');
 for(const [index,cells] of data.entries()){
  const rowNumber=sourceRowNumbers?.[index]??headerIndex+index+2;
  const rowError=(message:string)=>Error(date+' · 预览表第'+rowNumber+'行 · '+message);
  if(sheet==='douyin-stores'&&cells[0]==='全平台累计消耗（元）'&&cells.length===2){const value=parseOperatingInput(cells[1],'money');if(value==null||sharedAdSpend!==undefined)throw Error('请核对全平台累计消耗');sharedAdSpend=value;continue;}
  if(isOperatingReportNote(cells))continue;
  const token=cells[0].trim(),exact=byName.get(token)||byId.get(token)||byName.get(token.replace(/^'(?=[=+@-])/,''));
  if(!exact&&(token==='合计'||token==='总计')){skippedSummaryRows++;continue;}
  if(cells.length!==header.length)throw rowError('列数与表头不一致，请复制完整矩形区域');
  const store=exact??matchImportStore(token,stores,storeAliases);
  if(!exact)storeMatches.push({source:token,target:store.name});
  if(seenStores.has(store.id))throw rowError('重复门店：'+store.name);seenStores.add(store.id);
  const values:Record<string,number|null>=Object.fromEntries(fields.map(f=>[f.key,null]));
  columns.forEach(({field,index})=>{
   let value=cells[index].trim();
   if(/^[=+@]/.test(value))throw rowError(store.name+' / '+field.label+'：不接受公式，请粘贴计算后的数值');
   if(value.includes(',')){
    const valid=field.kind==='money'?/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(value):field.kind==='count'&&/^\d{1,3}(,\d{3})+$/.test(value);
    if(!valid)throw rowError(store.name+' / '+field.label+'：数值格式不正确');
    value=value.replace(/,/g,'');
   }
   try{values[field.key]=parseOperatingInput(value,field.kind);}catch(e){throw rowError(store.name+' / '+field.label+'：'+(e as Error).message);}
  });
  rows.push({storeId:store.id,storeName:store.name,values});if(rows.length>30)throw Error('门店行数不能超过30行');
 }
 if(!rows.length)throw Error('表格里没有可导入的门店数据，仅有合计行');
 if(sharedAdSpend!==undefined&&rows.some(r=>r.values.adSpend!=null))throw Error('全平台累计消耗不能与分门店消耗重复填报');
 return{rows,...(sharedAdSpend!==undefined?{sharedAdSpend}:{}),...(storeMatches.length?{storeMatches}:{}),columns:columns.map(column=>column.field.key),missingStores:stores.filter(s=>!seenStores.has(s.id)).map(s=>s.name),ignoredColumns:[...new Set(ignoredColumns)],skippedSummaryRows};
}
export function blankOperatingTsv({sheet,date,stores,template}:OperatingPasteOptions):string{
 operatingDate(date);const fields=operatingFields(sheet,template);
 if(template?.dimension==='total')stores=[{id:'all',name:'全项目'}];
 const safe=(value:string)=>{if(/[\u0000-\u001f\u007f]/.test(value))throw Error('名称含控制字符或换行，请先修改名称再下载模板');let text=/^\s*[=+@-]/.test(value)?"'"+value:value;if(text.includes('"'))text='"'+text.replace(/"/g,'""')+'"';return text;};
 const title=sheet.endsWith('-stores')?'月初累计 '+date.slice(0,7)+'-01 至 '+date:'填报日期 '+date;
 const lines=[[title],[stores.length===1&&stores[0].id==='all'?'范围':'门店',...fields.map(f=>f.label)],...stores.map(store=>[store.name,...fields.map(()=> '')])];
 return '\uFEFF'+lines.map(row=>row.map(safe).join('\t')).join('\r\n')+'\r\n';
}
export function formatOperatingInput(value:number|null|undefined,kind:'money'|'count'|'stars'):string{
 if(value==null)return'';if(kind!=='money')return String(value);
 if(!Number.isSafeInteger(value)||value<0)throw Error('金额超出安全范围，原数据已保留，请核对');
 const cents=BigInt(value),unit=BigInt(100);return(cents/unit).toString()+'.'+(cents%unit).toString().padStart(2,'0');
}
/** Format signed integer cents without losing the last cent during conversion to yuan. */
export function formatOperatingMoney(value:number|null|undefined):string{
 if(value==null||!Number.isSafeInteger(value))return '—';
 const [whole,fraction]=formatOperatingInput(Math.abs(value),'money').split('.');
 return (value<0?'-':'')+BigInt(whole).toLocaleString('zh-CN')+'.'+fraction;
}
export function operatingTableTotals(rows:OperatingRow[],fields:{key:string;label:string;kind:'money'|'count'|'stars'}[],strict=false):Record<string,number|null>{
 return Object.fromEntries(fields.map(field=>{
  const values=rows.map(row=>row.values[field.key]);if(field.kind==='stars'||!values.length||values.every(value=>value==null)||(strict&&values.some(value=>value==null)))return[field.key,null];
  let total=0;for(const value of values){if(value==null)continue;if(!Number.isSafeInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER-total)throw Error(field.label+'合计超出安全整数范围，原数据已保留，请核对');total+=value;}
  return[field.key,total];
 }));
}
export function operatingTableMetrics(sheet:OperatingSheet,values:Record<string,number|null>,template?:OperatingTemplate):OperatingMetricValue[]{
 if(template)return template.dimension==='store'?operatingTemplateMetrics(template,values):[];
 if(sheet!=='meituan-stores'&&sheet!=='douyin-stores')return[];
 const ratios=operatingRatios(values);return platformMetricColumns.filter(metric=>metric.key!=='positiveRate'||sheet.endsWith('-stores')).map(metric=>({key:metric.key,label:metric.label,format:metric.format,value:ratios[metric.key as keyof typeof ratios]}));
}
