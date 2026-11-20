import {operatingImportDate} from './operating-import-layout.ts';

export const isPrintedWeekTotal=(label:string)=>/^第[一二三四五六七八九十\d]+周(?:合计)?$/.test(label.replace(/\s/g,''));

/** Accept a pair of pixel readings only when it is the sole way to balance a printed subtotal. */
export function uniquePrintedPair(values:string[], alternatives:string[][], total:string, decimals:number){
 const pattern=decimals===0?/^\d+$/:/^\d+(?:\.\d{1,2})?$/;
 const scaled=(v:string)=>Math.round(Number(v)*100);
 if(!pattern.test(total)||alternatives.length!==values.length)return;
 const missing=values.map((v,i)=>pattern.test(v)?-1:i).filter(i=>i>=0);
 if(missing.length>2)return;
 const delta=scaled(total)-values.reduce((sum,v)=>sum+(pattern.test(v)?scaled(v):0),0);
 const options=alternatives.flatMap((readings,i)=>{
  const old=pattern.test(values[i])?scaled(values[i]):null;
  const distinct=new Map<number,string>();
  for(const v of readings)if(pattern.test(v)&&scaled(v)!==old)distinct.set(scaled(v),v);
  return [...distinct].map(([n,v])=>({i,v,change:n-(old??0)}));
 });
 if(options.length>80)return;
 let pair:typeof options|undefined;
 for(let a=0;a<options.length;a++)for(let b=a+1;b<options.length;b++){
  const left=options[a],right=options[b];
  if(left.i===right.i||left.change+right.change!==delta||missing.some(i=>i!==left.i&&i!==right.i))continue;
  if(pair)return;
  pair=[left,right];
 }
 return pair;
}

export function describeScreenshot(rows:string[][],header:number,structured:boolean,uncertain:string[]){
 const weak=new Set(uncertain), headings=rows[header]??[];
 const headers=headings.map((v,c)=>weak.has(header+':'+c)?'':v.trim()).filter(v=>v.length>0&&v.length<=24&&/[\p{L}]/u.test(v)&&!/[|丨]/.test(v));
 // Use legible titles or labels, never the project name, file name or selected template.
 const context=structured?rows.slice(0,header+1):rows;
 const text=context.flatMap((row,r)=>row.filter((_,c)=>!weak.has(r+':'+c))).join(' ').replace(/\s/g,'');
 // A weak number in a line does not invalidate every clearly printed label in it.
 // Require several distinct business terms before using whole-line text as a clue.
 const vocabulary=['下单金额','核销金额','退款金额','总业绩','推广消耗','推广花费','自然曝光','线索成本','线索数','订单数','留资人数','库存','客户名称','日期','门店'];
 const raw=context.flat().join(' ').replace(/\s/g,'');
 const broad=vocabulary.filter(v=>raw.includes(v));
 const evidence=!structured&&broad.filter(v=>v!=='日期'&&v!=='门店').length>=3?raw:text;
 const anchors=vocabulary.filter(v=>evidence.includes(v));
 const channels=['美团','抖音'].filter(name=>evidence.includes(name));
 const hasDate=headings.some(v=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(v.trim()));
 const byStore=headings.some(v=>/^(?:门店|分店|店铺)(?:名称|名)?$|^店名$/.test(v.trim()));
 const clue=anchors.some(a=>/金额|业绩|消耗|花费|留资|订单|线索/.test(a));
 const dashboard=!structured&&clue&&/看板|概览|仪表盘|经营总览/.test(evidence)&&anchors.length>=3;
 let type='无法判断报表类型';
 if(structured)type=hasDate?'按日期排列的报表':byStore?'按门店排列的报表':'有行列的表格，业务类型待确认';
 if(dashboard)type='疑似'+(channels.length===1?channels[0]:'')+'经营看板';
 else if(channels.length===1&&clue)type=channels[0]+(hasDate?'按日报表':'经营数据（按可辨认文字判断）');
 else if(!structured&&clue)type='疑似经营报表，行列待确认';
 return {type,headers:[...new Set(headers)],anchors,dashboard};
}

/** Unknown field names are valid. Look for missing structure or several weak,
 * fragmentary readings rather than requiring any particular project vocabulary. */
