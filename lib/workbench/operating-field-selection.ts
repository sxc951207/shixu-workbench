import type {OperatingField,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingFields,operatingTemplatePresets} from './operating-data.ts';
import {assertOperatingYuanUnit,operatingFieldDefinition,isIdentifierColumn} from './operating-field-dictionary.ts';
import {matchOperatingField} from './operating-paste.ts';

export function operatingFieldCatalog():{name:string;fields:OperatingField[]}[]{
 const seen=new Set<string>();
 return [...operatingTemplatePresets().map(t=>({name:t.name,fields:t.fields})),{name:'门店与平台',fields:['revenue','targets','meituan','douyin'].flatMap(s=>operatingFields(s as any))}].map(group=>({...group,fields:group.fields.filter(field=>{if(seen.has(field.key))return false;seen.add(field.key);return true;}).map(f=>({...f,definition:f.definition||operatingFieldDefinition(f)}))}));
}
export function selectTemplateFields(template:OperatingTemplate,keys:string[]):OperatingTemplate{
 if(new Set(keys).size!==keys.length||keys.length>30)throw Error('字段重复或超过30个');
 const catalog=new Map(operatingFieldCatalog().flatMap(g=>g.fields).map(f=>[f.key,f]));
 for(const field of template.fields)catalog.set(field.key,field);
 const fields=keys.map(key=>{const field=catalog.get(key);if(!field)throw Error('未知字段');return{...field};});
 return{...template,fields,metrics:template.metrics.filter(m=>keys.includes(m.numerator)&&keys.includes(m.denominator)).map(m=>({...m}))};
}
export type HeaderAnalysis={fields:OperatingField[];computedColumns:string[];textColumns:string[];dimension?:{label:string;names:string[]}};
const dimensionName=/^(?:门店(?:名称|名)?|店名|渠道(?:名称)?|账号(?:名称)?|店铺(?:名称)?|范围)$/;
function isIdentity(label:string){
 return isIdentifierColumn(label)||dimensionName.test(label)||/^(日期|时间|月份|月度|周|星期|范围|备注|说明|姓名|客户|负责人|联系人|填报人|项目|项目名|项目名称)$/i.test(label)||
  /(?:日期|时间|编号|编码|单号|流水号|号码|电话|手机号|姓名|ID)$/i.test(label)||/^(电话|手机|身份证|邮箱|地址|联系地址)/.test(label);
}
export function analyzeOperatingHeader(rows:unknown[][],headerRow:number):HeaderAnalysis{
 if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=rows.length)throw Error('请选择正确的表头行');
 const labels=rows[headerRow].map(v=>String(v??'').trim().replace(/[（(](?:元|人|次|个|单|张)[）)]$/,'').trim());
 const nonempty=labels.filter(Boolean);if(!nonempty.length||nonempty.some(v=>v.length>40||/[<>\u0000-\u001f]/.test(v)||/^[=+@]/.test(v)))throw Error('表头须为40字以内的普通文字');
 if(new Set(nonempty).size!==nonempty.length)throw Error('表头名称重复，请先改成不同名称');
 const catalog=operatingFieldCatalog().flatMap(g=>g.fields),fields:OperatingField[]=[],computedColumns:string[]=[],textColumns:string[]=[],used=new Set<string>();
 labels.forEach((label,index)=>{
  if(!label)return;
  const original=String(rows[headerRow][index]).trim();
  assertOperatingYuanUnit(original);
  if(isIdentity(label)){textColumns.push(label);return;}
  if(/率|比例|占比|百分比|倍数|ROI|ROAS|客单价|获客成本|点击成本|线索成本|投产比/i.test(label)){computedColumns.push(label);return;}
  const known=matchOperatingField(original,catalog);
  const samples=rows.slice(headerRow+1,headerRow+31).map(row=>row[index]).filter(v=>v!=null&&String(v).trim()!=='');
  const numbers=samples.map(v=>typeof v==='number'?v:Number(String(v).replace(/,/g,'')));
  const monetary=/金额|营收|收入|业绩|花费|消耗|费用|成本|预算|销售额|营业额|单价|价格/.test(label)||/[（(]元[）)]$/.test(original);
  const count=/(?:人数|次数|单数|数量|人次|订单量|成交数|咨询量|件数|笔数)$/.test(label)||/[（(](人|次|个|单|张)[）)]$/.test(original);
  if(!known&&(numbers.some(v=>!Number.isFinite(v))||!samples.length&&!monetary&&!count)){textColumns.push(label);return;}
  if(!known&&!monetary&&numbers.some(n=>!Number.isInteger(n))){textColumns.push(label);return;}
  let key=known?.key||'column'+(index+1);if(used.has(key))key='column'+(index+1);used.add(key);
  const kind:OperatingField['kind']=known?.kind||(monetary?'money':'count');
  const field={key,label,kind,required:true};
  const definition=key==='revenue'&&['总业绩','门店总业绩','营业额','业绩'].includes(label)
   ?operatingFieldDefinition({...field,label:'门店总业绩'}):known?.definition||operatingFieldDefinition(field);
  fields.push({...field,definition});
 });
 if(fields.length>30)throw Error('识别出超过30个数值字段，请精简表格');
 const dimensions=labels.map((label,index)=>dimensionName.test(label)?index:-1).filter(i=>i>=0);
 if(dimensions.length>1)throw Error('表头有多个分行维度，请先保留本次汇报采用的一列门店、渠道或账号');
 const dimensionIndex=dimensions[0],names=dimensionIndex===undefined?[]:[...new Set(rows.slice(headerRow+1).map(row=>String(row[dimensionIndex]??'').trim()).filter(name=>name&&!['合计','总计','全项目','全平台'].includes(name)))];
 if(names.some(name=>name.length>50||/[<>\u0000-\u001f]/.test(name))||names.length>30)throw Error('源表分行名称需为50字以内普通文字，最多30行');
 const dimensionLabel=dimensionIndex===undefined?'':labels[dimensionIndex]==='店名'?'门店':labels[dimensionIndex].replace(/(?:名称|名)$/,'');
 return{fields,computedColumns,textColumns,...(dimensionIndex!==undefined?{dimension:{label:dimensionLabel,names}}:{})};
}
