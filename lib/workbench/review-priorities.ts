import type {CompanyReviewItem} from './company-review.ts';

function submissionTime(item:CompanyReviewItem) {
 const time=Date.parse(item.submittedAt||'');
 return Number.isFinite(time)?time:Infinity;
}

export function reviewPriorities(items:CompanyReviewItem[]) {
 const byTime=[...items].sort((a,b)=>submissionTime(a)-submissionTime(b)||a.id.localeCompare(b.id));
 const amendments=byTime.filter(item=>item.amendment);
 return {
  oldest:byTime.find(item=>Number.isFinite(submissionTime(item))),
  missingTime:byTime.some(item=>!Number.isFinite(submissionTime(item))),
  amendments:[...amendments.filter(item=>item.type==='operating'),...amendments.filter(item=>item.type!=='operating')],
 };
}
