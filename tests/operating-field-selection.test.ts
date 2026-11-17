import test from 'node:test';
import assert from 'node:assert/strict';
import {operatingTemplatePresets,operatingTemplateMetrics,operatingSummary,operatingTemplateSchema} from '../lib/workbench/operating-data.ts';
import {matchImportedOperatingTemplate} from '../lib/workbench/operating-templates.ts';
import type {OperatingTemplate,OperatingRecord} from '../cloud/company/operating-model.ts';

const selection=await import('../lib/workbench/operating-field-selection.ts').catch(()=>null);
test('cross-business field selection removes dependent metrics and preserves remaining definitions without mutating a saved template',()=>{
 assert.ok(selection,'field selection implemented');
 const source=operatingTemplatePresets()[0],before=JSON.stringify(source);
 const result=selection.selectTemplateFields(source,['leads','revenue','refundAmount','spend']);
 assert.deepEqual(result.fields.map(f=>f.key),['leads','revenue','refundAmount','spend']);
 assert.equal(result.fields.find(f=>f.key==='refundAmount')?.kind,'money');
 assert.ok(result.metrics.every(m=>result.fields.some(f=>f.key===m.numerator)&&result.fields.some(f=>f.key===m.denominator)));
 assert.equal(JSON.stringify(source),before);
 assert.throws(()=>selection.selectTemplateFields(source,['unknown']));
});
test('header recognition separates numeric source columns from identities and calculated columns and requires explicit duplicate correction',()=>{
 assert.ok(selection);
 const result=selection.analyzeOperatingHeader([['客资周表'],['渠道','线索数','成交金额（元）','退款金额','转化率','备注'],['抖音',30,3000.25,0,'10%','需跟进']],1);
 assert.deepEqual(result.fields.map(f=>[f.label,f.kind]),[['线索数','count'],['成交金额','money'],['退款金额','money']]);
 assert.deepEqual(result.computedColumns,['转化率']);assert.deepEqual(result.textColumns,['渠道','备注']);
 assert.throws(()=>selection.analyzeOperatingHeader([['线索数','线索数'],[1,2]],0),/重复/);
 assert.throws(()=>selection.analyzeOperatingHeader([['=HYPERLINK("x")'],[1]],0),/表头|普通/);
});
test('unlabelled fractions and percentage shares cannot silently become money',()=>{
 assert.ok(selection);const result=selection.analyzeOperatingHeader([['占比','平均跟进天数','线索数','成交金额'],[0.25,1.5,2,123.45]],0);
 assert.deepEqual(result.fields.map(f=>[f.label,f.kind]),[['线索数','count'],['成交金额','money']]);
 assert.deepEqual(result.computedColumns,['占比']);assert.deepEqual(result.textColumns,['平均跟进天数']);
});
test('template field definition survives parsing and incompatible monetary units cannot become yuan fields',()=>{
 const template=operatingTemplatePresets()[0],field={...template.fields[0],definition:'当日新增线索条数，同一来源每日去重'};
 const parsed=selection?.analyzeOperatingHeader;
 assert.ok(parsed);assert.throws(()=>parsed([['成交金额（万元）'],[2.5]],0),/单位|元/);
 assert.equal(operatingTemplateSchema.parse({...template,fields:[field,...template.fields.slice(1)]}).fields[0].definition,field.definition);
});
test('a store or channel workbook supplies unique candidate rows and recognizes the original rating alias without inventing aggregate rows',()=>{
 assert.ok(selection);const result=selection.analyzeOperatingHeader([['日期','渠道','星级评分','核销金额'],['2026-11-11','渠道A',4.7,200],['2026-11-12','渠道A',4.8,300],['2026-11-12','渠道B',0,0],['合计','总计',9.5,500]],0);
 assert.deepEqual(result.dimension,{label:'渠道',names:['渠道A','渠道B']});assert.equal(result.fields.find(f=>f.label==='星级评分')?.kind,'stars');
});
test('customer conversion amount uses summed money and deal count for cumulative ticket and ROI; zero denominators stay unknown',()=>{
 const template=operatingTemplatePresets()[0];
 const base={companyId:'co_000000000000',projectId:'p_'+'0'.repeat(24),projectName:'演示客资',sheet:template.id,status:'draft',version:1,publishedVersion:0,writerLogin:'owner',reviewerLogin:'manager',submittedBy:'',submittedName:'',submittedAt:null,reviewerName:'',comment:'',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',published:null,template};
 const records=[{deals:4,revenue:200000,spend:50000},{deals:1,revenue:300000,spend:50000}].map((v,i)=>({...base,id:'op_'+String(i+1).padStart(32,'0'),date:'2026-11-0'+(i+1),rows:[{storeId:'all',storeName:'全项目',values:{leads:10,validLeads:8,appointments:6,arrivals:5,...v}}]} as OperatingRecord));
 const values=operatingSummary(records,template.id as any,'2026-11-02').rows[0].values;
 const metrics=Object.fromEntries(operatingTemplateMetrics(template,values).map(m=>[m.key,m.value]));
 assert.equal(values.revenue,500000);assert.equal(metrics.averageDeal,1000);assert.equal(metrics.revenueRoi,5);
 const zero=operatingTemplateMetrics(template,{...values,deals:0,spend:0});
 assert.equal(zero.find(m=>m.key==='averageDeal')?.value,null);assert.equal(zero.find(m=>m.key==='revenueRoi')?.value,null);
});

test('matching an imported worksheet retains the existing enabled or retired template and checks the formula meaning',()=>{
 const original=operatingTemplatePresets()[0],inactive={...original,active:false};
 const copied={...structuredClone(original),id:'tpl_new',fields:[...original.fields].reverse()};
 assert.equal(matchImportedOperatingTemplate([inactive],copied).existing,inactive);
 const otherFormula={...copied,metrics:copied.metrics.map((metric,index)=>index?metric:{...metric,denominator:'arrivals'})};
 assert.deepEqual(matchImportedOperatingTemplate([inactive],otherFormula),{existing:undefined,nameConflict:true});
 assert.equal(matchImportedOperatingTemplate([inactive],{...copied,dimension:'store'}).nameConflict,true);
 assert.deepEqual(matchImportedOperatingTemplate([inactive],{...copied,name:'另一平台'}),{existing:undefined,nameConflict:false});
});
