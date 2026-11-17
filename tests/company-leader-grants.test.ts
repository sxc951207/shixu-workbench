import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {createCompanyService} from '../cloud/company/service.ts';
import {createCompanyStore} from '../cloud/company/store.ts';
import {memoryCloudDatabase} from './fixtures/cloud-database.ts';

test('same-login leaders have independent invitations, confirmed reports and live per-company role changes',async t=>{
  const admin='test-owner-session',store=createCompanyStore(memoryCloudDatabase({direct:true}).db);
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const handle=createCompanyService(store,{origin,secret:'local-test-signature-for-leader-role-checks',ownerSession:async cookie=>cookie===admin});
  server.on('request',async(req,res)=>{
    const chunks:Buffer[]=[];
    for await(const chunk of req)chunks.push(chunk);
    const reply=await handle({httpMethod:req.method,headers:{origin:req.headers.origin||'',cookie:req.headers.cookie||'','content-type':req.headers['content-type']||''},body:Buffer.concat(chunks).toString()});
    res.writeHead(reply.statusCode,reply.headers);res.end(reply.body);
  });
  async function request(body:Record<string,unknown>,cookie:string,status=200){
    const response=await fetch(origin+'/company',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
    const data=JSON.parse(await response.text());
    assert.equal(response.status,status,String(body.action)+' '+(data.error||''));
    return {data,cookie:response.headers.getSetCookie()[0]?.split(';')[0]||''};
  }
  const member=(companyId:string,login:string,roles:string[],cookie=admin,status=200)=>
    request({action:'member.save',companyId,login,name:login,roles,active:true},cookie,status);
  const invite=async(companyId:string,login:string)=>(await request({action:'invite',companyId,login},admin)).data.token;
  async function join(companyId:string,login:string,token:string,status=200){
    const {cookie}=await request({action:'join',companyId,login,token,password:'synthetic-fixture-credential'},'',status);
    if(status===200)assert.ok(cookie);
    return cookie;
  }
  const a=(await request({action:'company.create',name:'甲公司'},admin)).data.company.id;
  const b=(await request({action:'company.create',name:'乙公司'},admin)).data.company.id;
  const login='director';
  await member(a,login,['leader']);
  await member(b,login,['employee']);
  const tokenA=await invite(a,login),tokenB=await invite(b,login);
  await join(b,login,tokenA,403);
  const cookieA=await join(a,login,tokenA),cookieB=await join(b,login,tokenB);
  await join(a,login,tokenA,403);

  // Use the actual writer and reviewer transitions for a confirmed snapshot,
  // then add an unpublished amendment and a second project with only a draft.
  const period={kind:'weekly',periodDate:'2020-01-08'};
  async function reports(companyId:string,label:string){
    await member(companyId,'writer',['employee']);
    const writer=await join(companyId,'writer',await invite(companyId,'writer'));
    async function create(suffix:string){
      const {data:{project}}=await request({action:'project.create',name:label+suffix,companyId,ownerLogin:'writer',reviewerLogin:'owner',participants:[]},admin);
      const {data:{report}}=await request({action:'report.create',companyId,projectId:project.id,...period},writer);
      return report;
    }
    async function save(report:{id:string;version:number},achievement:string){
      return (await request({action:'report.save',companyId,id:report.id,version:report.version,progress:30,achievement,risk:'',next:'',help:'',sourceVersions:[]},writer)).data.report;
    }
    let report=await save(await create('已确认项目'),label+'已确认成果');
    const id=report.id;
    report=(await request({action:'report.submit',companyId,id,version:report.version},writer)).data.report;
    report=(await request({action:'report.approve',companyId,id,version:report.version,comment:''},admin)).data.report;
    const approvedVersion=report.version;
    report=(await request({action:'report.amend',companyId,id,version:report.version},writer)).data.report;
    await save(report,label+'未确认更正');
    await save(await create('草稿项目'),label+'未确认初稿');
    return {id,version:approvedVersion,achievement:label+'已确认成果'};
  }
  const confirmedA=await reports(a,'甲'),confirmedB=await reports(b,'乙');
  const scope={action:'report.list',...period,scope:'summary'};
  async function assertSummary(companyId:string,cookie:string,confirmed:typeof confirmedA){
    const {data}=await request({...scope,companyId},cookie);
    assert.equal(data.total,1);
    assert.deepEqual(data.reports.map((r:{id:string;version:number;achievement:string;status:string})=>[r.id,r.version,r.achievement,r.status]),
      [[confirmed.id,confirmed.version,confirmed.achievement,'approved']]);
    assert.doesNotMatch(JSON.stringify(data),/未确认更正|未确认初稿/);
  }
  async function assertMembership(cookie:string,companyId:string,roles:string[]){
    const {data}=await request({action:'companies'},cookie);
    assert.deepEqual(data.companies.map((c:{id:string;roles:string[]})=>[c.id,c.roles]),[[companyId,roles]]);
  }

  await assertMembership(cookieA,a,['leader']);
  await assertMembership(cookieB,b,['employee']);
  await assertSummary(a,cookieA,confirmedA);
  await request({...scope,companyId:b},cookieB,403);
  await member(b,login,['leader'],cookieB,403);
  await member(b,login,['leader']);
  await assertMembership(cookieB,b,['leader']);
  await assertSummary(b,cookieB,confirmedB);
  await request({...scope,companyId:b},cookieA,403);
  await request({action:'report.get',companyId:b,id:confirmedB.id},cookieA,403);
  await request({action:'report.get',companyId:a,id:confirmedB.id},cookieA,404);
  await request({action:'backup.list',companyId:b},admin);
  await request({action:'backup.list',companyId:b},cookieA,403);
  await request({action:'backup.list',companyId:b},cookieB,403);
  await member(b,login,['employee']);
  await assertMembership(cookieB,b,['employee']);
  await request({...scope,companyId:b},cookieB,403);
  await assertMembership(cookieA,a,['leader']);
  await assertSummary(a,cookieA,confirmedA);
});
