import type {ApprovalFlow} from './approval-flow.ts';
import type{OperatingConfig,OperatingProposal}from'./operating-model.ts';
import type {ProjectWork} from './work-model.ts';
export type Role='employee'|'supervisor'|'leader';
export type Actor={owner?:boolean;companyId?:string;login?:string};
export type Member={login:string;name:string;roles:Role[];managerId:string;active:boolean};
export type OrganizationLevel={id:string;name:string};
export type Stage='draft'|'submitted'|'returned'|'approved';
export type ProjectHead={approvalChain?:string[];approvalFlow?:ApprovalFlow;deletedAt?:string;id:string;name:string;ownerLogin:string;reviewerLogin:string;progressLeaderLogin?:string;progressReviewLogin?:string;participants:string[];status:Stage;version:number;publishedVersion:number;submittedBy:string};
export type DailySchedule={projectId:string;login:string;month:string;days:number[]};
export type Company={organizationLevels?:OrganizationLevel[];memberLevels?:Record<string,string>;pendingApprovers?:Record<string,Record<string,number>>;id:string;name:string;revision:number;createdAt:string;members:Member[];projects:ProjectHead[];dailySchedules?:DailySchedule[];policy:{daily:number;monthly:number;yearly:number};reportMonths?:Record<string,{revision:number;versions:number;count:number}>;operatingConfigs?:OperatingConfig[];operatingProposals?:OperatingProposal[];operatingMonths?:Record<string,{revision:number;versions:number;count:number}>};
export type Project=ProjectHead&{companyId:string;progress:number;achievement:string;risk:string;next:string;createdAt:string;updatedAt:string;comment:string;reviewerName:string;published:Published|null;work?:ProjectWork;submittedAt?:string|null};
export type Published=Omit<Project,'published'>;
export type Version={project:Project;action:string;actor:string;at:string};
export type Account={companyId:string;login:string;auth?:{salt:string;hash:string;epoch:string};invite?:{hash:string;expires:number};failed:number;blockedUntil:number};
export type ReportHead={approvalFlow?:ApprovalFlow;id:string;projectId:string;authorLogin?:string;kind:'daily'|'weekly'|'monthly';start:string;end:string;status:Stage;version:number;publishedVersion:number;submittedBy:string};
export type PeriodReport=ReportHead&{companyId:string;projectName:string;ownerLogin:string;reviewerLogin:string;progress:number|null;achievement:string;risk:string;next:string;help:string;changeReason?:string;sourceVersions:number[];submittedName:string;submittedAt:string|null;createdAt:string;updatedAt:string;comment:string;reviewerName:string;published:ReportSnapshot|null};
export type ReportSnapshot=Omit<PeriodReport,'published'>;
export type ReportVersion={report:PeriodReport;action:string;actor:string;at:string};
export type ReportIndex={revision:number;versions:number;items:ReportHead[]};

export function activeProjects(company:Company){return company.projects.filter(project=>!project.deletedAt);}
