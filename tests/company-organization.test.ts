import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture} from './fixtures/company.ts';
import {assertMemberCanDeactivate} from '../lib/workbench/organization.ts';
import {organizationAction} from '../cloud/company/organization.ts';
import {companyKey,versionKey} from '../cloud/company/core.ts';
import {archiveManifest,archiveVersionCount,parseArchiveVersion,projectArchiveHead} from '../lib/workbench/company-archive.ts';
import type {Actor,Company,Version} from '../cloud/company/model.ts';
import {approvalCountKey} from '../cloud/company/approval-flow.ts';

async function fixture(){
  const f=await companyFixture(), companyId=f.company.id;
  const command=(body:Record<string,unknown>,actor:Actor=f.owner)=>f.store.run(tx=>organizationAction(tx,actor,{companyId,...body}));
  const state=()=>f.store.run(tx=>tx.get<Company>(companyKey(companyId))).then(c=>c!);
  const read=()=>command({action:'organization.read'}) as Promise<{revision:number;levels:{id:string;name:string}[];assignments:{login:string;levelId:string;managerId:string}[]}>;
  return {...f,command,state,read};
}

test('administrator manages ordered local levels and reporting lines, rejecting orphaned, invalid and stale changes',async()=>{
  const f=await fixture(), other=(await f.run(f.owner,{action:'company.create',name:'另一公司'})).company;
  const before=await f.read(), action='organization.save';
  assert.deepEqual(before.levels.map(l=>l.name),['员工','主管','领导']);
  await assert.rejects(f.command({action:'organization.read'},f.manager),/管理员/);
  const levels=[before.levels[0],{id:'lead',name:'组长'},before.levels[1],before.levels[2]];
  const assignments=before.assignments.map(entry=>entry.login==='other'?{...entry,levelId:'lead',managerId:'manager'}:entry.login==='staff'?{...entry,managerId:'other'}:entry);
  const updated={action,levels,assignments,revision:before.revision};
  await assert.rejects(f.command({...updated,levels:levels.filter(l=>l.id!=='lead')}),/转移/);
  await assert.rejects(f.command({...updated,assignments:assignments.map(a=>a.login==='manager'?{...a,managerId:'staff'}:a)}),/直属上级/);
  await assert.rejects(f.command({...updated,assignments:assignments.map(a=>a.login==='staff'?{...a,login:'outside'}:a)}),/成员/);
  await f.command(updated);
  await assert.rejects(f.command(updated),/变化/);
  assert.deepEqual((await f.read()).assignments,assignments);
  const second=await f.command({action:'organization.read',companyId:other.id});
  assert.ok('levels' in second);assert.deepEqual(second.levels,before.levels);
  await f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'staff',name:'新名字',roles:['employee']});
  assert.equal((await f.read()).assignments.find(a=>a.login==='staff')?.managerId,'other');
  await assert.rejects(f.run(f.owner,{action:'member.save',companyId:f.company.id,login:'other',name:'组长',roles:['employee'],active:false}),/下属/);
});

test('project approvals accept any active members, preserve past publications and survive strict archive validation',async()=>{
  const f=await fixture(), {id,version}=f.project, companyId=f.company.id;
  const old=await f.state(), change={action:'organization.projectChain',id,revision:old.revision,version};
  for(const invalid of [[],['other','other'],['outside'],['owner'],{}])await assert.rejects(f.command({...change,approvalChain:invalid}),/审批人/);
  await assert.rejects(f.command({...change,approvalChain:['other']},f.manager),/管理员/);
  await f.command({...change,approvalChain:['other','leader']});
  await assert.rejects(f.command({...change,approvalChain:['leader']}),/变化/);
  const stored=await f.state(), v=await f.store.run(tx=>tx.get<Version>(versionKey(id,version+1)));
  assert.deepEqual(v?.project.published,f.project.published);
  assert.deepEqual(projectArchiveHead(v!.project),stored.projects.find(p=>p.id===id));
  const manifest=archiveManifest({format:'shixu-company-export',version:3,revision:stored.revision,company:stored,totalVersions:archiveVersionCount(stored),exportedAt:stored.createdAt});
  assert.deepEqual(parseArchiveVersion(v,manifest),v);
  await assert.rejects(f.run(f.owner,{action:'member.save',companyId,login:'other',name:'同事',roles:['employee'],active:false}),/审批人/);
  const created=await f.run(f.owner,{action:'project.create',companyId,name:'另一个项目',ownerLogin:'staff',reviewerLogin:'manager',participants:[],approvalChain:['leader','other']});
  assert.deepEqual(created.project.approvalChain,['leader','other']);
  await f.command({...change,version:version+1,revision:(await f.state()).revision,approvalChain:null});
  assert.equal((await f.state()).projects.find(p=>p.id===id)?.approvalChain,undefined);
});

test('remaining reviewers stay active even after project routing changes or a project is trashed',async()=>{
  const f=await fixture(), c=await f.state(), project=c.projects[0];
  project.status='submitted';project.approvalFlow={steps:['manager','other','leader'],index:1};
  project.deletedAt='2026-11-20T00:00:00Z';
  assert.doesNotThrow(()=>assertMemberCanDeactivate(c,'manager'));
  assert.throws(()=>assertMemberCanDeactivate(c,'leader'),/在审/);
  project.status='approved';
  c.pendingApprovers={[project.id]:{[approvalCountKey('other')]:1}};
  assert.throws(()=>assertMemberCanDeactivate(c,'other'),/在审/);
});
test('changing project configuration during review leaves its submitted sequence and next reviewer intact',async()=>{
  const f=await fixture(), companyId=f.company.id, id=f.project.id;
  const change=async(approvalChain:string[]|null)=>{
    const c=await f.state();
    await f.command({action:'organization.projectChain',id,version:c.projects.find(p=>p.id===id)!.version,revision:c.revision,approvalChain});
  };
  const step=async(actor:Actor,action:string)=>{
    const c=await f.state();
    return (await f.run(actor,{action,companyId,id,version:c.projects.find(p=>p.id===id)!.version,comment:'已核对'})).project;
  };
  await change(['other','leader']);
  await step(f.staff,'project.amend');
  const submitted=await step(f.staff,'project.submit');
  await change(['manager']);
  const current=(await f.state()).projects.find(p=>p.id===id)!;
  assert.deepEqual(current.approvalFlow,submitted.approvalFlow);
  await assert.rejects(step(f.manager,'project.approve'),/权限/);
  await assert.rejects(f.run(f.owner,{action:'member.save',companyId,login:'leader',roles:['leader'],name:'领导',active:false}),/在审/);
  assert.equal((await step(f.other,'project.approve')).status,'submitted');
  assert.equal((await step(f.leader,'project.approve')).status,'approved');
  await f.run(f.owner,{action:'member.save',companyId,login:'leader',roles:['leader'],name:'领导',active:false});
  await step(f.staff,'project.amend');
  assert.deepEqual((await step(f.staff,'project.submit')).approvalFlow.steps,['manager']);
});
