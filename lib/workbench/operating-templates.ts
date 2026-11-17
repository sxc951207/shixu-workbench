import {z} from 'zod';
import {WorkbenchError} from './domain.ts';
import type {OperatingField,OperatingMetric,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingFieldDefinition} from './operating-field-dictionary.ts';

const key=z.string().regex(/^[a-z][a-zA-Z0-9_]{0,31}$/);
const plain=(max:number,min=1)=>z.string().min(min).max(max).refine(v=>v.trim()===v&&!/[<>\u0000-\u001f]/.test(v)&&!/^[=+@]/.test(v),'请填写普通文字');
const fieldSchema=z.object({key,label:plain(40),kind:z.enum(['money','count','stars']),required:z.boolean(),definition:plain(300,0).optional()}).strict();
const metricSchema=z.object({key,label:plain(40),numerator:key,denominator:key,format:z.enum(['percent','ratio','money'])}).strict();
export const operatingTemplateSchema=z.object({
 id:z.string().regex(/^tpl_[a-z0-9_]{1,32}$/),name:plain(60),description:plain(300,0),dimension:z.enum(['total','store']),writer:z.enum(['owner','supervisor','project-owner']),
 fields:z.array(fieldSchema).min(1).max(30),metrics:z.array(metricSchema).max(10),active:z.boolean(),
}).strict().superRefine((template,ctx)=>{
 const fieldKeys=new Set(template.fields.map(f=>f.key)),metricKeys=new Set(template.metrics.map(m=>m.key));
 if(fieldKeys.size!==template.fields.length||metricKeys.size!==template.metrics.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'模板字段或指标编号重复'});
 // Labels are already required to be trimmed plain text; matching is case-sensitive, as in TSV headers.
 if(new Set(template.fields.map(f=>f.label)).size!==template.fields.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'模板字段名称重复，无法区分导入列'});
 for(const metric of template.metrics){
  if(fieldKeys.has(metric.key))ctx.addIssue({code:z.ZodIssueCode.custom,message:'指标编号不能与字段相同'});
  for(const ref of[metric.numerator,metric.denominator])if(!template.fields.some(f=>f.key===ref&&f.kind!=='stars'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'指标只能引用已有金额或数量字段'});
 }
});
const f=(key:string,label:string,kind:OperatingField['kind']='count'):OperatingField=>({key,label,kind,required:true,definition:operatingFieldDefinition({key,label,kind})});
const m=(key:string,label:string,numerator:string,denominator:string,format:OperatingMetric['format']='percent'):OperatingMetric=>({key,label,numerator,denominator,format});
export function operatingTemplatePresets():OperatingTemplate[]{return[
 {id:'tpl_leads',name:'客资跟进',description:'记录线索、跟进转化与花费。客资成交金额按成交发生日填写可归属本项目的金额；金额ROI不代表利润。',dimension:'total',writer:'owner',active:true,
  fields:[f('leads','线索数'),f('validLeads','有效线索'),f('appointments','预约数'),f('arrivals','到店数'),f('deals','成交数'),f('revenue','客资成交金额','money'),f('spend','花费','money')],
  metrics:[m('validRate','有效率','validLeads','leads'),m('appointmentRate','预约率','appointments','validLeads'),m('arrivalRate','到店率','arrivals','appointments'),m('dealRate','成交率','deals','arrivals'),m('cpl','获客成本','spend','validLeads','money'),m('averageDeal','成交客单价','revenue','deals','money'),m('revenueRoi','成交金额ROI','revenue','spend','ratio')]},
 {id:'tpl_ads',name:'广告投放',description:'记录曝光、点击、线索、订单、成交金额与消耗，金额ROI按成交金额除以消耗计算。',dimension:'total',writer:'owner',active:true,
  fields:[f('impressions','曝光'),f('clicks','点击'),f('leads','线索'),f('orders','订单'),f('orderAmount','成交金额','money'),f('spend','消耗','money')],
  metrics:[m('ctr','点击率','clicks','impressions'),m('cpc','点击成本','spend','clicks','money'),m('cpl','线索成本','spend','leads','money'),m('roi','金额ROI','orderAmount','spend','ratio')]},
 {id:'tpl_ecommerce',name:'电商经营',description:'记录订单、成交金额、退款发生额与推广消耗；退款发生额单独展示，不推算利润或退款后收入。',dimension:'total',writer:'owner',active:true,
  fields:[f('orders','订单'),f('orderAmount','成交金额','money'),f('refundAmount','退款金额','money'),f('spend','推广消耗','money')],
  metrics:[m('averageOrder','客单价','orderAmount','orders','money'),m('roi','成交金额ROI','orderAmount','spend','ratio')]},
];}
export function operatingMetricFormats(fields:OperatingField[],metric:Pick<OperatingMetric,'numerator'|'denominator'>):OperatingMetric['format'][] {
 const numerator=fields.find(field=>field.key===metric.numerator)?.kind;
 const denominator=fields.find(field=>field.key===metric.denominator)?.kind;
 if(!numerator||!denominator||numerator==='stars'||denominator==='stars')return [];
 if(numerator===denominator)return ['percent','ratio'];
 return numerator==='money'&&denominator==='count'?['money']:[];
}
export function operatingMetricUnitIssue(fields:OperatingField[],metric:OperatingMetric):string|undefined {
 const formats=operatingMetricFormats(fields,metric);
 if(formats.includes(metric.format))return;
 const explanation=formats.includes('money')?'金额除以数量，应显示为每单位金额（元）':formats.length?'同类单位相除，应显示为百分比或倍数':'当前显示方式不支持此分子和分母的单位';
 return '公式单位不匹配：'+metric.label+'。'+explanation+'。';
}
export type OperatingMetricValue=Pick<OperatingMetric,'key'|'label'|'format'>&{value:number|null;unitIssue?:string};
export function operatingTemplateMetrics(template:OperatingTemplate,values:Record<string,number|null>):OperatingMetricValue[]{
 const parsed=operatingTemplateSchema.safeParse(template);if(!parsed.success)throw new WorkbenchError('经营模板定义无效');
 const raw=(key:string):number|null=>{const value=values[key];return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;};
 return parsed.data.metrics.map(metric=>{
  const base={key:metric.key,label:metric.label,format:metric.format},unitIssue=operatingMetricUnitIssue(parsed.data.fields,metric);
  if(unitIssue)return {...base,value:null,unitIssue};
  const numerator=raw(metric.numerator),denominator=raw(metric.denominator);
  const value=numerator!==null&&denominator!==null&&denominator>0?(numerator/denominator)/(metric.format==='money'?100:1):null;
  return {...base,value};
 });
}

function importedStructure(template:OperatingTemplate){
 const fieldNames=new Map(template.fields.map(field=>[field.key,field.label]));
 const fields=template.fields.map(field=>JSON.stringify([field.label,field.kind])).sort();
 const metrics=template.metrics.map(metric=>JSON.stringify([metric.label,fieldNames.get(metric.numerator),fieldNames.get(metric.denominator),metric.format])).sort();
 return JSON.stringify([template.dimension,fields,metrics]);
}

export function matchImportedOperatingTemplate(templates:OperatingTemplate[],candidate:OperatingTemplate){
 const namesakes=templates.filter(template=>template.name===candidate.name);
 const structure=importedStructure(candidate);
 const existing=namesakes.find(template=>importedStructure(template)===structure);
 return {existing,nameConflict:!existing&&namesakes.length>0};
}
