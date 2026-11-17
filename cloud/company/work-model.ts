export type WorkItem={id:string;kind:'milestone'|'decision';title:string;notes:string;assignee:string;start:string;due:string;status:'open'|'done';meetingDate:string|null;createdAt:string;updatedAt:string;completedAt:string|null};
export type FollowUp={id:string;kind:'item'|'project-review'|'report-review';targetId:string;recipient:string;by:string;at:string;targetVersion:number};
export type ProjectWork={items:WorkItem[];nudges:FollowUp[]};
