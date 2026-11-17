import assert from 'node:assert/strict';
import test from 'node:test';
import {receiptStorageKey,readReceiptLocator,writeReceiptLocator,refreshReceipt,importSourceFingerprint,unconfirmedImportReceipts,receiptLocator} from '../lib/workbench/operating-receipt-locator.ts';

const db=new Map<string,string>();
const storage={getItem:(key:string)=>db.get(key)??null,setItem:(key:string,value:string)=>{db.set(key,value);},removeItem:(key:string)=>{db.delete(key);}};
const key=receiptStorageKey('co','staff','project');
test('last import persists only file-independent locators and isolates company, account and project',()=>{
 const first={sheet:'meituan' as const,date:'2026-10-31',outcome:'created' as const,recordVersion:1,status:'sensitive',changes:['123.45'],approved:true};
 assert.ok(writeReceiptLocator(storage,key,[first],100));
 assert.deepEqual(JSON.parse(db.get(key)!),{savedAt:100,entries:[{sheet:'meituan',date:'2026-10-31',outcome:'created',recordVersion:1}]});
 assert.ok(readReceiptLocator(storage,key,100+86400000));
 for(const other of [receiptStorageKey('other','staff','project'),receiptStorageKey('co','other','project'),receiptStorageKey('co','staff','other')])assert.equal(readReceiptLocator(storage,other,100),null);
 assert.equal(readReceiptLocator(storage,key,100+7*86400000),null);assert.ok(!db.has(key));
});
test('invalid metadata is removed without reading arbitrary months',()=>{
 db.set(key,JSON.stringify({savedAt:10,entries:[{sheet:'targets',date:'2026-99-99',outcome:'created'}]}));
 assert.equal(readReceiptLocator(storage,key,11),null);assert.ok(!db.has(key));
});
test('restored receipt groups current authorized records, never attributes existing data to an unresolved import',async()=>{
 const entries=[
  {sheet:'meituan',date:'2026-10-30',outcome:'unchanged'},
  {sheet:'meituan',date:'2026-10-31',outcome:'updated'},
  {sheet:'meituan',date:'2026-11-01',outcome:'created'},
  {sheet:'meituan',date:'2026-11-02',outcome:'errors'}
 ] as const;
 const months:string[]=[];
 const result=await refreshReceipt(entries,async month=>{
  months.push(month);
  return {config:null,permissions:{revenue:false,platform:true},records:month==='2026-10'?[{sheet:'meituan',date:'2026-10-30',status:'approved',version:3,publishedVersion:3},{sheet:'meituan',date:'2026-10-31',status:'draft',version:4,publishedVersion:3}] as any:[]};
 },false);
 assert.deepEqual(months,['2026-10','2026-11']);
 assert.deepEqual(result.map(r=>r.record?.version),[3,4,undefined,undefined]);
 assert.match(result[2].status,/不可查看/);assert.match(result[3].status,/重新.*原表/);
});

test('next-day reselection recovers only the same unacknowledged source, never a successful write or a read error',async()=>{
 const days=['2026-10-01','2026-10-02','2026-10-03'].map(date=>({
  date,sheet:'meituan' as const,rows:[{storeId:'all',storeName:'全平台',values:{verifiedAmount:12345}}],
  columns:['verifiedAmount']
 }));
 const source=await importSourceFingerprint(key,days);
 assert.ok(source);
 const receipts=days.map(({sheet,date},i)=>({sheet,date,outcome:i===0?'created' as const:'errors' as const,saveUnconfirmed:i===1}));
 assert.ok(writeReceiptLocator(storage,key,receiptLocator(receipts,source),100));
 const stored=readReceiptLocator(storage,key,100+86400000)!;
 assert.deepEqual(Object.keys(stored[0]).sort(),['date','outcome','sheet']);
 assert.deepEqual(Object.keys(stored[2]).sort(),['date','outcome','sheet']);
 assert.ok(!db.get(key)!.includes('verifiedAmount')&&!db.get(key)!.includes('12345'));
 const retry=unconfirmedImportReceipts(stored,await importSourceFingerprint(key,[...days].reverse()));
 assert.deepEqual(retry.map(item=>[item.date,item.outcome,item.saveUnconfirmed]),[['2026-10-02','errors',true]]);
 const changed=days.map((day,i)=>i!==1?day:{...day,rows:[{...day.rows[0],values:{verifiedAmount:0}}]});
 assert.equal(unconfirmedImportReceipts(stored,await importSourceFingerprint(key,changed)).length,0);
 assert.equal(unconfirmedImportReceipts(stored,undefined).length,0);
 assert.equal(unconfirmedImportReceipts([{sheet:'meituan',date:days[1].date,outcome:'errors'}],source).length,0);
});
