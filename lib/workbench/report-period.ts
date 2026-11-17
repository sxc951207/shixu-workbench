import{WorkbenchError}from'./domain.ts';
export type ReportKind='daily'|'weekly'|'monthly';
export type ReportPeriod={kind:ReportKind;start:string;end:string};
export function reportPeriod(kind:unknown,input:unknown):ReportPeriod{
 if(kind!=='daily'&&kind!=='weekly'&&kind!=='monthly')throw new WorkbenchError('请选择周报或月报');
 if(typeof input!=='string')throw new WorkbenchError('周期日期无效');const value=kind==='monthly'&&/^\d{4}-\d{2}$/.test(input)?input+'-01':input;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new WorkbenchError('周期日期无效');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value||d.getUTCFullYear()<1970||d.getUTCFullYear()>2100)throw new WorkbenchError('周期日期无效');
 if(kind==='daily')return{kind,start:value,end:value};
 if(kind==='monthly'){const start=value.slice(0,7)+'-01',last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));return{kind,start,end:last.toISOString().slice(0,10)};}
 d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const start=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);return{kind,start,end:d.toISOString().slice(0,10)};
}
export const reportPeriodLabel=(p:ReportPeriod)=>p.kind==='daily'?p.start:p.kind==='monthly'?p.start.slice(0,4)+'年'+Number(p.start.slice(5,7))+'月':p.start+' — '+p.end;
