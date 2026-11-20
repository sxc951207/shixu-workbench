import {WorkbenchError} from '../../lib/workbench/domain.ts';
import {defaultOrganizationLevels, memberLevelKey, organizationAssignments, validateOrganization, validatedApprovalChain} from '../../lib/workbench/organization.ts';
import {loadCompany, projectAt, saveDirectory, writeProject} from './core.ts';
import type {Actor} from './model.ts';
import type {CompanyTx} from './store.ts';

export async function organizationAction(tx: CompanyTx, actor: Actor, body: any, clock = new Date()) {
  if (!actor.owner) throw new WorkbenchError('只有管理员可查看和设置组织层级与项目审批',403);
  const {c} = await loadCompany(tx,actor,body.companyId);
  if (body.action === 'organization.read') return {
    levels:c.organizationLevels ?? defaultOrganizationLevels, assignments:organizationAssignments(c), revision:c.revision,
  };
  if (body.revision !== c.revision) throw new WorkbenchError('公司设置已发生变化，请刷新后操作',409);
  if (body.action === 'organization.save') {
    const selected = validateOrganization(c,body.levels,body.assignments);
    const byMember = new Map(selected.assignments.map(entry => [entry.login,entry]));
    c.organizationLevels = selected.levels;
    c.memberLevels = Object.fromEntries(selected.assignments.map(entry => [memberLevelKey(entry.login),entry.levelId]));
    for (const member of c.members) member.managerId = byMember.get(member.login)!.managerId;
    c.revision++;
    await saveDirectory(tx,c);
    return {revision:c.revision};
  }
  if (body.action === 'organization.projectChain') {
    const project = await projectAt(tx,c,body.id);
    if (project.version !== body.version) throw new WorkbenchError('项目已发生变化，请刷新后操作',409);
    if (body.approvalChain === null) delete project.approvalChain;
    else project.approvalChain = validatedApprovalChain(c,body.approvalChain);
    project.version++;
    project.updatedAt = clock.toISOString();
    const {companyRevision} = await writeProject(tx,c,project,body.action,actor,clock);
    return {companyRevision,version:project.version};
  }
  throw new WorkbenchError('不支持的组织设置');
}
