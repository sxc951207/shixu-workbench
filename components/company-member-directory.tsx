'use client';
import React,{useEffect,useState} from 'react';
import {ChevronDown,Plus} from 'lucide-react';
import {companyRequest} from '../cloud/company-root';
import type {Member,Project} from '../cloud/company/model';
import {assignmentLabels,assignmentOptions,memberProjectRoles,proposeAssignment} from '../lib/workbench/member-projects';
import type {Assignment} from '../lib/workbench/member-projects';
import './company-admin.css';

type Props = {
  companyId:string; revision:number; members:Member[]; firstPage:Project[]; total:number; busy:boolean;
  onAdd:()=>void; onEdit:(member:Member)=>void; onInvite:(member:Member)=>void;
  onProject:(project:Project,draft?:Project)=>void; onRefresh:()=>void;
};
const roleNames={employee:'员工',supervisor:'主管',leader:'领导'};

export default function CompanyMemberDirectory({companyId,revision,members,firstPage,total,busy,onAdd,onEdit,onInvite,onProject,onRefresh}:Props) {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [extra,setExtra]=useState<{firstPage:Project[];projects?:Project[];error?:string}|null>(null);
  const needsMore=total>firstPage.length;
  const loadMore=!!selected && needsMore;
  useEffect(()=>{
    if(!loadMore) return;
    let live=true;
    async function load(){
      const projects=[...firstPage];
      for(let page=1;projects.length<total;page++){
        const next=await companyRequest({action:'view',companyId,scope:'manage',page});
        if(!live) return;
        if(next.company.revision!==revision || !next.projects.length) throw Error('项目已发生变化，请刷新分工。');
        projects.push(...next.projects);
      }
      if(live) setExtra({firstPage,projects});
    }
    void load().catch(cause=>{if(live)setExtra({firstPage,error:cause instanceof Error?cause.message:'读取失败'});});
    return ()=>{live=false;};
  },[companyId,revision,loadMore,total,firstPage]);
  const projects=!needsMore?firstPage:extra?.firstPage===firstPage?extra.projects:undefined;
  const error=needsMore && extra?.firstPage===firstPage && extra.error;
  const term=search.trim().toLowerCase();
  const filtered=members.filter(member=>[member.name,member.login].some(value=>value.toLowerCase().includes(term)));
  return <section className="co-panel co-directory">
    <div className="co-section-head"><h2>成员与权限</h2><button type="button" className="co-primary" disabled={busy} onClick={onAdd}><Plus size={16}/>添加成员</button></div>
    <label className="co-directory-search">查找成员<input type="search" placeholder="输入姓名或登录名" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <small className="co-muted" role="status">共 {members.length} 位成员{term?'，找到 '+filtered.length+' 位':''}</small>
    {filtered.map(member=>{
      const open=selected===member.login;
      return <div className="co-directory-person" key={member.login}>
        <button type="button" aria-expanded={open} className="co-directory-toggle" onClick={()=>setSelected(open?'':member.login)}>
          <span><strong>{member.name}</strong><small>{member.login} · {member.roles.map(role=>roleNames[role]).join(' / ')}{!member.active?' · 已停用':''}</small></span><ChevronDown size={16}/>
        </button>
        {open&&<div className="co-directory-detail">
          <div className="cdt-actions"><button type="button" className="co-text" disabled={busy} onClick={()=>onEdit(member)}>设置权限</button>
          <button type="button" className="co-text" disabled={busy||!member.active} onClick={()=>onInvite(member)}>邀请 / 重设登录</button></div>
          {error?<p role="alert">{error} <button className="co-text" type="button" disabled={busy} onClick={onRefresh}>刷新分工</button></p>:
            projects?<MemberProjects member={member} projects={projects} busy={busy} onProject={onProject}/>:<p role="status">正在读取项目分工…</p>}
        </div>}
      </div>;
    })}
    {!filtered.length&&<p className="co-muted">{members.length?'没有匹配的成员。':'还没有成员，可先添加员工或主管。'}</p>}
  </section>;
}

function MemberProjects({member,projects,busy,onProject}:{member:Member;projects:Project[];busy:boolean;onProject:Props['onProject']}) {
  const [projectId,setProjectId]=useState('');
  const [role,setRole]=useState<Assignment|''>('');
  const assigned=projects.filter(project=>memberProjectRoles(project,member.login).length);
  const project=projects.find(item=>item.id===projectId);
  const options=project?assignmentOptions(member,project):[];
  return <>
    <h3>项目分工</h3>
    {assigned.length?assigned.map(item=><div className="co-directory-project" key={item.id}><span>{item.name}<small>{memberProjectRoles(item,member.login).join(' / ')}</small></span>
      <button type="button" className="co-text" disabled={busy} aria-label={'调整分工 · '+item.name} onClick={()=>onProject(item)}>调整分工</button></div>):<p className="co-muted">尚未分配项目。</p>}
    {member.active&&projects.length>0&&<div className="co-directory-assignment">
      <label>分配到项目<select value={projectId} disabled={busy} onChange={e=>{setProjectId(e.target.value);setRole('');}}>
        <option value="">选择项目</option>{projects.filter(item=>assignmentOptions(member,item).length).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {project&&<><label>分工<select value={role} disabled={busy} onChange={e=>setRole(e.target.value as Assignment)}><option value="">选择分工</option>{options.map(option=><option key={option} value={option}>{assignmentLabels[option]}</option>)}</select></label>
        <button type="button" className="co-text" disabled={busy||!role||!options.includes(role)} onClick={()=>{if(role)onProject(project,proposeAssignment(project,member.login,role));}}>核对项目设置</button></>}
    </div>}
  </>;
}
