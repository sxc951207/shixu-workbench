'use client';
import {useState} from 'react';
import type {Member,OrganizationLevel} from '../cloud/company/model';
import type {OrganizationAssignment} from '../lib/workbench/organization';

function move<T>(items:T[], index:number, offset:number) {
  const reordered = [...items];
  [reordered[index],reordered[index+offset]] = [reordered[index+offset],reordered[index]];
  return reordered;
}

function OrderButtons({index,total,label,onMove}:{index:number;total:number;label:string;onMove:(offset:number)=>void}) {
  return <span className="co-order-buttons">
    <button type="button" className="co-text" aria-label={label+'上移'} disabled={index===0} onClick={()=>onMove(-1)}>上移</button>
    <button type="button" className="co-text" aria-label={label+'下移'} disabled={index+1===total} onClick={()=>onMove(1)}>下移</button>
  </span>;
}

export function OrganizationForm({levels:initial,assignments:initialAssignments,members,busy,onSave}:{
  levels:OrganizationLevel[];assignments:OrganizationAssignment[];members:Member[];busy:boolean;
  onSave:(levels:OrganizationLevel[],assignments:OrganizationAssignment[])=>void;
}) {
  const [levels,setLevels]=useState(initial), [assignments,setAssignments]=useState(initialAssignments);
  const choices = new Map(assignments.map(entry=>[entry.login,entry]));
  const rank = new Map(levels.map((level,index)=>[level.id,index]));
  const labels = new Map(members.map(member=>[member.login,member.name+'（'+member.login+'）']));
  const active = members.filter(member=>member.active);
  const update=(login:string,change:Partial<OrganizationAssignment>)=>setAssignments(previous=>previous.map(entry=>entry.login===login?{...entry,...change}:entry));
  return <form onSubmit={e=>{e.preventDefault();onSave(levels,assignments);}}><fieldset disabled={busy} className="co-org-settings">
    <h3>组织层级</h3><p className="co-muted">从基层到最高层排列。删除层级前，先将该层级的成员调到其他层级。</p>
    {levels.map((level,index)=><div className="co-order-row" key={level.id}>
      <label>第 {index+1} 层<input required maxLength={40} value={level.name} onChange={e=>setLevels(levels.map(item=>item.id===level.id?{...item,name:e.target.value}:item))}/></label>
      <OrderButtons index={index} total={levels.length} label={'第'+(index+1)+'层'} onMove={offset=>setLevels(move(levels,index,offset))}/>
      <button type="button" className="co-text" disabled={levels.length===1||assignments.some(entry=>entry.levelId===level.id)} onClick={()=>setLevels(levels.filter(item=>item.id!==level.id))}>删除层级</button>
    </div>)}
    <button type="button" className="co-text" disabled={levels.length>=200} onClick={()=>setLevels([...levels,{id:'level_'+crypto.randomUUID(),name:''}])}>添加层级</button>
    {assignments.length>0&&<><h3>成员分层与直属上级</h3><p className="co-muted">层级用于记录汇报关系。成员的工作台权限在「成员与权限」中设置，逐级审批人在各项目设置中选择。</p></>}
    {assignments.map(entry=>{
      const peers=active.filter(member=>(rank.get(choices.get(member.login)?.levelId??'')??-1)>(rank.get(entry.levelId)??-1));
      const invalidManager=entry.managerId!=='owner'&&!peers.some(member=>member.login===entry.managerId);
      return <div key={entry.login} className="co-org-person"><strong>{labels.get(entry.login)}</strong>
        <label>所属层级<select value={entry.levelId} onChange={e=>update(entry.login,{levelId:e.target.value})}>{levels.map(level=><option key={level.id} value={level.id}>{level.name||'未命名层级'}</option>)}</select></label>
        <label>直属上级<select value={entry.managerId} onChange={e=>update(entry.login,{managerId:e.target.value})}>
          <option value="owner">管理员</option>{invalidManager&&<option disabled value={entry.managerId}>{labels.get(entry.managerId)||entry.managerId}（需重新选择）</option>}
          {peers.map(member=><option key={member.login} value={member.login}>{labels.get(member.login)}</option>)}
        </select></label>
      </div>;
    })}
    <button className="co-primary">保存组织设置</button>
  </fieldset></form>;
}

export function ChainFields({members,value,ownerLogin,onChange}:{members:Member[];value:string[]|null;ownerLogin:string;onChange:(value:string[]|null)=>void}) {
  const active=members.filter(member=>member.active);
  return <div className="co-org-settings">
    <label>审批方式<select value={value?'custom':'default'} onChange={e=>onChange(e.target.value==='custom'?['']:null)}>
      <option value="default">沿用原有审批安排</option><option value="custom">按指定人员逐级审批</option>
    </select></label>
    {value&&<><p className="co-muted">项目进度、文字汇报和经营数据按此顺序逐人审批，最后一人通过后发布。提交人不能审批自己的提交。</p>
    {ownerLogin&&value.includes(ownerLogin)&&<p className="co-warning">项目负责人也在审批名单中。要让负责人提交项目进度，请选择其他成员审批。</p>}
    {value.map((login,index)=><div className="co-order-row" key={index}>
      <label>第 {index+1} 位审批人<select required value={login} onChange={e=>onChange(value.map((current,i)=>i===index?e.target.value:current))}>
        <option value="">请选择审批人</option>{login&&!active.some(m=>m.login===login)&&<option disabled value={login}>{login}（已停用）</option>}
        {active.map(member=><option key={member.login} value={member.login} disabled={login!==member.login&&value.includes(member.login)}>{member.name}（{member.login}）</option>)}
      </select></label>
      <OrderButtons index={index} total={value.length} label={'第'+(index+1)+'位审批人'} onMove={offset=>onChange(move(value,index,offset))}/>
      <button type="button" className="co-text" disabled={value.length===1} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>移除</button>
    </div>)}
    <button type="button" className="co-text" disabled={value.length>=active.length||value.includes('')} onClick={()=>onChange([...value,''])}>添加下一级审批人</button>
    </>}
  </div>;
}

export function ProjectChainForm({chain,members,ownerLogin,busy,onSave}:{chain?:string[];members:Member[];ownerLogin:string;busy:boolean;onSave:(value:string[]|null)=>void}) {
  const [value,setValue]=useState<string[]|null>(chain??null);
  return <details className="co-admin-disclosure"><summary>逐级审批设置 · {chain?chain.length+' 级':'沿用原有安排'}</summary>
    <form onSubmit={e=>{e.preventDefault();onSave(value);}}><fieldset disabled={busy}>
      <ChainFields members={members} ownerLogin={ownerLogin} value={value} onChange={setValue}/>
      <p className="co-muted">新设置从下次提交生效。已提交的事项继续按提交时的审批安排处理。</p>
      <button className="co-primary" disabled={JSON.stringify(value)===JSON.stringify(chain??null)}>保存审批安排</button>
    </fieldset></form>
  </details>;
}