export function screenshotLayoutProblem(rows:string[][],header:number,structured:boolean,uncertain:string[]){
 if(!structured)return '未找到清晰网格，无法确定文字分别属于哪一列。请截取一张完整表格，保留表头和左右边界，或导入原 Excel。';
 const labels=rows[header]||[],weak=new Set(uncertain);
 const filled=labels.map((v,c)=>({text:v.trim(),column:c})).filter(v=>v.text);
 if(filled.length>=2&&filled.every(({text})=>/^[+\-\d.,%\s]+$/.test(text))){
  return '候选第 '+(header+1)+' 行全是数字，无法确定列名和单位。请选择真正的表头行，或把表头一起截进来。';
 }
 const sparse=filled.length<2||(labels.length>=6&&filled.length*3<labels.length);
 // Repeated isolated vertical strokes attached to header words are often grid lines read as letters.
 const damaged=filled.filter(({text})=>/^(?:[|丨]+|[|丨]+\s*[a-z][a-z ]*|[a-z][a-z ]*\s*[|丨]+)$/i.test(text));
 if(damaged.length>=3&&damaged.length*4>=filled.length){
  return '第 '+(header+1)+' 行有 '+damaged.length+' 个表头像是把表格边线读成了文字，无法可靠对应指标。请上传未压缩的原图或 Excel，也可以手动整理表头。';
 }
 const fragments=filled.filter(({text,column})=>weak.has(header+':'+column)&&! /^(?:ROI|GMV|UV|PV|SKU|CTR|CPC|CPA|CVR)$/i.test(text)&&(/^[a-z]{1,3}$/i.test(text)||/[^\p{L}\p{N}\s()%（）/_.-]{2,}/u.test(text)));
 if(sparse||(fragments.length>=2&&fragments.length*2>filled.length)){
  const detail=sparse?'共 '+labels.length+' 列，只读到 '+filled.length+' 个非空列名':'有 '+fragments.length+' 个列名只读到零散字符';
  return '候选第 '+(header+1)+' 行的表头无法可靠辨认（'+detail+'）。请选择实际表头行，或放大表头后重新截图。';
 }
 return '';
}

// Compare only additive metrics over the visible daily rows. Never allocate a difference.
export function screenshotChecks(rows:string[][],header:number,reference?:string,uncertain:string[]=[],storeAmounts=false){
 const labels=rows[header]||[],axis=labels.findIndex(v=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(v.replace(/\s/g,'')));
 const warnings:string[]=[],errors:string[]=[];
 type Position={row:number;column:number};
 const totals:Position[]=[],suspects:Position[]=[];
 const differences=new Set<string>();
 const precisionHints=new Map<string,string>();
 const unreadableDates=new Set<number>();
 const result={unreadableDates,precisionHints,differences,warnings,errors,totals,suspects,dateColumn:axis},weak=new Set(uncertain);
 if(axis<0)return result;
 const numeric=/金额|券数|订单数|推广花费|点击数|消耗|成本|收入|销售额|业绩|曝光数|咨询数/;
 const numericText=/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/;
 const group:number[]=[];
 const value=(s:string)=>/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s?.trim())?Math.round(Number(s.replace(/,/g,''))*100):null;
 const all:number[]=[],week:number[]=[],monthly:number[]=[];
 const check=(index:number,indices:number[])=>{
  if(!indices.length)return;
  for(let c=0;c<labels.length;c++){
   if(!/金额|券数|花费|消耗|订单数|退款单量|线索数|咨询数|曝光|访问次数|进店次数|私信(?:咨询|留资|开口)人数|新增好评数/.test(labels[c])||/率|平均|单价|占比|目标|累计|余额|去重|ROI/i.test(labels[c]))continue;
   const expected=value(rows[index][c]);if(expected===null)continue;
   const values=indices.map(i=>value(rows[i][c]));
   const total=values.reduce<number>((n,v)=>n+(v??0),0);
   if(total===expected&&values.every(v=>v!==null))continue;
   const gap=Math.abs(expected-total);
   if(/金额|花费/.test(labels[c])&&indices.length>=4&&gap>0&&gap<100&&values.every(v=>v!==null)){
    const shorter=indices.filter(i=>!/\.\d{2}$/.test(rows[i][c].trim()));
    if(shorter.length===1)precisionHints.set(shorter[0]+':'+c,'该列合计相差 '+(gap/100).toFixed(2)+' 元，这格的小数位与其他明细不同。请核对原图或平台导出。');
   }
   const missing=indices.filter((_,j)=>values[j]===null).map(i=>rows[i][axis]);
   for(const i of indices)differences.add(i+':'+c);
   totals.push({row:index,column:c});
   warnings.push(rows[index][axis]+'「'+labels[c]+'」：'+(missing.length?'缺 '+missing.join('、')+'；':'')+'已读明细 '+total/100+'，原表合计 '+expected/100+'，相差 '+Math.abs(expected-total)/100+'。');
  }
 };
 for(let i=header+1;i<rows.length;i++){
  const cell=(rows[i][axis]||'').replace(/\s/g,'');
  if(isPrintedWeekTotal(cell)){check(i,week);week.length=0;continue;}
  if(/^(合计|总计)$/.test(cell)){check(i,group);group.length=0;week.length=0;continue;}
  if(cell==='月度'){monthly.push(i);continue;}
  if(cell==='日期待核对'||/^\d{5,7}$/.test(cell)){unreadableDates.add(i);errors.push('第 '+(i+1)+' 行日期未读清，请对照原图填写月日。');continue;}
  try{operatingImportDate(cell,reference||'2000-01-01');all.push(i);group.push(i);week.push(i);
   for(let c=0;c<labels.length;c++){
    const text=(rows[i][c]||'').trim();
    if(storeAmounts&&c!==axis&&c<labels.length-1&&/^[+-]?[\d,，]+\.\d{3,}$/.test(text)){
     precisionHints.set(i+':'+c,'门店金额按元填写，这格超过两位小数。请确认小数点或千分位，并核对原表合计。');
    }
    if(!numeric.test(labels[c])||/编号|编码|名称|说明|备注/.test(labels[c])||!text||/^(?:—|-|\/|N\/A|不适用)$/i.test(text))continue;
    if(weak.has(i+':'+c)||!numericText.test(text))suspects.push({row:i,column:c});
   }}catch{
    const row=rows[i];
    const hasFigures=row.some((v,c)=>c!==axis&&numericText.test(v.trim()));
    const weekday=row.some(v=>/^(星期|周)[一二三四五六日天]$/.test(v.trim()));
    if(hasFigures&&(weekday||!cell||/^\d+[月./-]/.test(cell))){
     unreadableDates.add(i);errors.push('第 '+(i+1)+' 行读到了明细数字，但日期缺失或无效，请对照原图补上业务日期。');
    }
   }
 }
 for(const i of monthly)check(i,all);
 return result;
}

