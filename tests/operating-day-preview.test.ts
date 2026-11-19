import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewImportDays,sourceDateGaps} from '../lib/workbench/operating-day-preview.ts';
import {saveOperatingImportBatch,type OperatingImportEntry,type ImportMonth} from '../lib/workbench/operating-reimport.ts';
import type {OperatingRecord} from '../cloud/company/operating-model.ts';

const entry=(date:string,amount:number):OperatingImportEntry=>({date,sheet:'revenue',columns:['revenue'],rows:[{storeId:'s',storeName:'试点店',values:{revenue:amount}}]});
const record=(day:OperatingImportEntry)=>({...day,version:2,status:'approved'} as unknown as OperatingRecord);
const dates=['2026-10-30','2026-10-31','2026-11-02'];
const entries=dates.map((d,i)=>entry(d,i*1000));
const month=(records:OperatingRecord[]):ImportMonth=>({records,config:null,permissions:{revenue:true,platform:true}});

test('first upload, unchanged repeat, mixed corrections and new days compare by source date including zero',async()=>{
 const reads:string[]=[];
 const first=await previewImportDays(entries,async m=>{reads.push(m);return month([]);});
 assert.deepEqual(reads,['2026-10','2026-11']);
 assert.deepEqual(first.map(d=>d.kind),['new','new','new']);
 const existing=entries.map(record);
 const repeat=await previewImportDays(entries,async()=>month(existing));
 assert.ok(repeat.every(d=>d.kind==='same'));
 const mixed=await previewImportDays(entries,async()=>month([existing[0],record(entry(dates[1],900))]));
 assert.deepEqual(mixed.map(d=>d.kind),['same','changed','new']);
 assert.match(mixed[1].details.join(' '),/试点店.*9.*→.*10/);
 assert.deepEqual(sourceDateGaps(dates),['2026-11-01']);
 assert.deepEqual(sourceDateGaps(dates.slice(0,2)),[]);
});

test('a historical store mismatch cannot block saving a later new day',async()=>{
 const conflict=record({...entries[0],rows:[{storeId:'other',storeName:'另一家',values:{revenue:0}}]});
 const saved:string[]=[];
 const receipts=await saveOperatingImportBatch(entries,{previous:[],reason:'',login:'owner',readMonth:async()=>month([conflict]),save:async d=>{saved.push(d.date);return record({...d,columns:['revenue']});}});
 assert.deepEqual(receipts.map(r=>r.outcome),['errors','created','created']);
 assert.deepEqual(saved,dates.slice(1));
});
