import type {OperatingSheet,OperatingTemplate,OperatingStore} from '../../cloud/company/operating-model.ts';
import {operatingFields} from './operating-data.ts';
import {platformImportField} from './operating-paste.ts';
import {findRevenueStoreHeader} from './operating-import-layout.ts';
import {normalizeDailyReportRows} from './operating-row-layout.ts';
import {operatingLeafLabels} from './operating-template-inference.ts';
import {isIdentifierColumn} from './operating-field-dictionary.ts';

export type UploadSource={name:string;tab:string;rows:unknown[][];header:number;image:boolean;file?:File};
export type Destination={sheet:OperatingSheet;name:string;template?:OperatingTemplate};
const text=(v:unknown)=>String(v??'').trim();
const dimension=/^(门店(?:名称|名)?|店名|渠道(?:名称)?|范围|名称|账号(?:名称)?|店铺名称)$/;
const identity=(v:string)=>dimension.test(v)||isIdentifierColumn(v)||/日期|时间|备注|说明|星期|^周$|^date$/i.test(v);
const generic=/^(?:sheet\d*|工作表\d*|业务明细|门店汇总|明细|截图|报表|(?:粘贴的截图|微信图片|屏幕截图|screenshot|image|img|clipboard|codex-clipboard)[\d\s_.()-]*|(?:codex-)?clipboard-.*)$/i;
function stable(s:string){return s.replace(/\.(png|jpe?g|webp|xlsx|csv|tsv|txt)$/i,'').replace(/\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}月(?:\d{1,2}日)?/g,'').trim();}
export function inspectUpload(source:UploadSource,options:Destination[],stores:OperatingStore[],reference:string){
 const normalized=normalizeDailyReportRows(source.rows,source.header,reference);
 const {rows,header}=normalized;
 const labels=operatingLeafLabels(rows,header).map(text);
 const title=rows.slice(0,header).filter(r=>r.filter(v=>text(v)).length===1).flat().map(text).filter(Boolean);
 const names=[...title,source.tab,source.name].map(stable).filter(s=>s&&!generic.test(s)&&!/^统计口径|^数据口径|^说明[：:]|^[\d\s_.-]+$/i.test(s));
 const context=names.join(' ');
 const brands=['美团','抖音'].filter(v=>context.includes(v));
 const horizontal=findRevenueStoreHeader(rows,{stores,date:reference},header)>=0;
 const rowStores=labels.some(s=>dimension.test(s));
 const dated=labels.some(s=>/日期|^date$/i.test(s));
 const period=/累计|截至|月报|周报|汇总/.test(context);
 const measures=labels.filter(v=>v&&!identity(v)&&!/率|ROI|ROAS|合计|小计|总计|投产比/i.test(v));
 const unnamedNumbers=labels.some((label,col)=>!label&&rows.slice(header+1,header+10).some(r=>/^[-+￥¥]?[\d,.]+%?$/.test(text(r[col]))));
 const cumulativeOnly=!dated&&!horizontal&&/累计|截至|周报|月报/.test(context);
 const candidates=options.flatMap(option=>{
  const s=option.sheet,platform=s.startsWith('meituan')?'美团':s.startsWith('douyin')?'抖音':'';
  if(cumulativeOnly&&!s.endsWith('-stores')&&s!=='targets')return [];
  if(platform&&brands.length===1&&platform!==brands[0])return [];
  if(horizontal)return (s==='revenue'||s==='targets')?[{option,score:s==='targets'?1:2,exact:false}]:[];
  if(s.endsWith('-stores')&&dated&&!period||platform&&!s.endsWith('-stores')&&period&&!dated)return [];
  const fields=operatingFields(s,option.template),matched=new Set<string>();
  for(const label of measures){const field=platformImportField(label,s,fields);if(field)matched.add(field.key);}
  if(!matched.size)return [];
  const shapeFits=!option.template||(option.template.dimension==='store')===rowStores;
  const named=names.some(n=>n===option.name);
  const full=!unnamedNumbers&&matched.size===measures.length&&fields.filter(f=>f.required).every(f=>matched.has(f.key));
  const platformPeriod=s.endsWith('-stores')?rowStores&&!dated:dated&&!rowStores;
  const evidence=platform?brands.length===1&&platformPeriod:shapeFits&&(!period||dated)&&(named||!brands.length&&matched.size>=2);
  return [{option,score:matched.size+(named?20:0)+(platform&&brands.length===1?8:0),exact:full&&!!evidence}];
 }).sort((a,b)=>b.score-a.score);
 const exact=candidates.filter(x=>x.exact);
 const automatic=exact.length===1&&(candidates.length===1||exact[0].score>Math.max(...candidates.filter(x=>x!==exact[0]).map(x=>x.score)))?exact[0].option:undefined;
 return {source:{...source,rows,header},automatic,dated,cumulativeOnly,candidates:candidates.map(c=>c.option),horizontal,
  identity:names.length?JSON.stringify(names):'',signature:JSON.stringify([labels,dated,rowStores,horizontal,period])};
}
export function destinationSignature(option:Destination){
 return JSON.stringify([option.sheet,option.name,option.template?.dimension,operatingFields(option.sheet,option.template).map(f=>[f.key,f.label,f.kind,f.required,f.definition]),option.template?.metrics]);
}
