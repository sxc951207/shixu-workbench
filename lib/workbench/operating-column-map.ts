import type {OperatingField,OperatingSheet,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingFields} from './operating-data.ts';
import {platformImportField} from './operating-paste.ts';
import {operatingLeafLabels} from './operating-template-inference.ts';
import {assertOperatingYuanUnit,isIdentifierColumn} from './operating-field-dictionary.ts';

function assertDailySource(labels:string[],fields:OperatingField[]){
 const has=(re:RegExp)=>labels.some(label=>re.test(label));
 if(has(/客资ID|线索ID|客户ID/i)&&has(/手机号|手机号码|联系电话/)&&has(/获取时间|跟进状态/))
  throw Error('这张表是逐条客资明细。请先按获取日期和本项目的去重规则汇总线索数，再导入日表。手机号和客资ID不作为数量。');
 if(has(/商品代码|商品条码|SKU/i)&&has(/仓库|库位/)&&has(/可销数|可用库存/)&&!fields.some(f=>/库存|可销数/.test(f.label)))
  throw Error('这张表记录各商品的库存。请使用订单或销售日报填报成交指标；库存请使用对应的库存模板。');
}
export type ColumnRules=Record<string,string>;
export function identifyColumns(matrix:unknown[][],header:number,sheet:OperatingSheet,template?:OperatingTemplate){
 const fields=operatingFields(sheet,template),labels=operatingLeafLabels(matrix,header);
 assertDailySource(labels,fields);
 const candidates:string[]=[],used=new Set<string>();
 const data=matrix.slice(header+1);
 for(const [i,label] of labels.entries()){
  if(isIdentifierColumn(label))continue;
  if(!label||label==='全平台累计消耗')continue;
  const known=platformImportField(label,sheet,fields);
  if(known){used.add(known.key);continue;}
  if(/日期|时间|星期|周期|月份|编号|编码|序号|名称|备注|范围|门店|渠道|账号|百分|率|ROI|合计|总计|^(?:ID|周|项目|date)$/i.test(label))continue;
  if(data.some(row=>typeof row[i]==='number'||/^\s*-?\d[\d,.]*\s*$/.test(String(row[i]??''))))candidates.push(label);
 }
 const available=fields.filter(f=>!used.has(f.key));
 // A complete business template already has all source metrics it needs.
 if(!available.length)return;
 if(!candidates.length)return;
 const signature=JSON.stringify([labels.filter(Boolean).sort(),fields.map(f=>[f.key,f.label,f.kind,f.definition||'']).sort()]);
 return {candidates:[...new Set(candidates)],available,labels,signature};
}
export function applyColumnRules(matrix:unknown[][],header:number,info:NonNullable<ReturnType<typeof identifyColumns>>,rules:ColumnRules){
 const fields=new Map(info.available.map(f=>[f.key,f]));
 const used=new Set<string>();
 const labels=info.labels.map(label=>{
  if(!info.candidates.includes(label))return label;
  const key=Object.hasOwn(rules,label)?rules[label]:undefined;
  if(key===undefined)throw Error('请确认“'+label+'”对应哪个指标，或选择跳过。');
  if(key==='')return label;
  const field=fields.get(key);if(!field)throw Error('项目指标已变化，请重新核对列对应。');
  assertColumnUnit(label,field);
  if(used.has(key))throw Error('有两列同时对应“'+field.label+'”，请指定唯一来源。');
  used.add(key);return field.label;
 });
 return matrix.map((r,i)=>i===header?labels:r);
}
function assertColumnUnit(label:string,field:OperatingField){
 assertOperatingYuanUnit(label);
 const unit=label.match(/[（(]\s*(元|张|单|次|人|个|星)\s*[）)]$/)?.[1];
 if(unit&&(unit==='元'?'money':unit==='星'?'stars':'count')!==field.kind)throw Error('“'+label+'”的单位与“'+field.label+'”不同，请核对原表。');
}
