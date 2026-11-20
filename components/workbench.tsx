'use client';
import {CompanyThemeToggle} from './company-appearance';
import EmployeeTour from './employee-tour';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {CSSProperties} from 'react';
import {taskCompletionCue,companyTheme,TASK_CELEBRATION} from '../lib/workbench/playful';
import type {EffectPoint} from '../lib/workbench/playful';
import PlayfulFeedback from './playful-feedback';
import WorkspaceBuddy from './workspace-buddy';
import { LayoutDashboard, CheckCheck, FolderClosed, NotebookPen, Link2, Search, Plus, ArrowUpRight, ArrowRight, Settings2, Archive, Trash2, X, Check, CalendarDays, ChevronRight, MoreHorizontal, Flag, RefreshCw, Download, Upload, Pin, Circle, Leaf, Clock3, RotateCcw, LogOut, Menu, Sprout, Building2, Zap } from 'lucide-react';
import { todayShanghai, isTodayTask, validateEntry, parseBackup, inCompany } from '../lib/workbench/domain';
import {parseQuickTask,weekPlan} from '../lib/workbench/productivity';
import {BrandScene,WorkspaceBrand} from './workspace-material';
import FocusTimer from './focus-timer';
import WorkspaceEffects from './workspace-effects';
import ReminderCenter from './reminder-center';
import DailyPanel from './daily-panel';
import CloudBackups from './cloud-backups';
import {requestRecords,loadRecords,createQuickRecord,type RecordsResponse} from '../lib/workbench/client';
import {repeatLabel,weekdays} from '../lib/workbench/daily';
import type { Entry, Kind } from '../lib/workbench/domain';
type View = 'home' | 'tasks' | 'projects' | 'notes' | 'links' | 'archive' | 'trash' | 'settings';
const labels: Record<View, string> = { home: '工作总览', tasks: '我的待办', projects: '项目跟进', notes: '随手记', links: '常用入口', archive: '已归档', trash: '回收站', settings: '备份与设置' };
const kinds: Record<Kind, string> = { task: '待办', project: '项目', note: '笔记', link: '入口', company:'公司',routine:'每日规则' };
const nav = [{ id: 'home', icon: LayoutDashboard }, { id: 'tasks', icon: CheckCheck }, { id: 'projects', icon: FolderClosed }, { id: 'notes', icon: NotebookPen }, { id: 'links', icon: Link2 }] as const;
const statusText = { active: '进行中', waiting: '等待中', complete: '已完成' };
type QuickAttempt={attempted:Entry;beforeUpdate?:Entry};
type QuickAttempts=Partial<Record<'task'|'note',QuickAttempt>>;
function readQuickDraft(quickStorageKey:string){
    if(typeof window==='undefined'||!window.location.pathname.startsWith('/workbench/'))return null;
    try{
        const data=JSON.parse(sessionStorage.getItem(quickStorageKey)||'null');
        if(!data||typeof data.quick!=='string'||data.quick.length>180||typeof data.note!=='string'||data.note.length>20000||typeof data.scope!=='string'||data.scope.length>100)return null;
        const attempts:QuickAttempts={};
        for(const kind of ['task','note'] as const){
            if(!data.attempts?.[kind])continue;
            const source=data.attempts[kind],attempted=validateEntry(source.attempted);
            const beforeUpdate=source.beforeUpdate?validateEntry(source.beforeUpdate):undefined;
            if(attempted.kind===kind&&(!beforeUpdate||(beforeUpdate.kind===kind&&beforeUpdate.id===attempted.id)))attempts[kind]={attempted,beforeUpdate};
        }
        return {quick:data.quick as string,note:data.note as string,scope:data.scope as string,smartDate:data.smartDate!==false,attempts};
    }catch{return null;}
}
export default function Workbench({ displayName, localPreview, onSignOut, api=requestRecords, memberScope='',homePriority }: {
    api?:typeof requestRecords; memberScope?:string; homePriority?:React.ReactNode;
    displayName: string;
    localPreview: boolean; onSignOut?: () => void | Promise<void>;
}) {
    const quickStorageKey=memberScope?'shixu-member-quick:'+memberScope:'shixu-owner-quick-draft-v1';
    const [restoredQuick]=useState(()=>readQuickDraft(quickStorageKey));
    const [records, setRecords] = useState<Entry[]>([]), [view, setView] = useState<View>('home'), [search, setSearch] = useState(''), [filter, setFilter] = useState('today');
    const [editing, setEditing] = useState<Entry | null>(null), [saving, setSaving] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [quick, setQuick] = useState(restoredQuick?.quick??''), [note, setNote] = useState(restoredQuick?.note??''), [menu, setMenu] = useState(false), [backup, setBackup] = useState<{
        raw: unknown;
        entries: Entry[];
    } | null>(null), [clock, setClock] = useState(() => todayShanghai());
    const quickAttempts=useRef<QuickAttempts>(restoredQuick?.attempts??{});
    const [logoutPending,setLogoutPending]=useState(false);
    const shellRef=useRef<HTMLDivElement>(null);
    const [recordsReady,setRecordsReady]=useState(false),[hasSnapshot,setHasSnapshot]=useState(false);
    const [scope,setScope]=useState(restoredQuick?.scope??'all'),[scopePending,setScopePending]=useState<string|null>(null),[motion,setMotion]=useState(true),[smartDate,setSmartDate]=useState(restoredQuick?.smartDate??true);
    function persistQuickDraft(){
        if(!window.location.pathname.startsWith('/workbench/'))return;
        try{
            if(quick.trim()||note.trim())sessionStorage.setItem(quickStorageKey,JSON.stringify({quick,note,scope,smartDate,attempts:quickAttempts.current}));
            else sessionStorage.removeItem(quickStorageKey);
        }catch{/* Private browsing or storage limits can disable tab recovery. */}
    }
    useEffect(()=>{persistQuickDraft();},[quick,note,scope,smartDate]);
    async function signOut(){
        await onSignOut?.();
        try{sessionStorage.removeItem(quickStorageKey);}catch{}
    }
    useEffect(()=>{try{setMotion(localStorage.getItem('shixu-motion')!=='off');}catch{}},[]);
    const previousScope=useRef(scope),[scopeShift,setScopeShift]=useState(0);
    useEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;setScopeShift(v=>v+1);}},[scope]);
    const palette=companyTheme(scope);
    const companyStyle={'--company-accent':palette.accent,'--company-deep':palette.deep,'--company-glow':palette.glow,'--company-soft':palette.soft,'--company-border':palette.border} as CSSProperties;
    const companies=records.filter(e=>e.kind==='company'&&!e.deleted).sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
    const scopeName=scope==='all'?'全部公司':scope==='personal'?'个人 / 未归类':companies.find(e=>e.id===scope)?.title||'未找到分区';
    const companyName=(e:Entry)=>companies.find(c=>c.id===e.companyId)?.title||'个人 / 未归类';
    const setCompany=(next:string)=>{if(saving)return;if(quick.trim()||note.trim()||editing){setScopePending(next);return;}setScope(next);setSearch('');setMenu(false);setError('');};
    useEffect(()=>{if(!loading&&scope!=='all'&&scope!=='personal'&&!companies.some(c=>c.id===scope)){if(quick.trim()||note.trim()||editing){setError('原公司分区已移除，草稿仍保留。请选择新的分区后再保存。');}else setScope('all');}},[records,loading,scope,quick,note,editing]);
    const quickParsed=parseQuickTask(quick,clock,smartDate);
    const companyPicker=<div className="company-switch"><label><Building2 size={16}/><select aria-label="选择公司分区" value={scope} disabled={saving||!hasSnapshot} onChange={e=>setCompany(e.target.value)}><option value="all">全部公司总览</option>{scope!=="all"&&scope!=="personal"&&!companies.some(c=>c.id===scope)&&<option value={scope}>原公司已移除</option>}<option value="personal">个人 / 未归类</option>{companies.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><button className="icon-button" aria-label="添加公司" disabled={saving||!hasSnapshot} onClick={()=>create('company')}><Plus size={18}/></button></div>;

    const fileInput = useRef<HTMLInputElement>(null), loadSeq = useRef(0);
    const [searchOpen, setSearchOpen] = useState(false), [globalQuery, setGlobalQuery] = useState('');
    const reload = useCallback(async () => { const seq = ++loadSeq.current; try {
        const b = await loadRecords(api);
        if (seq === loadSeq.current){setRecords(b.records);setHasSnapshot(true);setRecordsReady(true);if(b.today)setClock(b.today);setError(b.dailyError);}
        return true;
    }
    catch (e) {
        if (seq === loadSeq.current){setError((e as Error).message);setRecordsReady(false);}
        return false;
    }
    finally {
        if (seq === loadSeq.current)
            setLoading(false);
    } }, [api]);
    useEffect(() => { let day=todayShanghai();void reload(); const focus = () => { day=todayShanghai();setClock(day);void reload(); }; const visible=()=>{if(!document.hidden)focus();};window.addEventListener('focus', focus);window.addEventListener('shixu-session-restored', focus);document.addEventListener('visibilitychange',visible);const timer=setInterval(()=>{const next=todayShanghai();if(next!==day){day=next;setClock(next);void reload();}},60000);return()=>{window.removeEventListener('focus',focus);window.removeEventListener('shixu-session-restored',focus);document.removeEventListener('visibilitychange',visible);clearInterval(timer);}; },[reload]);
    useEffect(() => { if (!notice)
        return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); }, [notice]);
    useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (editing || quick || note) {
        e.preventDefault();
    } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [editing, quick, note]);
    const scoped=records.filter(e=>inCompany(e,scope));
    const live = scoped.filter(e => !e.deleted), projects = live.filter(e => e.kind === 'project' && !e.archived), tasks = live.filter(e => e.kind === 'task'), today = tasks.filter(e => isTodayTask(e, clock));
    const open = tasks.filter(e => !e.done), doneToday = tasks.filter(e => e.done && todayShanghai(new Date(e.updatedAt)) === clock), followups = projects.filter(e => e.followUp && e.followUp <= clock && e.status !== 'complete');
    const navigate = (v: View) => { setView(v); setSearch(''); setMenu(false); };
    function create(kind: Kind) { const e = { id: crypto.randomUUID(), kind, title: '', body: '', due: kind === 'task'||kind==='routine' ? clock : null, repeatDays:kind==='routine'?[...weekdays]:[], priority: 'normal', status: 'active', companyId:kind==='company'||scope==='all'||scope==='personal'?null:scope, version: 0 } as Entry; setEditing(e); }
    async function perform(run: () => Promise<RecordsResponse>, message: string) { if (saving)
        return null; setSaving(true); setError(''); try {
        const b = await run();
        if (b.record) {
            const record = b.record;
            ++loadSeq.current;
            setRecords(prev => [record, ...prev.filter(e => e.id !== record.id)]);
        }
        setNotice(message);
        return b;
    }
    catch (e) {
        setError((e as Error).message);
        return null;
    }
    finally {
        setSaving(false);
    } }
    async function save(e: Entry, origin?:EffectPoint) { const previous=records.find(r=>r.id===e.id); let clean:Entry; try {
        clean = validateEntry(e);
    }
    catch (ex) {
        setError((ex as Error).message);
        return false;
    } const result=await perform(()=>api({ action: 'save', record: clean, ...(e.version ? { expectedVersion: e.version } : {}) }), '已保存');
      if(taskCompletionCue(previous,result?.record))window.dispatchEvent(new CustomEvent(TASK_CELEBRATION,{detail:origin}));
      if(result&&e.kind==='routine'){setSaving(true);try{await reload();}finally{setSaving(false);}}
      return !!result; }
    async function saveQuick(kind:'task'|'note') {
        const title=kind==='task'?quickParsed.title:'',body=kind==='note'?note.trim():'';
        if(saving||(!title&&!body))return;
        const due=kind==='task'?quickParsed.due:null,companyId=scope==='all'||scope==='personal'?null:scope;
        const previous=quickAttempts.current[kind];
        const draft=validateEntry({id:previous?.attempted.id??crypto.randomUUID(),kind,title,body,due,companyId});
        const result=await perform(()=>createQuickRecord(draft,api,previous?.attempted,(attempted,beforeUpdate)=>{
            quickAttempts.current[kind]={attempted,beforeUpdate};
            persistQuickDraft();
        },previous?.beforeUpdate),'已保存');
        if(result){
            delete quickAttempts.current[kind];
            if(kind==='task'){setQuick('');setSmartDate(true);}else setNote('');
        }
    }
    async function convert(e: Entry) { const b = await perform(()=>api({ action: 'convert', id: e.id, version: e.version }), '已打开关联待办，原笔记保留'); if (b?.record)
        setEditing(b.record); }
    async function exportData() {
        if(saving)return;setSaving(true);setError('');
        try {
            const fresh=await api();
            const b={format:'shixu-workbench',version:1,exportedAt:new Date().toISOString(),records:fresh.records};
            const url=URL.createObjectURL(new Blob([JSON.stringify(b,null,2)],{type:'application/json'}));
            const a=document.createElement('a');a.href=url;a.download=`拾序备份-${clock}.json`;a.click();
            setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('备份已下载，请妥善保存');
        } catch(e){setError((e as Error).message);}finally{setSaving(false);}
    }
    async function readFile(file?: File) { if (!file)
        return; try {
        if (file.size > 8000000)
            throw Error('请选择 8 MB 以内的备份文件');
        const raw = JSON.parse(await file.text());
        setBackup({ raw, entries: parseBackup(raw) });
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        if (fileInput.current)
            fileInput.current.value = '';
    } }
    const counts = { home: null, tasks: open.length, projects: projects.filter(e => e.status !== 'complete').length, notes: live.filter(e => e.kind === 'note').length, links: null };
    const match = (e: Entry) => [e.title, e.body, e.nextAction, e.waitingFor, e.category, e.url].join(' ').toLowerCase().includes(search.toLowerCase());
    const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(clock + 'T04:00:00Z'));
    const cardHeader = (title: string, caption: string, v: View) => <div className="section-heading"><div><h2>{title}</h2><p>{caption}</p></div><button className="text-button" onClick={() => navigate(v)}>查看全部 <ArrowUpRight size={15}/></button></div>;
    const blank = (kind: Kind, title: string, caption: string) => <div className="empty"><span className="empty-icon">{kind === 'task' ? <CheckCheck /> : kind === 'project' ? <Sprout /> : kind === 'note' ? <NotebookPen /> : <Link2 />}</span><h3>{title}</h3><p>{caption}</p><button className="text-button" onClick={() => create(kind)}><Plus size={15}/>添加{kinds[kind]}</button></div>;
    const taskRow = (e: Entry) => <div className={'task-row ' + (e.done ? 'is-done' : '')} key={e.id}><button className="check-button" disabled={saving} aria-label={(e.done ? '恢复未完成：' : '完成：') + e.title} onClick={event => {const rect=event.currentTarget.getBoundingClientRect();void save({ ...e, done: !e.done },{x:rect.left+rect.width/2,y:rect.top+rect.height/2});}}>{e.done && <Check size={14}/>}</button><button className="task-main" onClick={() => setEditing(e)}><span>{e.title}</span><small>{scope==='all'&&<span className="company-tag">{companyName(e)}</span>}{e.projectId && <span className="task-project">{records.find(p => p.id === e.projectId)?.title || '关联项目'}</span>}{e.due && <span className={!e.done && e.due < clock ? 'overdue' : ''}>{!e.done && e.due < clock ? '已逾期 · ' : ''}{e.due === clock ? '今天' : e.due}</span>}{!e.due && !e.projectId && '未设日期'}</small></button>{e.priority === 'high' && <Flag size={14} className="priority" aria-label="高优先级"/>}<button className="icon-button row-edit" aria-label={'编辑：' + e.title} onClick={() => setEditing(e)}><MoreHorizontal size={18}/></button></div>;
    const projectCard = (e: Entry) => <button className={'project-card ' + e.status} key={e.id} onClick={() => setEditing(e)}><div className="project-top"><span className="project-symbol"><FolderClosed size={19}/></span><span className={'badge ' + e.status}>{statusText[e.status]}</span><ArrowUpRight size={17}/></div><h3>{e.title}</h3>{scope==='all'&&<span className="company-tag">{companyName(e)}</span>}<p>{e.body || '写下项目目标，让每一步更清楚。'}</p><div className="project-next"><small>下一步</small><span>{e.nextAction || '还没有设置下一步'}</span></div><div className="project-footer"><span><Circle size={11}/>{tasks.filter(t => t.projectId === e.id && !t.done).length} 项待办</span>{e.waitingFor ? <span>等待 · {e.waitingFor}</span> : e.followUp ? <span>{e.followUp} 跟进</span> : <span>持续推进中</span>}</div></button>;
    const linkCard = (e: Entry) => <article className="link-card" key={e.id}><a href={e.url} target="_blank" rel="noopener noreferrer"><span className="link-symbol">{e.title.slice(0, 1)}</span><span><strong>{e.title}</strong><small>{(scope==='all'?companyName(e)+' · ':'')+(e.category || new URL(e.url).hostname)}</small></span><ArrowUpRight size={16}/></a><button className="icon-button" aria-label={'编辑入口：' + e.title} onClick={() => setEditing(e)}><MoreHorizontal size={16}/></button></article>;
    const days=weekPlan(live,clock),overdue=open.filter(e=>e.due&&e.due<clock).length;
    const planner=<section className="panel week-panel"><div className="section-heading"><div><h2><CalendarDays size={18}/>七天计划</h2><p>提前看一眼，给接下来留好位置。</p></div><span className="mini-label">NEXT 7 DAYS</span></div><div className="week-days">{days.map((d,i)=><button key={d.date} aria-label={d.date+'，'+d.count+'项待办'} className={filter==='day:'+d.date?'selected':''} onClick={()=>{navigate('tasks');setFilter('day:'+d.date);}}><small>{i===0?'今天':new Intl.DateTimeFormat('zh-CN',{weekday:'short',timeZone:'Asia/Shanghai'}).format(new Date(d.date+'T12:00:00Z'))}</small><strong>{Number(d.date.slice(-2))}</strong><em>{d.count?d.count+' 项':'·'}</em></button>)}</div>{overdue>0&&<button className="overdue-link" onClick={()=>{navigate('tasks');setFilter('overdue');}}><Clock3 size={14}/>{overdue} 项已逾期，找个时间处理<ArrowRight size={14}/></button>}</section>;
    const visibleNotes = live.filter(e => e.kind === 'note').filter(match);
    let taskList = tasks.filter(match).filter(e => filter === 'done' ? e.done : !e.done && (filter.startsWith('day:')&&e.due===filter.slice(4)||filter==='overdue'&&!!e.due&&e.due<clock||filter === 'all' || filter === 'today' && isTodayTask(e, clock) || filter === 'future' && !!e.due && e.due > clock || filter === 'undated' && !e.due));
    taskList = taskList.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || (a.due || '9999').localeCompare(b.due || '9999'));
    return <div ref={shellRef} data-workspace-view={view} style={companyStyle} className={'app-shell '+(motion?'':'motion-off')+(scopeShift?' scope-shift-'+(scopeShift%2?'a':'b'):'')}>
    <WorkspaceEffects rootRef={shellRef} enabled={motion}/>
    {menu && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMenu(false)}/>}
    <aside className={'sidebar ' + (menu ? 'open' : '')}><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('home'); }}><WorkspaceBrand companyName={companies.find(c=>c.id===scope)?.title}/></a><div className="space-label">我的空间 <span>PERSONAL</span></div><nav>{nav.map(({ id, icon: Icon }) => <button key={id} className={'nav-item ' + (view === id ? 'active' : '')} onClick={() => navigate(id)}><Icon size={19}/><span>{labels[id]}</span>{counts[id] != null && <em>{counts[id]}</em>}</button>)}</nav><div className="side-projects"><div className="side-heading">关注的项目<button className="icon-button" aria-label="新建项目" disabled={!hasSnapshot||saving} onClick={() => create('project')}><Plus size={15}/></button></div>{projects.slice(0, 4).map((e, i) => <button className="side-project" key={e.id} onClick={() => setEditing(e)}><i style={{ background: ['#6d917e', '#ba9e75', '#879cb2', '#ac9aa9'][i] }}/>{e.title}</button>)}{!projects.length && <p className="side-empty">每个想法，都值得一个开始。</p>}</div><div className="sidebar-bottom"><div className="quiet-card"><Leaf size={19}/><p>少一点忙乱，<br />多一点从容。</p><span>MAKE ROOM FOR WHAT MATTERS</span></div><button className="nav-item" onClick={() => navigate('archive')}><Archive size={18}/><span>已归档</span></button><button className="nav-item" onClick={() => navigate('trash')}><Trash2 size={18}/><span>回收站</span></button><button className={'nav-item ' + (view === 'settings' ? 'active' : '')} onClick={() => navigate('settings')}><Settings2 size={18}/><span>备份与设置</span></button><div className="profile"><span className="avatar">我</span><span><strong>我的工作台</strong><small>仅本人可见</small></span><a className="icon-button" href={onSignOut ? "#" : "/signout-with-chatgpt?return_to=/"} onClick={onSignOut ? e=>{e.preventDefault();if(saving)return;if(editing||quick.trim()||note.trim()){setLogoutPending(true);return;}void signOut().catch(ex=>setError(ex.message));} : undefined} target="_top" aria-label="退出登录"><LogOut size={16}/></a></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setMenu(true)}><Menu size={21}/></button><span>我的空间</span><ChevronRight size={13}/><strong>{labels[view]}</strong></div><div className="top-actions"><CompanyThemeToggle/><button className="sync-button" disabled={loading || saving} onClick={() => void reload()} title="刷新最新内容"><RefreshCw size={13} className={loading || saving ? 'spin' : ''}/><span>{saving ? '正在保存' : loading ? '正在读取' : localPreview ? '本机预览' : '刷新同步'}</span></button><span className="top-divider"/><span className="avatar small">我</span></div></header>
    <main className="content">{localPreview&&<div className="preview-notice"><span>当前是本机预览。手机和电脑同步，请使用正式工作台。</span><a href="/workbench/" target="_blank" rel="noopener noreferrer">打开工作台 <ArrowUpRight size={14}/></a></div>}{view==='home'&&homePriority}{memberScope&&view==='home'&&<EmployeeTour key={memberScope} scope={memberScope}/>}<div className="company-toolbar">{memberScope?<a className="company-report-link" href="/workbench/?space=company&tab=mine"><Building2 size={16}/>公司工作台</a>:companyPicker}{!localPreview&&<a data-employee-guide="operating" className="company-report-link" href="/workbench/?space=company&tab=operating"><Building2 size={16} aria-hidden="true"/>{memberScope?'经营报表':'公司填报'}<ArrowRight size={15} aria-hidden="true"/></a>}{memberScope&&<><a data-employee-guide="reports" className="company-report-link" href="/workbench/?space=company&tab=reports"><NotebookPen size={16} aria-hidden="true"/>项目汇报</a><a data-employee-guide="help" className="member-home-link" href="/workbench/?space=company&tab=help">使用帮助</a></>}</div><div className="page-heading"><div><p className="eyebrow">{view === 'home' ? 'A LITTLE CLARITY, EVERY DAY' : 'YOUR PERSONAL SPACE'}</p><h1>{view === 'home' ? <><span className="title-part">今天，让重要的事</span><span className="title-part">先发生。</span></> : labels[view]}</h1><p className="page-subtitle">{view === 'home' ? `${dateLabel}` : view === 'tasks' ? '把想做的事，变成一件件完成的事。' : view === 'projects' ? '保持方向清晰，让事情稳步向前。' : view === 'notes' ? '先记下来，让灵感有处安放。' : view === 'links' ? '常用的工具和资料，触手可及。' : view === 'settings' ? '数据由你掌握，记得留一份备份。' : '保留走过的路，也留出新的空间。'}<span className="scope-chip"><Building2 size={12}/>{memberScope?displayName:scopeName}</span></p></div>{!['settings', 'archive', 'trash'].includes(view) && <button className="primary" disabled={!hasSnapshot||saving} onClick={() => create(view === 'projects' ? 'project' : view === 'notes' ? 'note' : view === 'links' ? 'link' : 'task')}><Plus size={17}/><span>新建{view === 'projects' ? '项目' : view === 'notes' ? '笔记' : view === 'links' ? '入口' : '待办'}</span></button>}</div>
    {error && <div className="alert error" role="alert"><span>{error}{hasSnapshot&&!recordsReady&&<small>以下是上次读取的内容。</small>}</span><button className="text-button" onClick={() => void reload()}>刷新</button><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16}/></button></div>}
    {loading ? <div className="loading-panel"><RefreshCw size={24} className="spin"/><p>正在整理你的工作空间…</p></div> : !hasSnapshot ? <section className="loading-panel"><p>尚未读取工作台数据</p><button className="secondary" onClick={()=>void reload()}>重新读取</button></section> : <>
    {view === 'home' && <><div className="overview-row"><section className="focus-hero"><div><span className="hero-label"><span /> TODAY'S FOCUS</span><h2>专注此刻，推进下一步。</h2><p>{today.length ? `今天还有 ${today.length} 项待办，不急，按自己的节奏来。` : '写下今天想完成的事，剩下的慢慢来。'}</p><button onClick={() => { navigate('tasks'); setFilter('today'); }}>查看今日清单 <ArrowRight size={16}/></button></div><BrandScene compact still={!motion} companyName={companies.find(c=>c.id===scope)?.title}/></section><div className="stat-card"><span><CheckCheck size={17}/> 今日待办</span><div>{today.length}<small>项</small></div><p>{doneToday.length ? `已经完成 ${doneToday.length} 项，继续保持` : '一步一步，也是在向前'}</p></div><div className="stat-card"><span><FolderClosed size={17}/> 进行中项目</span><div>{projects.filter(e => e.status !== 'complete').length}<small>个</small></div><p>{followups.length ? `${followups.length} 个项目今天需要跟进` : '把想法，慢慢变成现实'}</p></div></div></>}
    {view==='home'&&<DailyPanel records={records} today={clock} scope={scope} busy={saving} onCreate={()=>create('routine')} onEdit={setEditing} onToggle={(e,point)=>void save(e,point)} onOverdue={()=>{navigate('tasks');setFilter('overdue');}}/>}
    <ReminderCenter memberScope={memberScope} records={records} today={clock} scope={scope} visible={view==='home'} loading={loading||!recordsReady} onEdit={setEditing} onNotice={setNotice}/>
    {view==='home'&&<><div className="dashboard-grid"><div className="dashboard-main"><section className="panel tasks-panel">{cardHeader('今日待办', '专注眼前，完成一件是一件。', 'tasks')}<form className="quick-add" onSubmit={e => { e.preventDefault(); void saveQuick('task'); }}><Plus size={18}/><input aria-label="快速添加今日待办" placeholder="例如：明天 整理资料" maxLength={180} value={quick} disabled={saving} onChange={e => {setQuick(e.target.value);setSmartDate(true);}}/><span className="quick-date"><CalendarDays size={13}/> {quickParsed.due===clock?'今天':quickParsed.due.slice(5)}</span><button type="submit" disabled={saving || !quick.trim()} className="quick-submit" aria-label="添加今日待办"><ArrowRight size={17}/></button></form><div className="quick-hint"><span>{quickParsed.recognized?`日期已识别：${quickParsed.due}`:'日期前缀：明天 / 后天 / 周一 + 空格'} · {scope==='all'?'个人 / 未归类':scopeName}</span>{quickParsed.recognized&&<button onClick={()=>setSmartDate(false)}>保留原文</button>}</div>{today.length ? <div className="task-list">{today.slice(0, 5).map(taskRow)}</div> : blank('task', '今天的清单，等你落笔', '不必一下安排太多，先从最重要的一件开始。')}<div className="panel-foot"><span><span className="tiny-dot"/><strong data-completion-counter>{doneToday.length}</strong> 项已完成</span><button className="text-button" onClick={() => { navigate('tasks'); setFilter('done'); }}>查看完成记录 <ChevronRight size={13}/></button></div></section>
    {planner}<section className="projects-section">{cardHeader('项目跟进', '让每个项目，都有明确的下一步。', 'projects')}{projects.length ? <div className="project-grid">{projects.slice(0, 4).map(projectCard)}</div> : <button className="new-project-card" onClick={() => create('project')}><span><Plus size={21}/></span><div><strong>开启你的第一个项目</strong><p>记下目标、下一步，以及需要跟进的人。</p></div><ArrowUpRight size={18}/></button>}{followups.length > 0 && <div className="followups"><h3><Clock3 size={16}/> 到期跟进</h3>{followups.map(e => <button key={e.id} onClick={() => setEditing(e)}>{e.title}<span>{e.waitingFor ? '等待 ' + e.waitingFor : e.nextAction || '查看下一步'}<ChevronRight size={14}/></span></button>)}</div>}</section></div>
    <aside className="dashboard-aside"><section className="panel note-panel"><div className="section-heading"><div><h2><NotebookPen size={18}/> 随手记</h2><p>留住一闪而过的想法。</p></div><span className="note-decoration">✳</span></div><label className="sr-only" htmlFor="quick-note">随手记内容</label><textarea id="quick-note" placeholder={'此刻有什么想法？\n记下来，就不会忘。'} maxLength={20000} value={note} disabled={saving} onChange={e => setNote(e.target.value)}/><div className="note-footer"><small>灵感不必完整</small><button disabled={!note.trim() || saving} onClick={() => void saveQuick('note')}>记下来 <ArrowUpRight size={14}/></button></div></section><section className="panel shortcuts-panel">{cardHeader('常用入口', '少一点寻找，多一点专注。', 'links')}<div className="shortcuts">{live.filter(e => e.kind === 'link').sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 4).map(linkCard)}<button className="add-shortcut" onClick={() => create('link')}><Plus size={17}/> 添加常用入口</button></div></section><FocusTimer memberScope={memberScope}/><div className="aside-quote"><span>“</span><p>把生活调成自己喜欢的频道。</p><small>YOUR PACE. YOUR SPACE.</small><Leaf size={21}/></div></aside></div></>}
    {['tasks', 'projects', 'notes', 'links'].includes(view) && <div className="view-tools"><div className="search-box"><Search size={17}/><input aria-label="搜索当前内容" placeholder="搜索标题、内容、关键词…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={15}/></button>}</div>{view === 'tasks' && <div className="filters">{[['today', '今天'], ['all', '全部待办'], ['overdue','逾期'], ['future', '未来'], ['undated', '无日期'], ['done', '已完成'],...(filter.startsWith('day:')?[[filter,filter.slice(4)]]:[])].map(([id, title]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{title}</button>)}</div>}</div>}
    {view==='tasks'&&planner}{view === 'tasks' && <section className="panel full-panel">{taskList.length ? taskList.map(taskRow) : blank('task', search ? '没有找到相关待办' : '这里暂时没有待办', search ? '试试其他关键词。' : '添加一件事，把思绪放下来。')}</section>}
    {view === 'projects' && (projects.filter(match).length ? <div className="project-grid expanded">{projects.filter(match).map(projectCard)}</div> : blank('project', search ? '没有找到相关项目' : '从一个想法，开启一个项目', '给它一个名字，再写下第一步。'))}
    {view === 'notes' && (visibleNotes.length ? <div className="notes-grid">{visibleNotes.map(e => <article className="note-card" key={e.id}><button className="note-content" onClick={() => setEditing(e)}>{e.title && <h3>{e.title}</h3>}<p>{e.body}</p></button><footer><small>{scope==='all'&&companyName(e)+' · '}{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date(e.updatedAt))}</small><button className="text-button" disabled={saving} onClick={() => void convert(e)}>转为 / 查看待办 <ArrowUpRight size={14}/></button></footer></article>)}</div> : blank('note', search ? '没有找到相关笔记' : '给灵感，留一个位置', '一句想法、一段备忘，都可以先放在这里。'))}
    {view === 'links' && (live.filter(e => e.kind === 'link').filter(match).length ? <div className="links-grid">{live.filter(e => e.kind === 'link').filter(match).sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(linkCard)}</div> : blank('link', search ? '没有找到相关入口' : '把常用的地方，放在手边', '添加网站、在线表格和资料链接。'))}
    {(view === 'archive' || view === 'trash') && <section className="panel full-panel">{records.filter(e=>(e.kind==='company'?scope==='all':inCompany(e,scope))).filter(e => view === 'trash' ? e.deleted : !e.deleted && e.kind === 'project' && e.archived).length ? records.filter(e=>(e.kind==='company'?scope==='all':inCompany(e,scope))).filter(e => view === 'trash' ? e.deleted : !e.deleted && e.kind === 'project' && e.archived).map(e => <div className="history-row" key={e.id}><span className="type-label">{kinds[e.kind]}</span><button className="history-title" onClick={() => setEditing(e)}>{e.title || e.body.slice(0, 50)}</button><button className="text-button" disabled={saving} onClick={() => void save({ ...e, ...(view === 'trash' ? { deleted: false } : { archived: false }) })}><RotateCcw size={14}/>恢复</button></div>) : <div className="empty"><Archive size={28}/><h3>{view === 'trash' ? '回收站是空的' : '还没有归档项目'}</h3><p>这里的内容会保留，方便你随时找回。</p></div>}</section>}
    {view==='settings'&&!memberScope&&!localPreview&&<section className="panel" style={{padding:'22px 26px',marginBottom:20}}><div className="section-heading"><div><h2>公司项目工作台</h2><p>进入公司的项目、待确认事项和经营报表。</p></div><a className="primary" href="/workbench/?space=company">进入测试版</a></div></section>}
    {view==='settings'&&!memberScope&&<CloudBackups localPreview={localPreview} disabled={saving} restoreBlocked={!!editing||!!quick.trim()||!!note.trim()} onBusy={setSaving} onRestored={restored=>{++loadSeq.current;setRecords(restored);setNotice('已恢复云端备份，恢复前的数据也已保护。');}}/>}
    {view === 'settings' && <section className="settings-grid"><article className="panel settings-card"><span className="settings-icon"><Download /></span><h2>给数据留个备份</h2><p>导出全部 {records.length} 条记录（{memberScope?'我的工作总览':'全部公司分区'}），包含已完成、已归档和回收站内容。保存为 JSON 文件，随时可以恢复。</p><button className="primary" onClick={exportData}><Download size={16}/>导出全部数据</button></article><article className="panel settings-card"><span className="settings-icon"><Upload /></span><h2>从备份继续</h2><p>选择拾序导出的备份文件，先查看数量，再确认合并。相同编号保留修改时间较新的版本。</p><button className="secondary" onClick={() => fileInput.current?.click()}><Upload size={16}/>选择备份文件</button><input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" onChange={e => void readFile(e.target.files?.[0])}/></article>{!memberScope&&<article className="panel settings-card"><span className="settings-icon"><Building2/></span><h2>公司分区</h2><p>各家公司单独整理；未归类事项保留在个人分区。这里只供你本人使用。</p><button className="secondary" onClick={()=>create('company')}><Plus size={16}/>添加公司</button><div className="company-list">{companies.map(c=><div key={c.id}><strong>{c.title}</strong><small>{records.filter(e=>e.companyId===c.id&&!e.deleted).length} 条</small><button className="text-button" onClick={()=>setEditing(c)}>编辑</button></div>)}</div></article>}<article className="panel settings-card"><span className="settings-icon"><Zap/></span><h2>界面动效</h2><p>光轨和卡片让页面更有呼吸感。想安静一点，随时关掉。</p><div className="motion-setting"><span>装饰动效</span><button role="switch" aria-label="装饰动效" aria-checked={motion} className="switch" onClick={()=>setMotion(v=>{try{localStorage.setItem('shixu-motion',v?'off':'on');}catch{}return !v;})}/></div><small>跟随系统的“减少动态效果”设置。</small></article><article className="panel settings-card account-card"><div><h2>只属于你的空间</h2><p>{displayName}</p><small>{localPreview ? '这里是独立本机预览。请从页面上方打开工作台，在手机和电脑使用同一份云端记录。' : '使用同一密码，在手机和电脑继续处理。保存成功后，另一设备刷新即可读取；断网时请保留当前页面重试。'}</small></div><a className="text-button" href={onSignOut ? "#" : "/signout-with-chatgpt?return_to=/"} onClick={onSignOut ? e=>{e.preventDefault();if(saving)return;if(editing||quick.trim()||note.trim()){setLogoutPending(true);return;}void signOut().catch(ex=>setError(ex.message));} : undefined} target="_top"><LogOut size={16}/>退出登录</a></article></section>}
    </>}
    <footer className="page-footer"><span>拾序 · 让日常有序，让自己从容。</span><span><span className="tiny-dot"/>仅本人可见{localPreview ? ' · 本机预览' : ''}</span></footer></main></div>
    <nav className="bottom-nav" aria-label="手机导航">{nav.map(({ id, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={21}/><span>{id === 'home' ? '总览' : id === 'tasks' ? '待办' : id === 'projects' ? '项目' : id === 'notes' ? '随手记' : '入口'}</span></button>)}</nav>
    <button className="global-search-trigger" aria-label="搜索全部内容" onClick={() => setSearchOpen(true)}><Search size={16}/><span>搜索</span><kbd>⌕</kbd></button>
    {searchOpen && <Modal title={'搜索 · '+scopeName} onClose={() => setSearchOpen(false)}><label className="search-label">搜索当前分区的待办、项目、笔记和入口<input autoFocus value={globalQuery} placeholder="输入标题、内容或关键词…" onChange={e => setGlobalQuery(e.target.value)}/></label><div className="global-results">{globalQuery.trim() ? live.filter(e => [e.title, e.body, e.nextAction, e.waitingFor, e.category, e.url].join(' ').toLowerCase().includes(globalQuery.trim().toLowerCase())).map(e => <button key={e.id} onClick={() => { setSearchOpen(false); setEditing(e); }}><span className="type-label">{kinds[e.kind]}</span><span>{e.title || e.body.slice(0, 65)}{e.archived ? '（已归档）' : ''}</span><ArrowUpRight size={15}/></button>) : <p>从一个关键词，找回你记下的事。</p>}{globalQuery.trim() && !live.some(e => [e.title, e.body, e.nextAction, e.waitingFor, e.category, e.url].join(' ').toLowerCase().includes(globalQuery.trim().toLowerCase())) && <p>没有找到相关内容，换个关键词试试。</p>}</div></Modal>}
    {scopePending!==null&&<Modal title="还有未保存的内容" onClose={()=>setScopePending(null)}><p className="modal-caption">可以把未保存的草稿一起移到所选分区。“全部公司”下新增的事项归入个人 / 未归类。</p><div className="modal-actions"><button className="secondary" onClick={()=>setScopePending(null)}>继续编辑</button><button className="primary" onClick={()=>{setScope(scopePending);setSearch('');setMenu(false);setError('');setScopePending(null);}}>带上草稿切换</button><button className="danger-button" onClick={()=>{quickAttempts.current={};setQuick('');setNote('');setEditing(null);setScope(scopePending);setSearch('');setMenu(false);setScopePending(null);}}>放弃草稿并切换</button></div></Modal>}{logoutPending&&<Modal title="还有未保存的内容" onClose={()=>setLogoutPending(false)}><p className="modal-caption">先把随手记或待办保存，再退出会更安心。你也可以明确放弃未保存内容。</p><div className="modal-actions"><button className="secondary" onClick={()=>setLogoutPending(false)}>继续编辑</button><button className="danger-button" onClick={()=>{setLogoutPending(false);void signOut().catch(ex=>setError(ex.message));}}>放弃未保存并退出</button></div></Modal>}{notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
    {editing && <Editor entry={editing} companies={companies} projects={records.filter(e => e.kind === 'project'&&!e.deleted)} busy={saving} error={error} onClose={() => setEditing(null)} onSave={async (e) => { if (await save(e)){setEditing(null);if(e.kind==='company'&&!quick.trim()&&!note.trim())setScope(e.id);} }} onDelete={async (e) => { if (await save({ ...e, deleted: !e.deleted }))
        setEditing(null); }}/>}
    {backup && <Modal onClose={() => { if (!saving)
        setBackup(null); }} title="确认恢复备份"><p className="modal-caption">将合并 {backup.entries.length} 条记录。现有未涉及的内容会保留，相同编号采用较新的版本。</p><div className="backup-counts">{(['task', 'project', 'note', 'link','company','routine'] as Kind[]).map(k => <span key={k}>{kinds[k]}<strong>{backup.entries.filter(e => e.kind === k).length}</strong></span>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setBackup(null)}>取消</button><button className="primary" disabled={saving} onClick={async () => { const r = await perform(()=>api({ action: 'import', backup: backup.raw }), '备份合并完成'); if (r) {
        setBackup(null);
        void reload();
    } }}>{saving ? '正在恢复…' : '确认合并'}</button></div></Modal>}
    <PlayfulFeedback enabled={motion}/><WorkspaceBuddy motion={motion}/>
  </div>;
}
function Modal({ children, title, onClose }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')?.focus(); }, []);
    return <dialog ref={ref} className="modal" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-heading"><div><p className="eyebrow">A PLACE FOR EVERYTHING</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭编辑"><X size={20}/></button></div>{children}</dialog>;
}
function Editor({ entry, projects, companies, busy, error, onClose, onSave, onDelete }: {
    entry: Entry;
    projects: Entry[];
    companies: Entry[];
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (e: Entry) => Promise<void>;
    onDelete: (e: Entry) => Promise<void>;
}) {
    const [e, setE] = useState(entry), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false);
    function field<K extends keyof Entry>(k: K, v: Entry[K]) { setE(old => ({ ...old, [k]: v })); setDirty(true); setDiscard(false); }
    function close() { if (busy)
        return; if (dirty && !discard) {
        setDiscard(true);
        return;
    } onClose(); }
    return <Modal title={(entry.version ? '编辑' : '新建') + kinds[entry.kind]} onClose={close}><form onSubmit={ev => { ev.preventDefault(); void onSave(e); }}><fieldset className="editor-fields" disabled={busy}>
    {e.kind!=='company'&&<label>所属公司<select aria-label="所属公司" value={e.companyId||''} onChange={v=>{field('companyId',v.target.value||null);field('projectId',null);}}><option value="">个人 / 未归类</option>{companies.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
    {e.kind === 'note' ? <><label>标题 <small>可选</small><input value={e.title} maxLength={180} placeholder="给这条笔记起个名字" onChange={v => field('title', v.target.value)}/></label><label>内容<textarea required autoFocus rows={7} maxLength={20000} value={e.body} placeholder="写下此刻的想法…" onChange={v => field('body', v.target.value)}/></label></> : <><label>{e.kind === 'company'?'公司名称':e.kind==='routine'?'固定事项':e.kind === 'project' ? '项目名称' : e.kind === 'link' ? '入口名称' : '待办事项'}<input autoFocus required maxLength={180} value={e.title} placeholder={e.kind === 'company'?'给公司起个便于识别的名字':e.kind === 'task' ? '接下来，想完成什么？' :e.kind==='routine'?'例如：晨间梳理今日重点' : e.kind === 'project' ? '给新项目一个名字' : '例如：团队资料库'} onChange={v => field('title', v.target.value)}/></label>{e.kind !== 'link' && e.kind!=='company' && <label>{e.kind === 'project' ? '目标与说明' : '备注'}<textarea rows={3} maxLength={20000} value={e.body} placeholder="补充一点细节（可选）" onChange={v => field('body', v.target.value)}/></label>}</>}
    {e.kind==='routine'&&<><fieldset className="routine-frequency"><legend>重复安排</legend><div className="routine-presets">{[{label:'每天',days:weekdays},{label:'工作日',days:[1,2,3,4,5]},{label:'周末',days:[6,7]}].map(p=><button key={p.label} type="button" aria-pressed={[...(e.repeatDays||[])].sort((a,b)=>a-b).join(',')===p.days.join(',')} onClick={()=>field('repeatDays',[...p.days])}>{p.label}</button>)}</div><div className="routine-weekdays" aria-label="选择重复星期">{weekdays.map(n=><button key={n} type="button" aria-label={'周'+['','一','二','三','四','五','六','日'][n]} aria-pressed={e.repeatDays?.includes(n)||false} onClick={()=>field('repeatDays',e.repeatDays?.includes(n)?e.repeatDays.filter(d=>d!==n):[...(e.repeatDays||[]),n])}>{'周'+['','一','二','三','四','五','六','日'][n]}</button>)}</div><p className="routine-summary">{e.repeatDays?.length?repeatLabel(e.repeatDays)+'准备一条当天待办，完成记录各自保留。':'请至少选择一天。'} 工作日指周一至周五。</p></fieldset><div className="form-grid"><label>开始日期<input required type="date" value={e.due||''} onChange={v=>field('due',v.target.value||null)}/></label><label>优先级<select value={e.priority||'normal'} onChange={v=>field('priority',v.target.value as Entry['priority'])}><option value="normal">普通</option><option value="high">优先处理</option></select></label></div><label className="checkbox-label"><input type="checkbox" checked={e.archived||false} onChange={v=>field('archived',v.target.checked)}/>暂停这项安排（已有待办和完成记录保留）</label></>}
    {e.routineId&&<p className="routine-origin">这是 {e.routineDate} 的每日事项。这里只修改本次；长期安排请在首页“每日必做 → 管理规则”里调整。</p>}
    {e.kind === 'task' && <><div className="form-grid"><label>截止日期<input type="date" value={e.due || ''} onChange={v => field('due', v.target.value || null)}/></label><label>优先级<select value={e.priority || 'normal'} onChange={v => field('priority', v.target.value as Entry['priority'])}><option value="normal">普通</option><option value="high">优先处理</option></select></label></div><label>关联项目<select value={e.projectId || ''} onChange={v => field('projectId', v.target.value || null)}><option value="">不关联项目</option>{projects.filter(p=>(p.companyId||null)===(e.companyId||null)).map(p => <option key={p.id} value={p.id}>{p.title}{p.archived ? '（已归档）' : ''}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={e.done || false} onChange={v => field('done', v.target.checked)}/>已经完成</label></>}
    {e.kind === 'project' && <><div className="form-grid"><label>项目状态<select value={e.status || 'active'} onChange={v => field('status', v.target.value as Entry['status'])}><option value="active">进行中</option><option value="waiting">等待中</option><option value="complete">已完成</option></select></label><label>下次跟进<input type="date" value={e.followUp || ''} onChange={v => field('followUp', v.target.value || null)}/></label></div><label>下一步行动<input value={e.nextAction || ''} maxLength={2000} placeholder="推进这个项目，接下来要做什么？" onChange={v => field('nextAction', v.target.value)}/></label><label>在等谁回复<input value={e.waitingFor || ''} maxLength={180} placeholder="人名或事项，可选" onChange={v => field('waitingFor', v.target.value)}/></label><label className="checkbox-label"><input type="checkbox" checked={e.archived || false} onChange={v => field('archived', v.target.checked)}/>归档项目（保留关联待办）</label></>}
    {e.kind === 'link' && <><label>网页链接<input required type="url" value={e.url || ''} maxLength={2048} placeholder="https://" onChange={v => field('url', v.target.value)}/></label><label>分类<input value={e.category || ''} maxLength={80} placeholder="例如：工作工具、资料、学习" onChange={v => field('category', v.target.value)}/></label><label className="checkbox-label"><input type="checkbox" checked={e.pinned || false} onChange={v => field('pinned', v.target.checked)}/><Pin size={14}/>固定到前列</label></>}
    {error && <p className="form-error" role="alert">{error}</p>}{discard && <p className="discard-warning">内容尚未保存。再次点关闭将放弃本次修改，也可以继续编辑。</p>}
    <div className="modal-actions">{entry.version > 0 && <button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete(e)}>{e.deleted ? <RotateCcw size={15}/> : <Trash2 size={15}/>} {e.deleted ? '恢复' : '移入回收站'}</button>}<button type="button" className="secondary" disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存' + kinds[e.kind]}</button></div>
  </fieldset></form></Modal>;
}
