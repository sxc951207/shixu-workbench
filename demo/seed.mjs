import {createHash, randomBytes} from 'node:crypto';
import {memoryCloudDatabase} from '../tests/fixtures/cloud-database.ts';
import {createCloudStore} from '../cloud/store.ts';
import {createService, isOwnerSession} from '../cloud/service.ts';
import {createCompanyStore} from '../cloud/company/store.ts';
import {createCompanyService} from '../cloud/company/service.ts';
import {todayShanghai} from '../lib/workbench/domain.ts';

const roles = {staff:'employee', manager:'supervisor', leader:'leader'};
const names = {staff:'示例员工', manager:'示例主管', leader:'示例领导'};
const demoPassword = 'Local-demo-only-01';

export async function createDemo(origin) {
  const database = memoryCloudDatabase({direct:true}).db;
  const store = createCloudStore(database);
  const token = randomBytes(32).toString('hex');
  const secret = randomBytes(48).toString('hex');
  const personal = createService(store, {
    origin, secret, bootstrapHash:createHash('sha256').update(token).digest('hex')
  });
  const company = createCompanyService(createCompanyStore(database), {
    origin, secret:randomBytes(48).toString('hex'),
    ownerSession:async cookie => {
      const result = await store.run(async state => ({
        state, response:{statusCode:200,isBase64Encoded:false,headers:{},body:JSON.stringify(isOwnerSession(cookie,state,secret))}
      }));
      return JSON.parse(result.body);
    }
  });

  function post(path, body, cookie='') {
    return (path === 'team' ? company : personal)({
      httpMethod:'POST', path:'/shixu-api/'+path,
      headers:{origin,cookie,'content-type':'application/json'}, body:JSON.stringify(body)
    });
  }
  const setup = await post('setup', {token,password:demoPassword});
  if (setup.statusCode !== 200) throw Error('Demo admin setup failed');
  const cookies = {admin:setup.headers['Set-Cookie'].split(';')[0]};
  let companyId;
  async function action(actor, body) {
    const result = await post('team', {companyId,...body}, cookies[actor]);
    const value = JSON.parse(result.body);
    if (result.statusCode !== 200) throw Error('Demo seed '+body.action+': '+value.error);
    return {value,cookie:result.headers['Set-Cookie']?.split(';')[0]};
  }
  companyId = (await action('admin',{action:'company.create',name:'示例团队'})).value.company.id;
  for (const [login,role] of Object.entries(roles)) {
    await action('admin',{action:'member.save',login,name:names[login],roles:[role],active:true});
    const invite = await action('admin',{action:'invite',login});
    cookies[login] = (await action('guest',{action:'join',login,token:invite.value.token,password:demoPassword})).cookie;
  }
  let project = (await action('admin',{action:'project.create',name:'门店服务试点',ownerLogin:'staff',reviewerLogin:'manager',participants:['staff']})).value.project;
  project = (await action('staff',{action:'project.save',id:project.id,version:project.version,progress:40,achievement:'试点流程已完成首轮检查',risk:'物料待验收',next:'收集反馈'})).value.project;
  project = (await action('staff',{action:'project.submit',id:project.id,version:project.version})).value.project;
  project = (await action('manager',{action:'project.approve',id:project.id,version:project.version,comment:'复核完成'})).value.project;
  const projectId = project.id;
  const {revision} = (await action('admin',{action:'view',scope:'manage'})).value.company;
  const template = {
    id:'tpl_pilot',name:'试点成交额',description:'按成交日填报，单位为元',dimension:'total',
    writer:'project-owner',active:true,fields:[{key:'amount',label:'成交额',kind:'money',required:true,definition:'当日成交金额'}],metrics:[]
  };
  await action('manager',{action:'ops.configure',projectId,stores:[],builtinSheets:[],templates:[template],revision});
  const today = todayShanghai();
  const yesterday = new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  for (const [date,amount] of [[yesterday,123400],[today,156700]]) {
    let record = (await action('staff',{action:'ops.save',projectId,sheet:template.id,date,version:0,rows:[{storeId:'all',storeName:'全项目',values:{amount}}]})).value.record;
    record = (await action('staff',{action:'ops.submit',id:record.id,version:record.version})).value.record;
    if(date===yesterday) await action('manager',{action:'ops.approve',id:record.id,version:record.version,comment:'示例数据已核对'});
  }
  return {
    personal, company,
    login:role => role === 'admin' ? post('login',{password:demoPassword}) : post('team',{action:'login',companyId,login:role,password:demoPassword})
  };
}
