import {compareOperatingImport,type ImportMonth,type OperatingImportEntry} from './operating-reimport.ts';
import {revenueDraftIssue} from './operating-data.ts';

export type PreviewDay={date:string;approved?:boolean;kind:'new'|'same'|'changed'|'check';details:string[]};

export async function previewImportDays(entries:OperatingImportEntry[],readMonth:(month:string)=>Promise<ImportMonth>){
 const months=new Map<string,ImportMonth>();
 const days:PreviewDay[]=[];
 for(const entry of entries){
  const month=entry.date.slice(0,7);
  if(!months.has(month))months.set(month,await readMonth(month));
  const data=months.get(month)!;
  const record=data.records.find(r=>r.sheet===entry.sheet&&r.date===entry.date);
  const issue=entry.skipReason||revenueDraftIssue(entry.sheet,entry.rows,record?.template??data.config?.templates?.find(t=>t.id===entry.sheet));
  if(issue){days.push({date:entry.date,kind:'check',details:[issue]});continue;}
  if(!record){days.push({date:entry.date,kind:'new',details:[]});continue;}
  try{
   const {changes}=compareOperatingImport(record,entry);
   days.push({date:entry.date,kind:changes.length?'changed':'same',approved:record.status==='approved',details:changes});
  }catch(e){days.push({date:entry.date,kind:'check',details:[(e as Error).message]});}
 }
 return days;
}

// Only report holes between imported dates. A file alone cannot establish a reporting obligation.
export function sourceDateGaps(dates:string[]){
 const sorted=[...new Set(dates)].sort(),gaps:string[]=[];
 for(let i=1;i<sorted.length;i++){
  const previous=Date.parse(sorted[i-1]+'T00:00:00Z'),current=Date.parse(sorted[i]+'T00:00:00Z');
  if(current-previous<=86400000)continue;
  const first=new Date(previous+86400000).toISOString().slice(0,10),last=new Date(current-86400000).toISOString().slice(0,10);
  gaps.push(first===last?first:first+' 至 '+last);
 }
 return gaps;
}
