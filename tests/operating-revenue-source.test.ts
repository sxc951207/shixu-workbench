import test from 'node:test';
import assert from 'node:assert/strict';
import {extractStoreTargets,transposeRevenueDays} from '../lib/workbench/operating-import-layout.ts';

test('a titleless monthly goal uses the source dates in both import views',()=>{
 const table=[['日期','甲店','乙店','合计'],['月目标',1000,200,1200],['2026-10-02',50,70,120]];
 const options={date:'2026-11-01',stores:[{id:'a',name:'甲店'},{id:'b',name:'乙店'}],confirmedDaily:true};
 const goal=extractStoreTargets(table,0,options);
 assert.equal(goal.date,'2026-10-01');
 assert.deepEqual(goal,transposeRevenueDays(table,0,options).targets);
 assert.deepEqual(goal.rows.map(row=>row.target),[100000,20000]);
 const crossMonth=[...table,['2026-11-02',40,80,120]];
 assert.throws(()=>extractStoreTargets(crossMonth,0,options),/月份/);
 const corrected={...options,targetMonth:'2026-10'};
 assert.deepEqual(extractStoreTargets(crossMonth,0,corrected),goal);
 assert.deepEqual(transposeRevenueDays(crossMonth,0,corrected).targets,goal);
 assert.throws(()=>extractStoreTargets(crossMonth,0,{...options,targetMonth:'2026-12'}),/月份/);
 assert.throws(()=>extractStoreTargets(table.slice(0,2),0,options),/月份/);
 assert.deepEqual(extractStoreTargets(table.slice(0,2),0,corrected),goal);
});
