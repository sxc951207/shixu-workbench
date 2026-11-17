import type {Entry} from './domain.ts';
export function addDays(day:string,offset:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function parseQuickTask(raw:string,today:string,enabled=true){
  const plain={title:raw.trim(),due:today,recognized:false};
  if(!enabled)return plain;
  const m=/^(今天|明天|后天|下周[一二三四五六日天]|周[一二三四五六日天])\s+([\s\S]+)$/.exec(raw.trim());
  if(!m||!m[2].trim())return plain;
  const weekdays:Record<string,number>={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0};
  let offset=({'今天':0,'明天':1,'后天':2} as Record<string,number>)[m[1]];
  if(offset==null){const now=new Date(today+'T12:00:00Z').getUTCDay(),target=weekdays[m[1].slice(-1)];offset=m[1].startsWith('下周')?7-((now+6)%7)+((target+6)%7):(target-now+7)%7;}
  return {title:m[2].trim(),due:addDays(today,offset),recognized:true};
}
export function weekPlan(records:Entry[],today:string){return Array.from({length:7},(_,i)=>{const date=addDays(today,i);return{date,count:records.filter(e=>e.kind==='task'&&!e.deleted&&!e.done&&e.due===date).length};});}
export type TimerMode='focus'|'break';
export interface TimerState{mode:TimerMode;remaining:number;endsAt:number|null;}
export function newTimer(mode:TimerMode='focus'):TimerState{return{mode,remaining:mode==='focus'?1500:300,endsAt:null};}
export function timerRemaining(state:TimerState,now:number){return state.endsAt===null?state.remaining:Math.max(0,Math.ceil((state.endsAt-now)/1000));}
export function toggleTimer(state:TimerState,now:number):TimerState{const remaining=timerRemaining(state,now);return state.endsAt!==null&&remaining>0?{...state,remaining,endsAt:null}:{...state,remaining:remaining||newTimer(state.mode).remaining,endsAt:now+(remaining||newTimer(state.mode).remaining)*1000};}
export function restoreTimer(raw:unknown):TimerState|null{if(!raw||typeof raw!=='object')return null;const x=raw as TimerState;if(!['focus','break'].includes(x.mode)||!Number.isSafeInteger(x.remaining)||x.remaining<0||x.remaining>(x.mode==='focus'?1500:300)||x.endsAt!==null&&(!Number.isSafeInteger(x.endsAt)||x.endsAt<0))return null;return{mode:x.mode,remaining:x.remaining,endsAt:x.endsAt};}
