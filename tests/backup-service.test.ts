import{test}from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{createService}from'../cloud/service.ts';import{createCloudStore}from'../cloud/store.ts';import{createBackupTimer,BACKUP_TRIGGER}from'../cloud/backup-timer.ts';import{memoryCloudDatabase}from'./fixtures/cloud-database.ts';
import {createCompanyStore} from '../cloud/company/store.ts';
import {executeCompany} from '../cloud/company/core.ts';
const event=(path:string,body?:unknown,cookie='')=>({path:'/shixu-api/'+path,httpMethod:body?'POST':'GET',headers:{origin:'https://work.example',cookie,'content-type':'application/json'},body:body?JSON.stringify(body):''});
test('backup endpoints require owner session and preview revision protects restore; authentication remains valid',async()=>{
 const memory=memoryCloudDatabase(),store=createCloudStore(memory.db),service=createService(store,{secret:'s'.repeat(48),bootstrapHash:createHash('sha256').update('invitation').digest('hex'),origin:'https://work.example'});
 assert.equal((await service(event('backups'))).statusCode,401);const setup=await service(event('setup',{token:'invitation',password:'test-backup-password'})),cookie=setup.headers['Set-Cookie'].split(';')[0];
 const created=JSON.parse((await service(event('backups',{action:'create'},cookie))).body).backup;assert.equal(created.count,0);
 let preview=JSON.parse((await service(event('backups',{action:'preview',id:created.id},cookie))).body);assert.equal(preview.targetCount,0);
 await service(event('records',{action:'save',record:{id:'new',kind:'task',title:'之后新增'}},cookie));assert.equal((await service(event('backups',{action:'restore',id:created.id,expectedRevision:preview.currentRevision},cookie))).statusCode,409);
 preview=JSON.parse((await service(event('backups',{action:'preview',id:created.id},cookie))).body);assert.equal(preview.removed,1);
 const restored=await service(event('backups',{action:'restore',id:created.id,expectedRevision:preview.currentRevision},cookie));assert.equal(restored.statusCode,200);assert.equal(JSON.parse(restored.body).records.length,0);
 assert.equal(JSON.parse((await service(event('session',undefined,cookie))).body).authenticated,true);const list=JSON.parse((await service(event('backups',undefined,cookie))).body).backups;assert.equal(list.length,2);assert.ok(list.some((b:any)=>b.kind==='before-restore'));
 const download=JSON.parse((await service(event('backups',{action:'download',id:created.id},cookie))).body).backup;assert.equal(download.format,'shixu-workbench');assert.equal(JSON.stringify(download).includes('auth'),false);
 const recreated=JSON.parse((await service(event('records',{action:'save',record:{id:'new',kind:'task',title:'重新生成'}},cookie))).body).record;assert.ok(recreated.version>1);assert.equal((await service(event('records',{action:'save',record:{...recreated,title:'旧窗口',version:1},expectedVersion:1},cookie))).statusCode,409);
 const csrf=event('backups',{action:'create'},cookie);csrf.headers.origin='https://bad.example';assert.equal((await service(csrf)).statusCode,403);
});
const secret = 't'.repeat(48);
const trigger = {Type:'Timer', TriggerName:BACKUP_TRIGGER, Message:JSON.stringify({token:secret})};
const clock = new Date('2026-11-13T04:00:00Z');

async function backupFixture() {
 const memory = memoryCloudDatabase();
 const companies = createCompanyStore(memory.db);
 const company = await companies.run(async tx => (await executeCompany(tx, {owner:true}, {action:'company.create',name:'定时备份测试'}, clock)).company);
 memory.corrupt('shixu_private_v1', 'owner', {recordsJson:'[]',revision:1});
 return {memory, companies, id:company.id, timer:createBackupTimer(createCloudStore(memory.db), secret, companies)};
}

test('invalid triggers and valid triggers before 02:00 do not access either store', async () => {
 let calls = 0;
 const unavailable = {run:async () => {calls++; throw Error('unexpected database access');}};
 const timer = createBackupTimer(unavailable, secret, unavailable);
 for (const input of [{}, {...trigger, Type:'Request'}, {...trigger, TriggerName:'wrong'}, {...trigger, Message:'invalid'}, {...trigger, Message:JSON.stringify({token:'w'.repeat(48)})}]) {
  await assert.rejects(timer(input, clock), /Unauthorized/);
 }
 const result = await timer(trigger, new Date('2026-11-12T17:00:00Z'));
 assert.equal(result.skipped, 'before-backup-hour');
 assert.equal(result.companies.skipped, 'before-backup-hour');
 assert.equal(calls, 0);
});

test('personal backup rejection still commits company checkpoints and exposes only the affected task', async () => {
 const {memory,id,timer} = await backupFixture();
 memory.corrupt('shixu_private_v1', 'owner', {recordsJson:'private-invalid-json'});
 const outcome = await timer(trigger, clock).catch((error:Error) => error);
 assert.ok(memory.read('shixu_company_backups_v1', 'checkpoint_'+id+'_daily_2026-11-13'));
 assert.ok(outcome instanceof Error);
 assert.match(outcome.message, /personal/i);
 assert.doesNotMatch(outcome.message, /private-invalid-json/);
});

test('company checkpoint integrity failure is observable after the personal backup commits', async () => {
 const {memory,id,timer} = await backupFixture();
 memory.corrupt('shixu_company_backups_v1', 'head_'+id, {payload:'private-company-data',checksum:'bad'});
 await assert.rejects(timer(trigger, clock), (error:Error) => {
  assert.match(error.message, /company/i);
  assert.ok(!error.message.includes(id));
  assert.doesNotMatch(error.message, /private-company-data/);
  return true;
 });
 assert.ok(memory.read('shixu_backups_v1','auto-2026-11-13'));
 assert.equal(memory.read('shixu_company_v1','backup_health_'+id).failureCode,'CHECKPOINT_FAILED');
});

test('hourly timer resumes a pending company batch even when the personal daily backup already exists', async () => {
 const {memory,companies,id,timer} = await backupFixture();
 const earlierIds = Array.from({length:50}, (_,i) => 'removed-'+i);
 await companies.run(tx => tx.put('registry', {ids:[...earlierIds,id]}));
 const first = await timer(trigger, clock);
 assert.equal(first.ok, true);
 assert.equal(first.companies.pending, 1);
 assert.equal(first.id, 'auto-2026-11-13');
 const daily = 'checkpoint_'+id+'_daily_2026-11-13';
 assert.equal(memory.read('shixu_company_backups_v1',daily), undefined);
 const nextHour = new Date(clock.getTime()+3600000);
 const second = await timer(trigger, nextHour);
 assert.equal(second.id, first.id);
 assert.equal(second.createdAt, first.createdAt);
 assert.equal(second.companies.count, 3);
 assert.equal(memory.read('shixu_company_backups_v1',daily).createdAt,nextHour.toISOString());
 await timer(trigger, new Date(clock.getTime()+7200000));
 const catalog = memory.read('shixu_company_backups_v1','catalog_'+id).items;
 assert.equal(catalog.filter((entry:{kind:string}) => entry.kind==='daily').length, 1);
});
