import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectUpload,destinationSignature,type Destination,type UploadSource} from '../lib/workbench/operating-upload-route.ts';
import {operatingFields,operatingTemplatePresets} from '../lib/workbench/operating-data.ts';

const date='2026-11-16';
const options:Destination[]=[{sheet:'douyin',name:'抖音日报'},{sheet:'meituan',name:'美团日报'},{sheet:'douyin-stores',name:'抖音累计'},{sheet:'revenue',name:'全店业绩'},{sheet:'targets',name:'门店目标'}];
const source=(rows:unknown[][],name='业务明细',header=0):UploadSource=>({rows,header,name,tab:name,image:false});
const daily=['日期',...operatingFields('douyin').filter(f=>f.required).map(f=>f.label)];
test('distinct platform identity and date axis must agree before routing shared financial columns',()=>{
 const file=source([['抖音11月平台数据'],daily,[date,...daily.slice(1).map(()=>1)]],'Sheet1',1);
 assert.equal(inspectUpload(file,options,[],date).automatic?.sheet,'douyin');
 assert.equal(inspectUpload({...file,rows:[['平台数据'],...file.rows.slice(1)]},options,[],date).automatic,undefined);
 assert.equal(inspectUpload({...file,rows:[['抖音11月平台数据'],[...daily,''],[date,...daily.map(()=>1)]]},options,[],date).automatic,undefined);
});
test('a store matrix offers existing target and daily choices while keeping the original rows',()=>{
 const file=source([['日期','湖边店','西街店','合计'],['月目标',100,200,300],['11月5日',0,2,2]]);
 const result=inspectUpload(file,options,[],date);assert(result.horizontal);assert(!result.automatic);
 assert.deepEqual(result.candidates.map(d=>d.sheet),['revenue','targets']);assert.deepEqual(result.source.rows,file.rows);
});
test('unfamiliar project, shuffled columns, unrelated new tables and a changed template definition',()=>{
 const template=operatingTemplatePresets()[0],dest:Destination={template,sheet:template.id as Destination['sheet'],name:template.name};
 const labels=template.fields.map(f=>f.label).reverse();
 const file=source([['业务日期',...labels],[date,...labels.map(()=>1)]],'来源-甲');
 assert.equal(inspectUpload(file,[dest],[],date).automatic?.sheet,template.id);
 assert.deepEqual(inspectUpload(source([['日期','新展台数'],[date,2]]),[dest],[],date).candidates,[]);
 assert.notEqual(destinationSignature(dest),destinationSignature({...dest,template:{...template,fields:template.fields.map(f=>({...f,definition:'修改后的口径'}))}}));
 assert.equal(inspectUpload(file,[],[],date).automatic,undefined);
});


test('普通粘贴截图没有可复用的来源标识，同一表头不能跨次猜平台',()=>{
 const file=source([daily,[date,...daily.slice(1).map(()=>0)]],'粘贴的截图.png');
 const match=inspectUpload(file,options,[],date);assert.equal(match.identity,'');assert(!match.automatic);
});
test('明确标注累计的无日期明细不会归到日表',()=>{
 const file=source([['门店','下单金额','核销金额'],['甲店',300,250]],'抖音截至本月累计');
 const match=inspectUpload(file,options,[],date);assert(match.cumulativeOnly);assert.deepEqual(match.candidates.map(d=>d.sheet),['douyin-stores']);
});
