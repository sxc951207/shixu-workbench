import {operatingImportDate} from './operating-import-layout.ts';
import {matchImportStore} from './operating-store-match.ts';

type Cell={row:number;column:number;bytes:Uint8Array};
const compact=(s:string)=>s.replace(/\s/g,'');
const amount=(s:string)=>{
 const text=compact(s);
 if(!/^(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d{1,2})?$/.test(text))return '';
 return text.replace(/[,，]/g,'');
};
const cents=(s:string)=>Math.round(Number(s)*100);
const sumLabel=(s:string)=>/^(?:(?:当日|全店|门店|每日|总业绩)?合计|总计|月总业绩目标)$/.test(compact(s));
const targetLabel=(s:string)=>/月(?:度|总)?(?:业绩)?(?:指标|目标)/.test(compact(s));
const name=(s:string)=>compact(s).replace(/^[”"'“|/]+|[”"'“|/]+$/g,'');

// Accept only a unique combination of observed cell readings that matches a printed total.
export function reconciledRevenue(cells:string[][]){
 const options=cells.map(reads=>[...new Set(reads.map(amount).filter(Boolean).map(cents))]);
 if(options.length<2||options.some(o=>!o.length))return;
 const totals=new Set(options.at(-1)),values=options.slice(0,-1),chosen:number[]=[];
 let visits=0,solutions=0,answer:number[]|undefined;
 function visit(i:number,sum:number){
  if(++visits>50000||solutions>1)return;
  if(i===values.length){if(totals.has(sum)){solutions++;answer=[...chosen,sum];}return;}
  for(const n of values[i]){chosen.push(n);visit(i+1,sum+n);chosen.pop();if(visits>50000||solutions>1)break;}
 }
 visit(0,0);return solutions===1&&visits<=50000?answer?.map(n=>(n/100).toString()):undefined;
}

export async function readRevenueGrid(rows:string[][],header:number,last:number,reference:string,stores:{id:string;name:string}[],labels:Cell[],texts:string[],cell:(r:number,c:number,zoom?:number)=>Promise<Cell>,read:(cells:Cell[],chinese:boolean,unrestricted?:boolean)=>Promise<string[]>,live:()=>boolean,printedName:(column:number)=>string,targetsOnly:boolean){
 const raw=rows[header],width=raw.length;
 const readings=new Map(labels.map(({row,column},i)=>[row+':'+column,texts[i]||'']));
 const sources=(r:number,c:number)=>[readings.get(r+':'+c)||'',rows[r]?.[c]||''].map(name);
 const known=(s:string)=>{try{return matchImportStore(s,stores).name;}catch{return '';}};
 if(!sources(header,0).some(s=>s==='日期')||width<3)return;
 const headers=raw.map((_,c)=>sources(header,c));
 if(!headers.slice(1).some(choices=>choices.some(s=>!!known(s)||/店$|分院$/.test(s))))return;
 if(!headers.at(-1)?.some(sumLabel)&&!rows.slice(header+1,header+4).some(r=>sumLabel(r[width-1]||'')))return;
 const heading=['日期'];
 const unresolved:Cell[]=[];
 for(let c=1;c<width-1;c++){
  heading[c]=headers[c].map(known).find(Boolean)||headers[c].find(s=>/[店院]$/.test(s))||headers[c].find(Boolean)||'';
  if(!known(heading[c]))unresolved.push(await cell(header,c,1.5));
 }
 const names=await read(unresolved,true);if(!live())return;
 for(const [i,{column}] of unresolved.entries()){
  const extra=name(names[i]||'');const original=headers[column].filter(s=>s&&s===extra&&/[店院]$/.test(s));
  heading[column]=known(extra)||(original.length===2?extra:printedName(column))||(/[店院]$/.test(extra)&&!/[店院]$/.test(heading[column])?extra:heading[column]);
 }
 heading.push('合计');
 const year=rows.slice(0,header).flat().join(' ').match(/(\d{4})\s*年\s*\d{1,2}\s*月/)?.[1];
 const businessReference=year?year+reference.slice(4):reference;
 const dated=(s:string)=>{try{return operatingImportDate(s,businessReference);}catch{return '';}};
 const facts:{row:number;label:string}[]=[];
 let days=0;
 for(let r=header+1;r<=last;r++){
  const keys=sources(r,0),date=keys.map(dated).find(Boolean);
  if(date){facts.push({row:r,label:date});days++;continue;}
  const numeric=rows[r].slice(1).some(s=>!!amount(s));
  if(keys.some(sumLabel)&&numeric){facts.push({row:r,label:'合计'});continue;}
  if(!numeric&&rows[r].slice(1).some(s=>compact(s).includes('每日业绩')))continue;
  if(!days&&numeric&&(keys.some(targetLabel)||headers.at(-1)?.some(targetLabel)&&rows.slice(r+1,r+2).some(row=>row.some(s=>compact(s).includes('每日业绩'))))){
   facts.push({row:r,label:'月业绩指标'});continue;
  }
  if(rows[r].some(s=>s.includes('%')||s.includes('％'))||keys.some(s=>s.includes('完成率')))continue;
  if(rows[r].some(s=>s.trim()))facts.push({row:r,label:keys.find(Boolean)||'待核对日期'});
 }
 if(targetsOnly){
  const targetFacts=facts.filter(f=>f.label==='月业绩指标');
  if(!targetFacts.length)throw Error('没有读到月业绩指标行，请保留截图顶部的门店名称、目标金额和月份。');
  facts.splice(0,facts.length,...targetFacts);
 }else if(!days)return;
 const out=rows.slice(0,header).map(r=>[...r]);out.push(heading);
 const discrepancies:string[]=[],uncertain:string[]=[];
 const batch:Cell[]=[];
 for(const {row} of facts)for(let c=1;c<width;c++)batch.push(await cell(row,c));
 const scanned=await read(batch,false);if(!live())return;
 const votes=facts.map(({row},i)=>heading.slice(1).map((_,c)=>[rows[row][c+1]||'',scanned[i*(width-1)+c]||'']));
 const retry:Cell[]=[];
 for(const [i,values] of votes.entries())if(!reconciledRevenue(values)){
  for(let c=1;c<width;c++)retry.push(await cell(facts[i].row,c,2));
 }
 const alternate=await read(retry,false,true);if(!live())return;
 for(const [i,{row,column}] of retry.entries())votes[facts.findIndex(f=>f.row===row)][column-1].push(alternate[i]||'');
 for(const [i,values] of votes.entries()){
  const {label}=facts[i],verified=reconciledRevenue(values);
  if(!verified){
   discrepancies.push(label);
   for(let c=1;c<width;c++)uncertain.push(out.length+':'+c);
  }
  out.push([label,...(verified||values.map(v=>v.map(amount).find(Boolean)||v.find(s=>s.trim())||''))]);
 }
 const sourceRows=[...rows.slice(0,header+1).map((_,i)=>i),...facts.map(f=>f.row)];
 return {rows:out,header,uncertain,days,discrepancies,sourceRows,revenueMatrix:true};
}

export function checkRevenueOcrTotals(matrix:unknown[][],header:number){
 const rows=matrix.slice(header+1).filter(r=>r.some(s=>String(s??'').trim()));
 const check=(row:unknown[])=>{
  const source=row.slice(1).map(s=>String(s??'').trim()),amounts=source.map(amount);
  if(source.some((s,i)=>s&&!amounts[i]))throw Error(String(row[0])+' 有无法识别的金额，请核对原图。');
  if(amounts.at(-1)&&amounts.slice(0,-1).reduce((sum,s)=>sum+cents(s),0)!==cents(amounts.at(-1)!))throw Error(String(row[0])+' 的门店金额与原图合计尚未核对一致，请对照原图检查金额与合计。');
 };
 rows.forEach(check);
 const total=rows.find(r=>sumLabel(String(r[0]))),facts=rows.filter(r=>!targetLabel(String(r[0]))&&!sumLabel(String(r[0])));
 if(total&&facts.length)for(let c=1;c<total.length;c++){
  if(amount(String(total[c]??''))&&facts.reduce((n,r)=>n+cents(amount(String(r[c]??''))),0)!==cents(amount(String(total[c]))))throw Error(String(matrix[header][c])+' 的每日金额与原图列合计不一致，请核对原图。');
 }
}

export function recalculateRevenueTotals(rows:string[][],header:number){
 const next=rows.map(r=>[...r]),width=next[header]?.length??0;
 if(width<3||next[header][0]!=='日期'||!sumLabel(next[header][width-1]))throw Error('请先核对日期、门店和合计列。');
 const sums=Array<number>(width-2).fill(0),totals:string[][]=[],dates=new Set<string>();
 for(const row of next.slice(header+1)){
  if(targetLabel(row[0]))continue;
  if(sumLabel(row[0])){totals.push(row);continue;}
  const date=operatingImportDate(row[0]);
  if(dates.has(date))throw Error(date+' 重复，请先核对日期。');dates.add(date);
  const values=sums.map((_,i)=>{
   const value=amount(row[i+1]||'');
   if(!value)throw Error(date+' 的'+next[header][i+1]+'金额缺失或超过两位小数，请先核对。');
   return cents(value);
  });
  values.forEach((v,i)=>{sums[i]+=v;});row[width-1]=(values.reduce((a,b)=>a+b,0)/100).toFixed(2);
 }
 if(!dates.size||totals.length>1)throw Error('请先核对日期明细和合计行。');
 if(totals.length)totals[0].splice(1,width-1,...[...sums,sums.reduce((a,b)=>a+b,0)].map(v=>(v/100).toFixed(2)));
 return next;
}
