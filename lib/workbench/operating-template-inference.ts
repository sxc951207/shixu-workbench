import type {OperatingMetric} from '../../cloud/company/operating-model.ts';
import {analyzeOperatingHeader,type HeaderAnalysis} from './operating-field-selection.ts';
import {assertOperatingYuanUnit,isIdentifierColumn,operatingFieldDefinition} from './operating-field-dictionary.ts';
import {operatingTemplatePresets} from './operating-templates.ts';

const text=(value:unknown)=>String(value??'').replace(/[\r\n]+/g,'').trim();
const dateColumn=/^(?:(?:业务|统计|发生|成交|数据|填报)?日期|date)$/i;
const dimension=/^(?:门店(?:名称|名)?|店名|渠道(?:名称)?|账号(?:名称)?|店铺(?:名称)?|范围)$/;
const summary=/^(?:总计|合计|小计|汇总|月度|月总业绩目标|月目标|第\s*\d+\s*周(?:合计|小计)?|(?:本周|本月|月度|当月|全部|全店|全平台)(?:合计|小计|汇总|总计))$/;
const technical=(s:string)=>summary.test(s)||/^(?:星期|周几)$/.test(s);
const isDay=(v:unknown)=>v instanceof Date||/^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}\/\d{1,2}\/\d{4})$/.test(text(v));
const headerText=(v:unknown)=>typeof v==='string'&&!!text(v)&&!isDay(v)&&!/^[-+]?\d[\d,.%]*$/.test(text(v));
const storeName=/(?:门店|店|院区|分院)[)）]?$/;

function headerIndex(rows:unknown[][]){
 let best=-1,score=0;
 for(const [index,row] of rows.slice(0,30).entries()){
  const populated=row.filter(v=>text(v)!=='');
  if(!populated.length||!populated.every(headerText))continue;
  const labels=populated.map(text);
  const unique=new Set(labels);
  const next=rows[index+1]||[];
  const upper=rows[index-1]||[];
  const inheritedDimensions=upper.filter((v,i)=>!text(row[i])&&(dateColumn.test(text(v))||dimension.test(text(v)))).length;
  const measures=labels.filter(s=>/金额|营收|业绩|花费|券数|成交数|人数|率|次数|ROI/i.test(s)).length;
  const dimensions=labels.filter(s=>dateColumn.test(s)||dimension.test(s)).length+inheritedDimensions;
  const scoreHere=unique.size*2+labels.length+measures+dimensions*3+
   (next.some(v=>typeof v==='number'||isDay(v))?4:0);
  if(scoreHere>score){score=scoreHere;best=index;}
 }
 if(best<0)throw Error('未找到指标表头，请手动选择表头行。');
 return best;
}

function horizontalStores(rows:unknown[][],index:number,labels:string[]){
 if(!dateColumn.test(labels[0]))return null;
 const possible=labels.slice(1).filter(s=>s&&!technical(s));
 const titles=rows.slice(0,index).flat().map(text).join(' ');
 const columnHints=rows.slice(index+1,index+4).filter(row=>!isDay(row[0])).flat().map(text);
 const candidates=possible.filter(s=>storeName.test(s));
 if(!possible.length||candidates.length!==possible.length){
  if(candidates.length>=2&&candidates.length>possible.length/2&&(/总业绩|营业额|销售额|营收/.test(titles)||columnHints.includes('每日业绩'))){
   const unknown=possible.filter(s=>!storeName.test(s));
   throw Error('这张表像是门店横排，请对照原表核对列名“'+unknown.join('、')+'”，确认门店和合计列后再生成。');
  }
  return null;
 }
 if(new Set(possible).size!==possible.length||possible.length>30)throw Error('门店表头有重名或超过30家，请核对。');
 if(/目标|累计|预算/.test(titles)&&!columnHints.includes('每日业绩'))throw Error('表题表示目标或累计，请先核对指标的统计周期。');
 if(!/(?:总业绩|营业额|销售额|营收)/.test(titles)&&!columnHints.includes('每日业绩'))throw Error('识别到门店横排，请在表头或标题写明所报指标，例如“每日业绩”。');
 assertOperatingYuanUnit([titles,...labels,...columnHints].join(' '));
 const field={key:'revenue',label:'门店总业绩',kind:'money' as const,required:true};
 return {fields:[{...field,definition:operatingFieldDefinition(field)}],computedColumns:[],textColumns:[],dimension:{label:'门店',names:possible}};
}

// A merged parent only disambiguates a repeated leaf. Keep ordinary headers
// such as “核销金额” intact so matching never depends on a decorative group.
export function operatingLeafLabels(rows:unknown[][],index:number){
 const leaf=rows[index].map(text);
 if(!index)return leaf;
 const upper=rows[index-1];
 if(!upper.every(v=>!text(v)||headerText(v))||upper.filter(v=>text(v)).length<2)return leaf;
 const duplicates=new Set(leaf.filter((v,i)=>v&&leaf.indexOf(v)!==i));
 let parent='';
 return Array.from({length:Math.max(leaf.length,upper.length)},(_,i)=>{
  if(text(upper[i]))parent=text(upper[i]);
  assertOperatingYuanUnit(parent);
  const label=leaf[i];
  if(!label)return dateColumn.test(text(upper[i]))||dimension.test(text(upper[i]))?text(upper[i]):'';
  return duplicates.has(label)&&parent?parent+'·'+label:label;
 });
}

