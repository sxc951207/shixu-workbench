import {WorkbenchError} from '../../lib/workbench/domain.ts';
import type {Member,ProjectHead} from './model.ts';

/** The current assignment controls access even when reading an older confirmed snapshot. */
export function supervisedProjects(member:Member|null|undefined){
 if(!member?.active||!member.roles.includes('supervisor'))throw new WorkbenchError('没有主管项目总览权限',403);
 return (project:Pick<ProjectHead,'ownerLogin'|'reviewerLogin'>)=>project.ownerLogin===member.login||project.reviewerLogin===member.login;
}
