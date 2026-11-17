import type {CompanyReviewCursor} from './company-review.ts';

export type ReviewReminder={count:number;revision:number};

export async function readReviewReminder(
 request:(body:Record<string,unknown>)=>Promise<any>,companyId:string,previous:ReviewReminder|null,
 active:()=>boolean=()=>true
):Promise<ReviewReminder|null>{
 let cursor:CompanyReviewCursor|null=null,revision:number|undefined,count=0;
 do{
  const page=await request({action:'review.reminder',companyId,...(cursor?{cursor,revision}:{knownRevision:previous?.revision})});
  if(!active())return null;
  if(page.unchanged&&previous&&page.companyRevision===previous.revision)return previous;
  if(!Number.isSafeInteger(page.count)||page.count<0||!Number.isSafeInteger(page.companyRevision)||
     (revision!==undefined&&revision!==page.companyRevision))throw Error('待确认提醒需要刷新');
  revision=page.companyRevision;count+=page.count;
  cursor=page.nextCursor;
 }while(cursor&&count<100);
 return {count:Math.min(100,count),revision:revision!};
}
