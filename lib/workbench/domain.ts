export type Kind = 'task' | 'project' | 'note' | 'link' | 'company' | 'routine';
export interface Entry {
    id: string;
    kind: Kind;
    title: string;
    body: string;
    due: string | null;
    priority: 'normal' | 'high';
    projectId: string | null;
    companyId: string | null;
    repeatDays: number[];
    routineId: string | null;
    routineDate: string | null;
    done: boolean;
    status: 'active' | 'waiting' | 'complete';
    nextAction: string;
    waitingFor: string;
    followUp: string | null;
    archived: boolean;
    url: string;
    category: string;
    pinned: boolean;
    deleted: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
}
export class WorkbenchError extends Error {
    status: number;
    constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function todayShanghai(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const text = (v: unknown, max: number) => {
    if (v == null)
        return '';
    if (typeof v !== 'string' || v.length > max)
        throw new WorkbenchError(`文字格式不正确或超过 ${max} 字`);
    return v.trim();
};
const flag = (v: unknown) => { if (v == null)
    return false; if (typeof v !== 'boolean')
    throw new WorkbenchError('开关格式不正确'); return v; };
const day = (v: unknown) => {
    if (v == null || v === '')
        return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
        throw new WorkbenchError('请选择有效日期');
    return v;
};
export function validateEntry(input: unknown): Entry {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new WorkbenchError('记录格式不正确');
    const x = input as Record<string, unknown>;
    const id = text(x.id, 100);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw new WorkbenchError('记录编号无效');
    const kind = x.kind as Kind;
    if (!['task', 'project', 'note', 'link', 'company','routine'].includes(kind))
        throw new WorkbenchError('记录类型无效');
    const title = text(x.title, 180), body = text(x.body, 20000);
    const companyId=text(x.companyId,100)||null;
    if(companyId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(companyId))throw new WorkbenchError('公司编号无效');
    if(kind==='company'&&(companyId||x.projectId))throw new WorkbenchError('公司不能关联其他公司或项目');
    let repeatDays:number[]=[];
    if(kind==='routine'){
        if(id.length>60)throw new WorkbenchError('每日规则编号不能超过60字符');
        const days=x.repeatDays??[1,2,3,4,5,6,7];
        if(!Array.isArray(days)||!days.length||days.length>7||days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(days).size!==days.length)throw new WorkbenchError('请至少选择一个有效星期');
        repeatDays=[...days].sort((a,b)=>a-b);
        if(!day(x.due))throw new WorkbenchError('请选择开始日期');
        if(x.projectId)throw new WorkbenchError('每日规则暂不关联项目');
    }else if(x.repeatDays!=null&&(!Array.isArray(x.repeatDays)||x.repeatDays.length))throw new WorkbenchError('重复星期只能设置在每日规则上');
    const routineId=text(x.routineId,60)||null,routineDate=day(x.routineDate);
    if(routineId||routineDate||/^daily-.+-\d{4}-\d{2}-\d{2}$/.test(id)&&kind!=='routine'){
        if(kind!=='task'||!routineId||!routineDate||!/^[a-zA-Z0-9_-]+$/.test(routineId)||id!==dailyTaskId(routineId,routineDate))throw new WorkbenchError('每日事项来源或日期无效');
    }
    if (kind === 'note' ? !body : !title)
        throw new WorkbenchError(kind === 'note' ? '请先写点内容' : '请填写标题');
    let url = text(x.url, 2048);
    if (kind === 'link') {
        try {
            const u = new URL(url);
            if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
                throw Error();
            url = u.href;
        }
        catch {
            throw new WorkbenchError('请输入完整的 http 或 https 网页链接');
        }
    }
    const priority = x.priority ?? 'normal', status = x.status ?? 'active';
    if (!['normal', 'high'].includes(String(priority)) || !['active', 'waiting', 'complete'].includes(String(status)))
        throw new WorkbenchError('状态无效');
    const now = new Date().toISOString();
    const stamp = (v: unknown) => { if (v == null)
        return now; if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
        throw new WorkbenchError('备份时间格式无效'); return new Date(v).toISOString(); };
    const version = x.version ?? 0;
    if (!Number.isSafeInteger(version) || Number(version) < 0)
        throw new WorkbenchError('版本无效');
    return { id, kind, title, body, due: day(x.due), priority: priority as Entry['priority'], projectId: text(x.projectId, 100) || null, companyId,repeatDays,routineId,routineDate,
        done: flag(x.done), status: status as Entry['status'], nextAction: text(x.nextAction, 2000), waitingFor: text(x.waitingFor, 180), followUp: day(x.followUp),
        archived: flag(x.archived), url, category: text(x.category, 80), pinned: flag(x.pinned), deleted: flag(x.deleted), version: Number(version), createdAt: stamp(x.createdAt), updatedAt: stamp(x.updatedAt) };
}
export const isTodayTask = (e: Entry, today: string) => e.kind === 'task' && !e.done && !e.deleted && !!e.due && e.due <= today;
export const dailyTaskId=(routineId:string,date:string)=>'daily-'+routineId+'-'+date;
export function inCompany(e:Entry,scope:string){if(e.kind==='company')return false;if(scope==='all')return true;if(scope==='personal')return !e.companyId;return e.companyId===scope;}
export function validateAssociations(entries:Entry[]){
 const map=new Map(entries.map(e=>[e.id,e]));
 for(const e of entries){
  if(e.routineId&&map.get(e.routineId)?.kind!=='routine')throw new WorkbenchError('每日事项的来源规则不存在，请保留规则和历史一起恢复');
  if(e.companyId){const company=map.get(e.companyId);if(company?.kind!=='company'||company.deleted)throw new WorkbenchError('所属公司不存在或仍有内容，请先将相关记录移到其他公司');}
  if(e.projectId){const project=map.get(e.projectId);if(project?.kind!=='project')throw new WorkbenchError('关联项目不存在，请刷新后重试');if((project.companyId||null)!==(e.companyId||null))throw new WorkbenchError('关联项目与事项必须属于同一家公司');}
 }
 // Match SQLite lower(): ASCII letters fold; other characters retain their case.
 const names=new Set<string>();for(const e of entries.filter(e=>e.kind==='company'&&!e.deleted)){const name=e.title.trim().replace(/[A-Z]/g,c=>c.toLowerCase());if(names.has(name))throw new WorkbenchError('已有同名公司，请换一个名称');names.add(name);}
}
export function parseBackup(input: unknown): Entry[] {
    if (!input || typeof input !== 'object')
        throw new WorkbenchError('不是有效备份');
    const b = input as {
        format?: unknown;
        version?: unknown;
        records?: unknown;
    };
    if (b.format !== 'shixu-workbench' || b.version !== 1 || !Array.isArray(b.records) || b.records.length > 10000)
        throw new WorkbenchError('备份格式或版本不支持（最多一万条）');
    const required = ['id', 'kind', 'title', 'body', 'due', 'priority', 'projectId', 'done', 'status', 'nextAction', 'waitingFor', 'followUp', 'archived', 'url', 'category', 'pinned', 'deleted', 'version', 'createdAt', 'updatedAt'];
    for (const raw of b.records) {
        if (!raw || typeof raw !== 'object' || required.some(k => !Object.hasOwn(raw, k)) || typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string' || !Number.isSafeInteger(raw.version) || raw.version < 1)
            throw new WorkbenchError('备份记录缺少完整内容或有效元数据，请选择拾序导出的原始备份');
    }
    const entries = b.records.map(validateEntry);
    if (new Set(entries.map(e => e.id)).size !== entries.length)
        throw new WorkbenchError('备份包含重复编号');
    return entries;
}
