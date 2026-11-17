import test from 'node:test';import assert from 'node:assert/strict';
import{memoryCloudDatabase}from'./fixtures/cloud-database.ts';import{createCompanyStore}from'../cloud/company/store.ts';import{createCompanyService}from'../cloud/company/service.ts';
const origin='https://example.test',secret='test-company-secret-at-least-32-characters';
test('company account invitations are one use, owner-gated, CSRF protected and never exported as credentials',async()=>{const f=memoryCloudDatabase(),api=createCompanyService(createCompanyStore(f.db),{secret,origin,ownerSession:async cookie=>cookie==='owner-test'});const req=async(body:any,cookie='owner-test',otherOrigin=origin)=>{const r=await api({httpMethod:'POST',headers:{origin:otherOrigin,'content-type':'application/json',cookie},body:JSON.stringify(body)});return{status:r.statusCode,data:JSON.parse(r.body),cookie:r.headers['Set-Cookie']?.split(';')[0]};};
 assert.equal((await req({action:'company.create',name:'公司'},'')).status,401);assert.equal((await req({action:'company.create',name:'公司'},'owner-test','https://evil.test')).status,403);
 const c=(await req({action:'company.create',name:'公司'})).data.company;
 await req({action:'member.save',companyId:c.id,login:'staff',name:'同事',roles:['employee'],managerId:'owner',active:true});
 const invitation=(await req({action:'invite',companyId:c.id,login:'staff'})).data;
 const password='synthetic-test-password-2026';const joined=await req({action:'join',companyId:c.id,login:'staff',token:invitation.token,password},'');assert.equal(joined.status,200);assert.ok(joined.cookie);
 assert.equal((await req({action:'login',companyId:c.id,login:'staff',password},'')).status,200);
 assert.equal((await req({action:'join',companyId:c.id,login:'staff',token:invitation.token,password},'')).status,403);
 const view=await req({action:'view',companyId:c.id,month:'2026-11',scope:'mine'},joined.cookie);assert.equal(view.status,200);assert.ok(!JSON.stringify(view.data).includes('hash'));
 assert.equal((await req({action:'member.save',companyId:c.id,login:'staff',name:'升权',roles:['leader'],managerId:'owner'},joined.cookie)).status,403);
 await req({action:'member.save',companyId:c.id,login:'staff',name:'同事',roles:['employee'],managerId:'owner',active:false});assert.equal((await req({action:'view',companyId:c.id,month:'2026-11',scope:'mine'},joined.cookie)).status,401);
});
test('member invitation and reset accept eight characters and preserve the 128-character upper limit', async () => {
 const service = createCompanyService(createCompanyStore(memoryCloudDatabase().db), {secret, origin, ownerSession: async cookie => cookie === 'owner-test'});
 const request = (body: Record<string, unknown>, cookie = '') => service({
  httpMethod: 'POST', headers: {origin, cookie, 'content-type': 'application/json'}, body: JSON.stringify(body)
 });
 const company = JSON.parse((await request({action: 'company.create', name: '测试公司'}, 'owner-test')).body).company;
 const member = {companyId: company.id, login: 'staff'};
 assert.equal((await request({action: 'member.save', ...member, name: '测试成员', roles: ['employee'], active: true}, 'owner-test')).statusCode, 200);
 const invite = async () => JSON.parse((await request({action: 'invite', ...member}, 'owner-test')).body).token;
 const firstToken = await invite();
 const join = (token: string, password: string) => request({action: 'join', ...member, token, password});
 const login = (password: string) => request({action: 'login', ...member, password});
 assert.equal((await join(firstToken, 'x'.repeat(7))).statusCode, 400);
 assert.equal((await join(firstToken, 'x'.repeat(129))).statusCode, 400);
 assert.equal((await join(firstToken, 'x'.repeat(8))).statusCode, 200);
 assert.equal((await login('x'.repeat(8))).statusCode, 200);

 const resetToken = await invite();
 assert.equal((await login('x'.repeat(8))).statusCode, 401);
 assert.equal((await join(resetToken, 'y'.repeat(7))).statusCode, 400);
 assert.equal((await join(resetToken, 'y'.repeat(8))).statusCode, 200);
 assert.equal((await login('y'.repeat(8))).statusCode, 200);
 assert.equal((await join(await invite(), 'z'.repeat(128))).statusCode, 200);
 assert.equal((await login('z'.repeat(128))).statusCode, 200);
});
test('company login throttles wrong passwords and rejects forged session identity',async()=>{const api=createCompanyService(createCompanyStore(memoryCloudDatabase().db),{secret,origin,ownerSession:async c=>c==='owner-test'});const req=async(b:any,c='owner-test')=>{const r=await api({httpMethod:'POST',headers:{origin,'content-type':'application/json',cookie:c},body:JSON.stringify(b)});return{status:r.statusCode,data:JSON.parse(r.body)};};const c=(await req({action:'company.create',name:'公司'})).data.company;await req({action:'member.save',companyId:c.id,login:'staff',name:'员工',roles:['employee'],managerId:'owner'});const invite=(await req({action:'invite',companyId:c.id,login:'staff'})).data;await req({action:'join',companyId:c.id,login:'staff',token:invite.token,password:'synthetic-password-long'},'');for(let i=0;i<5;i++)assert.equal((await req({action:'login',companyId:c.id,login:'staff',password:'wrong'},'')).status,401);assert.equal((await req({action:'login',companyId:c.id,login:'staff',password:'synthetic-password-long'},'')).status,429);assert.equal((await req({action:'companies'},'__Host-shixu_company_session=forged')).status,401);});
