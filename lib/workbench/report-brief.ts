import {dailyTasks} from './daily.ts';
import {todayShanghai,type Entry} from './domain.ts';

export type BriefSource={id:string;start:string;end:string;author:string;authorLogin:string;version:number;achievement:string;risk:string;next:string;help:string};
export const briefFields=['achievement','risk','next','help'] as const;
export type BriefField=typeof briefFields[number];
export type BriefPoint={text:string;sources:BriefSource[]};
export const fieldTitles:Record<BriefField,string>={achievement:'主要成果',risk:'风险与阻碍',next:'下一步',help:'需要协调'};

function combineUpdates(points:BriefPoint[]):BriefPoint[]{
 const separate:BriefPoint[]=[],topics=new Map<string,BriefPoint[]>();
 for(const point of points){
  const topic=/^([^：:\n]{4,32})[：:]\s*(.+)$/u.exec(point.text)?.[1].trim();
  const authors=new Set(point.sources.map(s=>s.authorLogin));
  if(!topic||authors.size!==1||!point.sources[0].authorLogin||/^(今日|本周|本月|今日工作|本期成果|工作内容|工作总结|主要成果|下一步计划|风险与阻碍)$/u.test(topic)){separate.push(point);continue;}
  const key=JSON.stringify([point.sources[0].authorLogin,topic]);
  const group=topics.get(key)||[];group.push(point);topics.set(key,group);
 }
 for(const group of topics.values()){
  const timeline=group.flatMap(point=>point.sources.map(source=>({point,source}))).sort((a,b)=>a.source.start.localeCompare(b.source.start));
  const first=timeline[0],last=timeline.at(-1)!;
  if(group.length===1||first.point===last.point||new Set(timeline.map(x=>x.source.start)).size!==timeline.length){separate.push(...group);continue;}
  const [topic]=first.point.text.split(/[：:]/u);
  const update=(p:BriefPoint)=>p.text.slice(topic.length+1).trim();
  separate.push({text:topic+'（'+first.source.start.slice(5)+' 至 '+last.source.start.slice(5)+'）'+update(first.point)+' → '+update(last.point),sources:timeline.map(x=>x.source)});
 }
 return separate;
}
export function briefSections(sources:BriefSource[],start:string,end:string):Record<BriefField,BriefPoint[]>{
 const result:Record<BriefField,BriefPoint[]>={achievement:[],risk:[],next:[],help:[]};
 for(const field of briefFields){
  const groups=new Map<string,BriefPoint>();
  for(const source of sources){
   if(source.start<start||source.end>end)continue;
   for(const raw of source[field].split(/[\n。；;]+/u)){
    const text=raw.replace(/^\s*[•·-]\s*/u,'').trim();
    if(!text||/^(无|暂无|无风险|无阻碍|无须协调|不涉及|未填写|无。)$/u.test(text))continue;
    const key=text.replace(/[\s，,、！!。]+/gu,'');
    const item=groups.get(key)||{text,sources:[]};
    if(!item.sources.some(s=>s.id===source.id))item.sources.push(source);
    groups.set(key,item);
   }
  }
  const score=(p:BriefPoint)=>(field==='achievement'&&/交付|验收|完成|签约|上线|通过|解决/u.test(p.text)?4:0)
   +(field==='risk'&&/延期|阻塞|逾期|超期/u.test(p.text)?3:0)+Math.min(p.sources.length,3);
  result[field]=combineUpdates([...groups.values()]).sort((a,b)=>score(b)-score(a)||b.sources.at(-1)!.start.localeCompare(a.sources.at(-1)!.start));
 }
 return result;
}
/** Keep the reported wording and attach frequency only when independent reports support it. */
export function describePoint(field:BriefField,point:BriefPoint,kind:'weekly'|'monthly'){
 const periods=new Set(point.sources.map(s=>s.start)).size;
 if(periods<2)return point.text;
 const unit=kind==='weekly'?'天':'周';
 const label=field==='risk'||field==='help'?'重复提及':'均有记录';
 return point.text+'（'+periods+unit+label+'）';
}
export function taskCandidates(records:Entry[],day:string){
 const scheduled=day===todayShanghai()?dailyTasks(records,day):[];
 return [...records,...scheduled].filter(r=>r.kind==='task'&&!r.deleted&&!r.archived&&(r.routineDate?r.routineDate===day:(r.due===day||todayShanghai(new Date(r.updatedAt))===day||!r.done&&r.due&&r.due<day&&todayShanghai(new Date(r.createdAt))<=day)))
  .sort((a,b)=>Number(b.done)-Number(a.done)||b.updatedAt.localeCompare(a.updatedAt));
}
