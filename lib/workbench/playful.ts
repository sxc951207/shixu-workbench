import type {Entry} from './domain.ts';
import type {TimerState} from './productivity.ts';
export const TASK_CELEBRATION='shixu-task-completed';
export const FOCUS_CELEBRATION='shixu-focus-finished';
export interface EffectPoint{x:number;y:number}
export function taskCompletionCue(before:Entry|undefined,next:Entry|null|undefined){return !!before&&!!next&&before.id===next.id&&before.kind==='task'&&next.kind==='task'&&!before.done&&next.done&&!before.deleted&&!next.deleted&&next.version>before.version;}
export function focusCompletionCue(timer:TimerState,now:number,lastSeen:number|null){return timer.mode==='focus'&&timer.endsAt!==null&&now>=timer.endsAt&&now-timer.endsAt<=60000&&lastSeen!==timer.endsAt?timer.endsAt:null;}
export function companyTheme(scope:string){let hue=190;if(scope==='personal')hue=155;else if(scope!=='all'){let hash=2166136261;for(const c of scope)hash=Math.imul(hash^c.charCodeAt(0),16777619);hue=(hash>>>0)%360;}return{accent:`hsl(${hue},85%,78%)`,deep:`hsl(${hue},78%,68%)`,glow:`hsla(${hue},85%,65%,.22)`,soft:`hsla(${hue},80%,65%,.12)`,border:`hsla(${hue},85%,75%,.55)`};}