export type PriorityCell={row:number;column:number;rank:number;reason:string;suggested?:string};
export function reviewPriorities(rows:string[][],header:number,uncertain:string[],checks:ReturnType<typeof screenshotChecks>,templateOnly=false,knownLabels:string[]=[]){
 const cells:PriorityCell[]=[],weak=new Set(uncertain);
 const labels=rows[header]||[],axis=checks.dateColumn;
 const cleaned=labels.map(v=>v.replace(/[（(](?:元|人|次|张|个|条)[）)]/g,'').replace(/\s/g,''));
 const dictionary=[...new Set(knownLabels)];
 const established=dictionary.filter(label=>cleaned.includes(label)).length>=2;
 for(let row=header;row<rows.length;row++){
  for(let column=0;column<rows[row].length;column++){
   const value=rows[row][column].trim(),key=row+':'+column,label=labels[column]||'';
   const low=weak.has(key),difference=checks.differences.has(key);
   let rank=0,reason='';
   if(column===axis&&checks.unreadableDates.has(row)){
    rank=6;reason='这行已有明细，但业务日期没有读清。请对照原图确认日期。';
   }else if(row>header&&(value==='待核对'||value==='日期待核对'||(axis===column&&/^\d{5,7}$/.test(value)))){
    rank=6;reason='原图有字迹，识别结果需要修正';
   }else if(row===header){
    const value=cleaned[column];
    if(established&&value.length>=4&&!dictionary.includes(value)){
     const close=dictionary.filter(label=>label.length===value.length&&!cleaned.includes(label)&&[...label].filter((ch,i)=>ch!==value[i]).length===1);
     if(close.length===1){cells.push({row,column,rank:7,reason:'原图列名可能是「'+close[0]+'」。请核对，这会影响整列数据。',suggested:close[0]});continue;}
    }
    const numericDates=rows.slice(header+1).some(r=>axis>=0&&/\d/.test(r[axis]||'')&&/^\d+(?:\.\d+)?$/.test((r[column]||'').trim()));
    if(established&&numericDates&&!dictionary.includes(value)&&!/(?:日期|星期|^周$|编号|序号|代码|电话|率|ROI|成本|均价|单价)/i.test(value)){
     rank=6;reason='这列有业务数字，但列名尚未匹配到已知指标。请对照原图核对列名，并在预览中确认用途。';
    }else if(low&&(!value||/^[a-z]{1,3}$/i.test(value)&&!/^(roi|gmv|uv|pv|ctr|cpc|cpa)$/i.test(value))){rank=4;reason='列名可能影响整列匹配';}
   }else if(!templateOnly){
    const summary=rows[row].slice(0,2).some(v=>/^(?:月度|合计|总计|小计|第[一二三四五六七八九十\d]+周(?:合计)?)$/.test(v.trim()));
    if(summary||/^(周|星期|序号)$/.test(label))continue;
    const precisionHint=checks.precisionHints.get(key);
    if(precisionHint){rank=6;reason=precisionHint;}
    else if(difference&&(low||!value)){rank=5;reason=value?'数字字迹存疑，且该列合计有差额':'该列合计有差额，这格留空';}
    else if(low&&value&&column!==axis&&/[\d]/.test(value)&&!/(编号|编码|日期|名称|门店名|电话)/.test(label)){
     rank=/金额|花费|消耗|业绩|收入|成本|销售额/.test(label)?3:2;reason='这格数字的识别把握较低';
    }else if(checks.suspects.some(p=>p.row===row&&p.column===column)){rank=4;reason='数字格式需要核对';}
   }
   if(rank)cells.push({row,column,rank,reason});
  }
 }
 // A difference alone cannot identify a bad daily value. Show the printed total itself.
 if(!templateOnly)for(const [index,total] of checks.totals.entries()){
  if(cells.some(cell=>cell.row===total.row&&cell.column===total.column))continue;
  cells.push({...total,rank:4.5,reason:checks.warnings[index]+' 请先核对原图合计。'});
 }
 return cells.sort((a,b)=>b.rank-a.rank||a.row-b.row||a.column-b.column);
}
