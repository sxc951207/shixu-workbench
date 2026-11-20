import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBusinessDates} from '../lib/workbench/operating-source-date.ts';
test('business dates follow workbook rows or cumulative caption, independently of the dashboard cutoff',()=>{
 assert.deepEqual(sourceBusinessDates([['11月平台数据'],['日期','金额'],['月度',900],['11/1/2026',10],['第1周',10],['11/14/2026',57]],1,'meituan'),['2026-11-01','2026-11-14']);
 assert.deepEqual(sourceBusinessDates([['运营数据 2026-11-01 至 2026-11-08'],['门店','下单券数'],['示例一店',3]],1,'meituan-stores'),['2026-11-08']);
 assert.deepEqual(sourceBusinessDates([['门店','金额'],['示例一店',3]],0,'revenue'),[]);
});

test('custom daily templates skip calendar placeholders with failed computed ratios and preserve explicit zeros',()=>{
 const rows=[['日期','周','进线量','核销ROI'],['2026-11-18','星期三',0,0],['2026-11-19','星期四',null,'#DIV/0!']];
 assert.deepEqual(sourceBusinessDates(rows,0,'tpl_example','2026-11-18'),['2026-11-18']);
});
