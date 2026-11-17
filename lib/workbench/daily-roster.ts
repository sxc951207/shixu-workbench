import type {CompanyReviewItem} from './company-review.ts';
export const MAX_DAILY_SCHEDULE_GROUPS=3000;

export type RosterStatus='due'|'submitted'|'approved'|'returned';
export type DailyRosterRow={
 projectId:string;projectName:string;login:string;name:string;
 assigned:boolean;status:RosterStatus;review?:CompanyReviewItem;
};
export type DailyRoster={
 date:string;companyRevision:number;rows:DailyRosterRow[];
 projects:{id:string;name:string;employees:{login:string;name:string}[]}[];
};
