import type {Member, ProjectHead} from '../../cloud/company/model.ts';

type ProjectSettings = Pick<ProjectHead,'name'|'ownerLogin'|'reviewerLogin'|'progressLeaderLogin'|'participants'>;
export type Assignment = 'participant' | 'owner' | 'reviewer' | 'leader';
export const assignmentLabels: Record<Assignment,string> = {
  participant:'参与人', owner:'负责人', reviewer:'确认主管', leader:'进度确认领导',
};

export function memberProjectRoles(project: ProjectSettings, login: string) {
  const roles: string[] = [];
  if (project.ownerLogin === login) roles.push(assignmentLabels.owner);
  if (project.reviewerLogin === login) roles.push(assignmentLabels.reviewer);
  if (project.progressLeaderLogin === login) roles.push(assignmentLabels.leader);
  if (project.ownerLogin !== login && project.participants.includes(login)) roles.push(assignmentLabels.participant);
  return roles;
}

export function assignmentOptions(member: Member, project: ProjectSettings) {
  const options: Assignment[] = [];
  if (!member.active) return options;
  if (!project.participants.includes(member.login)) options.push('participant');
  if (project.ownerLogin !== member.login && member.roles.some(role => role === 'employee' || role === 'supervisor')) options.push('owner');
  if (project.reviewerLogin !== member.login && member.roles.includes('supervisor')) options.push('reviewer');
  if (project.ownerLogin !== member.login && project.progressLeaderLogin !== member.login && member.roles.includes('leader')) options.push('leader');
  return options;
}

export function proposeAssignment<T extends ProjectSettings>(project: T, login: string, role: Assignment): T {
  switch (role) {
    case 'participant': return {...project, participants: [...new Set([...project.participants, login])]};
    case 'owner': return {...project, ownerLogin: login, participants: [...new Set([...project.participants, login])]};
    case 'reviewer': return {...project, reviewerLogin: login};
    case 'leader': return {...project, progressLeaderLogin: login};
  }
}

export function sameProjectSettings(original: ProjectSettings, draft: ProjectSettings) {
  const participants = new Set([draft.ownerLogin, ...draft.participants]);
  return original.name === draft.name.trim() && original.ownerLogin === draft.ownerLogin &&
    original.reviewerLogin === draft.reviewerLogin && (original.progressLeaderLogin || '') === (draft.progressLeaderLogin || '') &&
    original.participants.length === participants.size && original.participants.every(login => participants.has(login));
}
