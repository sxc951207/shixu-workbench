import {approvalCountKey as memberLevelKey,hasPendingApproval} from '../../cloud/company/approval-flow.ts';
import type {Company, Member, OrganizationLevel} from '../../cloud/company/model.ts';
import {WorkbenchError} from './domain.ts';

export {memberLevelKey};
export const defaultOrganizationLevels: OrganizationLevel[] = [
  {id:'employee',name:'员工'}, {id:'supervisor',name:'主管'}, {id:'leader',name:'领导'},
];

export function organizationLevelFor(company: Pick<Company,'memberLevels'|'organizationLevels'>, member: Member) {
  const levels = company.organizationLevels ?? defaultOrganizationLevels;
  const explicit = company.memberLevels;
  if (explicit && Object.hasOwn(explicit, memberLevelKey(member.login))) return explicit[memberLevelKey(member.login)];
  const role = [...defaultOrganizationLevels].reverse().find(level => member.roles.some(item => item === level.id) && levels.some(item => item.id === level.id));
  return role?.id ?? levels[0].id;
}

export function validatedApprovalChain(company: Company, value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > company.members.length) {
    throw new WorkbenchError('请至少选择一位本公司已启用的审批人');
  }
  const active = new Set(company.members.filter(member => member.active).map(member => member.login));
  if (value.some(login => typeof login !== 'string' || !active.has(login)) || new Set(value).size !== value.length) {
    throw new WorkbenchError('审批人必须是本公司已启用的成员，同一人只能出现一次');
  }
  return [...value];
}

export type OrganizationAssignment = {login:string;levelId:string;managerId:string};
export function organizationAssignments(company: Company): OrganizationAssignment[] {
  return company.members.map(member => ({login:member.login,levelId:organizationLevelFor(company,member),managerId:member.managerId}));
}

export function validateOrganization(company: Company, levels: unknown, assignments: unknown) {
  if (!Array.isArray(levels) || !levels.length || levels.length > 200) throw new WorkbenchError('请保留 1 至 200 个组织层级');
  const cleanLevels: OrganizationLevel[] = levels.map(level => {
    if (!level || typeof level.id !== 'string' || !/^[a-z][a-z0-9_-]{0,49}$/.test(level.id) ||
      typeof level.name !== 'string' || !level.name.trim() || level.name.trim().length > 40) {
      throw new WorkbenchError('请为每个组织层级填写 1 至 40 字的名称');
    }
    return {id:level.id,name:level.name.trim()};
  });
  const ranks = new Map(cleanLevels.map((level,index) => [level.id,index]));
  if (ranks.size !== cleanLevels.length || new Set(cleanLevels.map(level => level.name)).size !== cleanLevels.length) {
    throw new WorkbenchError('组织层级的编号和名称均须唯一');
  }
  if (!Array.isArray(assignments) || assignments.length !== company.members.length) throw new WorkbenchError('请为每位成员指定组织层级');
  const members = new Map(company.members.map(member => [member.login,member]));
  const choices = new Map<string,OrganizationAssignment>();
  for (const entry of assignments) {
    if (!entry || !members.has(entry.login) || choices.has(entry.login) || !ranks.has(entry.levelId)) {
      throw new WorkbenchError('成员或层级选择无效，删除层级前请先转移该层级的成员');
    }
    choices.set(entry.login,{login:entry.login,levelId:entry.levelId,managerId:entry.managerId});
  }
  for (const entry of choices.values()) {
    if (entry.managerId === 'owner') continue;
    const manager = choices.get(entry.managerId);
    if (!manager || !members.get(manager.login)?.active || ranks.get(manager.levelId)! <= ranks.get(entry.levelId)!) {
      throw new WorkbenchError('直属上级须为本公司已启用、层级高于该成员的人');
    }
  }
  return {levels:cleanLevels,assignments:[...choices.values()]};
}

export function assertMemberCanDeactivate(company: Company, login: string) {
  for (const project of company.projects) {
    const flow = project.approvalFlow;
    if (project.status === 'submitted' && flow?.steps.slice(flow.index).includes(login) ||
      hasPendingApproval(company,project.id,login)) {
      throw new WorkbenchError('请先完成「' + project.name + '」中涉及该成员的在审事项，再停用成员',409);
    }
    if (project.approvalChain?.includes(login)) {
      const location = project.deletedAt ? '（位于项目回收站）' : '';
      throw new WorkbenchError('请先调整「' + project.name + '」' + location + '的逐级审批人，再停用成员',409);
    }
  }
  if (company.members.some(member => member.managerId === login)) throw new WorkbenchError('请先调整该成员下属的直属上级，再停用成员',409);
}
