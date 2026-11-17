import type {Entry} from './domain.ts';
import {inCompany} from './domain.ts';
import {addDays} from './productivity.ts';
export function resolveNudge(nudge:{until:number;scope:string}|null,now:number,dataReady:boolean,entries:Entry[]){return !dataReady||!nudge||now<nudge.until?{next:nudge,fired:[] as Entry[]}:{next:null,fired:entries};}
const reminderDay=(e:Entry)=>e.kind==='task'?e.due:e.followUp;
const eligible=(e:Entry)=>!e.deleted&&(e.kind==='task'&&!e.done||e.kind==='project'&&!e.archived&&e.status!=='complete');
export function attentionItems(records:Entry[],today:string,scope:string){return records.filter(e=>inCompany(e,scope)&&eligible(e)&&reminderDay(e)&&reminderDay(e)!<=today).sort((a,b)=>reminderDay(a)!.localeCompare(reminderDay(b)!)||Number(b.priority==='high')-Number(a.priority==='high'));}
const escapeText=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=(date:Date)=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function fold(line:string){const out:string[]=[];let part='',bytes=0;for(const c of line){const length=new TextEncoder().encode(c).length;if(bytes+length>75){out.push(part);part=' ';bytes=1;}part+=c;bytes+=length;}out.push(part);return out.join('\r\n');}
export function calendarReminders(records:Entry[],today:string,scope:string,nowIso:string){
 const upcoming=records.filter(e=>inCompany(e,scope)&&eligible(e)&&reminderDay(e)&&reminderDay(e)!>=today&&reminderDay(e)!<=addDays(today,30));
 if(!upcoming.length)return null;
 const now=new Date(nowIso),lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shixu//Personal Reminders//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
 for(const e of upcoming){const day=reminderDay(e)!,scheduled=new Date(day+'T09:00:00+08:00');const start=scheduled.getTime()>now.getTime()?scheduled:new Date(now.getTime()+600000);const company=records.find(c=>c.kind==='company'&&c.id===e.companyId)?.title||'个人';
 lines.push('BEGIN:VEVENT','UID:shixu-'+e.id+'@workbench.local','DTSTAMP:'+stamp(now),'DTSTART:'+stamp(start),'DTEND:'+stamp(new Date(start.getTime()+900000)),'SUMMARY:'+escapeText(company+' · '+e.title),'DESCRIPTION:'+escapeText('来自拾序：'+(e.kind==='project'?'项目跟进':'待办事项')+'。事项变更后请在日历中同步调整。'),'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:'+escapeText('拾序提醒：'+e.title),'END:VALARM','END:VEVENT');}
 lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