const platformMetrics:OperatingMetric[]=[
 {key:'verificationRate',label:'核销率',numerator:'verifiedCoupons',denominator:'orderedCoupons',format:'percent'},
 {key:'refundRate',label:'退单率',numerator:'refundOrders',denominator:'orderedCoupons',format:'percent'},
 {key:'positiveRate',label:'有效好评率',numerator:'positiveReviews',denominator:'verifiedCoupons',format:'percent'},
 {key:'verifiedRoi',label:'核销ROI',numerator:'verifiedAmount',denominator:'adSpend',format:'ratio'},
 {key:'orderRoi',label:'下单ROI',numerator:'orderAmount',denominator:'adSpend',format:'ratio'},
];

export function inferOperatingTemplate(rows:unknown[][],headerOverride?:number):{
 headerRow:number;analysis:HeaderAnalysis;metrics:OperatingMetric[];notes:string[];suggestedName?:string;
}{
 if(!rows.length)throw Error('工作表为空。');
 const index=headerOverride??headerIndex(rows);
 if(!Number.isInteger(index)||index<0||index>=rows.length)throw Error('请选择正确的表头行。');
 const labels=rows[index].map(text);
 const stores=horizontalStores(rows,index,labels);
 if(stores)return {headerRow:index,analysis:stores,metrics:[],suggestedName:'门店总业绩',notes:['识别为门店横排，总计、目标和完成率均未当作门店。请核对是否与项目已有总业绩表重复。']};
 const fields=operatingLeafLabels(rows,index);
 const title=rows.slice(0,index).find(row=>row.filter(v=>text(v)).length===1)?.map(text).find(Boolean);
 if(title)assertOperatingYuanUnit(title);
 const data=rows.slice(index+1).filter(row=>!row.slice(0,2).some(v=>summary.test(text(v))));
 const analysis=analyzeOperatingHeader([fields,...data],0);
 if(!analysis.fields.length)throw Error('没有识别到可填指标，请选择包含指标名称的表头行。');
 const keys=new Set(analysis.fields.map(f=>f.key)),metrics:OperatingMetric[]=[],notes:string[]=[];
 const known=[...operatingTemplatePresets().flatMap(t=>t.metrics),...platformMetrics];
 for(const column of analysis.computedColumns){
  const label=column==='团单核销率'?'核销率':column;
  const matches=known.filter(m=>m.label===label&&keys.has(m.numerator)&&keys.has(m.denominator));
  const formulas=new Set(matches.map(m=>[m.numerator,m.denominator,m.format].join('/')));
  if(matches.length&&formulas.size===1&&!metrics.some(m=>m.key===matches[0].key))metrics.push({...matches[0],label:column});
  else notes.push('请核对“'+column+'”的分子、分母；暂未生成公式。');
 }
 if(data.length<rows.length-index-1)notes.push('已排除小计、合计和汇总行。');
 if(title&&/累计|至|周报|月报/.test(title))notes.push('源表可能是期间累计。此处仅提取指标；填报累计金额时，请使用对应期间和实际截止日。');
 return {headerRow:index,analysis,metrics,notes,...(title&&title.length<=60?{suggestedName:title}:{})};
}

/** Check columns that carry numbers even when OCR loses their headings. */
export function inferScreenshotTemplate(rows:unknown[][],header:number){
 const labels=operatingLeafLabels(rows,header);
 const missing=labels.flatMap((label,column)=>{
  const samples=rows.slice(header+1).map(row=>text(row[column])).filter(Boolean);
  return !label&&samples.some(v=>/^[-+￥¥]?[\d,.]+%?$/.test(v))?[column+1]:[];
 });
 if(missing.length)throw Error('第 '+missing.join('、')+' 列有数值，但表头为空。请对照原图补上列名，或移除无需导入的列。');
 const result=inferOperatingTemplate(rows,header);
 if(result.suggestedName==='门店总业绩'&&result.analysis.dimension?.label==='门店'&&result.analysis.fields.length===1&&dateColumn.test(labels[0]))return result;
 const uncertain=labels.flatMap((label,column)=>{
  if(!result.analysis.textColumns.includes(label)||isIdentifierColumn(label)||dimension.test(label)||dateColumn.test(label)||/周|日期|时间|备注|月份|姓名|联系人|电话|地址|账号|负责人/.test(label))return [];
  const samples=rows.slice(header+1).map(row=>text(row[column])).filter(Boolean);
  const count=samples.filter(v=>/^[-+￥¥]?[\d,.]+%?$/.test(v)).length;
  return count>=2&&count>=samples.length*.7?['第 '+(column+1)+' 列「'+label+'」']:[];
 });
 if(uncertain.length)throw Error(uncertain.join('、')+' 含数值，但未能识别为指标。请核对列名和单位，或移除无需导入的列。');
 return result;
}
