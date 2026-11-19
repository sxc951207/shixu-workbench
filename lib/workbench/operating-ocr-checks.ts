import {operatingImportDate} from './operating-import-layout.ts';

/** Unknown field names are valid. Look for missing structure or several weak,
 * fragmentary readings rather than requiring any particular project vocabulary. */
export function screenshotLayoutProblem(rows:string[][],header:number,structured:boolean,uncertain:string[]){
 if(!structured)return '未找到清晰网格，无法确定文字分别属于哪一列。请截取一张完整表格，保留表头和左右边界，或导入原 Excel。';
 const labels=rows[header]||[],weak=new Set(uncertain);
 const filled=labels.map((v,c)=>({text:v.trim(),column:c})).filter(v=>v.text);
 const sparse=filled.length<2||(labels.length>=6&&filled.length*3<labels.length);
 const fragments=filled.filter(({text,column})=>weak.has(header+':'+column)&&! /^(?:ROI|GMV|UV|PV|SKU|CTR|CPC|CPA|CVR)$/i.test(text)&&(/^[a-z]{1,3}$/i.test(text)||/[^\p{L}\p{N}\s()%（）/_.-]{2,}/u.test(text)));
 if(sparse||(fragments.length>=2&&fragments.length*2>filled.length)){
  const detail=sparse?'共 '+labels.length+' 列，只读到 '+filled.length+' 个非空列名':'有 '+fragments.length+' 个列名只读到零散字符';
  return '候选第 '+(header+1)+' 行的表头无法可靠辨认（'+detail+'）。请选择实际表头行，或放大表头后重新截图。';
 }
 return '';
}

// Compare only additive metrics over the visible daily rows. Never allocate a difference.
export function screenshotChecks(rows:string[][],header:number,reference?:string,uncertain:string[]=[]){
 const labels=rows[header]||[],axis=labels.findIndex(v=>/^(?:(?:业务|统计|数据|发生|成交|填报)?日期|date)$/i.test(v.replace(/\s/g,'')));
 const warnings:string[]=[],errors:string[]=[];
 type Position={row:number;column:number};
 const totals:Position[]=[],suspects:Position[]=[];
 const differences=new Set<string>();
 const result={differences,warnings,errors,totals,suspects,dateColumn:axis},weak=new Set(uncertain);
 if(axis<0)return result;
 const numeric=/金额|券数|订单数|推广花费|点击数|消耗|成本|收入|销售额|业绩|曝光数|咨询数/;
 const numericText=/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/;
 const group:number[]=[];
 const value=(s:string)=>/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s?.trim())?Math.round(Number(s.replace(/,/g,''))*100):null;
 const all:number[]=[],week:number[]=[],monthly:number[]=[];
 const check=(index:number,indices:number[])=>{
  if(!indices.length)return;
  for(let c=0;c<labels.length;c++){
   if(!/金额|下单券数|核销券数|推广花费|退款订单数|成交券数/.test(labels[c])||/率|平均|占比|目标|累计|余额|ROI/.test(labels[c]))continue;
   const expected=value(rows[index][c]);if(expected===null)continue;
   const values=indices.map(i=>value(rows[i][c]));
   const total=values.reduce<number>((n,v)=>n+(v??0),0);
   if(total===expected&&values.every(v=>v!==null))continue;
   const missing=indices.filter((_,j)=>values[j]===null).map(i=>rows[i][axis]);
   for(const i of indices)differences.add(i+':'+c);
   totals.push({row:index,column:c});
   warnings.push(rows[index][axis]+'「'+labels[c]+'」：'+(missing.length?'缺 '+missing.join('、')+'；':'')+'已读明细 '+total/100+'，原表合计 '+expected/100+'，相差 '+Math.abs(expected-total)/100+'。');
  }
 };
 for(let i=header+1;i<rows.length;i++){
  const cell=(rows[i][axis]||'').replace(/\s/g,'');
  if(/^第[一二三四五六七八九十\d]+周(?:合计)?$/.test(cell)){check(i,week);week.length=0;continue;}
  if(/^(合计|总计)$/.test(cell)){check(i,group);group.length=0;week.length=0;continue;}
  if(cell==='月度'){monthly.push(i);continue;}
  if(cell==='日期待核对'||/^\d{5,7}$/.test(cell)){errors.push('第 '+(i+1)+' 行日期未读清，请对照原图填写月日。');continue;}
  try{operatingImportDate(cell,reference||'2000-01-01');all.push(i);group.push(i);week.push(i);
   for(let c=0;c<labels.length;c++){
    const text=(rows[i][c]||'').trim();
    if(!numeric.test(labels[c])||/编号|编码|名称|说明|备注/.test(labels[c])||!text||/^(?:—|-|\/|N\/A|不适用)$/i.test(text))continue;
    if(weak.has(i+':'+c)||!numericText.test(text))suspects.push({row:i,column:c});
   }}catch{/* headings and notes are not daily observations */}
 }
 for(const i of monthly)check(i,all);
 return result;
}

export type PriorityCell={row:number;column:number;rank:number;reason:string};
export function reviewPriorities(rows:string[][],header:number,uncertain:string[],checks:ReturnType<typeof screenshotChecks>,templateOnly=false){
 const cells:PriorityCell[]=[],weak=new Set(uncertain);
 const labels=rows[header]||[],axis=checks.dateColumn;
 for(let row=header;row<rows.length;row++){
  for(let column=0;column<rows[row].length;column++){
   const value=rows[row][column].trim(),key=row+':'+column,label=labels[column]||'';
   const low=weak.has(key),difference=checks.differences.has(key);
   let rank=0,reason='';
   if(row>header&&(value==='待核对'||value==='日期待核对'||(axis===column&&/^\d{5,7}$/.test(value)))){
    rank=6;reason='原图有字迹，识别结果需要修正';
   }else if(row===header){
    if(low&&(!value||/^[a-z]{1,3}$/i.test(value)&&!/^(roi|gmv|uv|pv|ctr|cpc|cpa)$/i.test(value))){rank=4;reason='列名可能影响整列匹配';}
   }else if(!templateOnly){
    const summary=rows[row].slice(0,2).some(v=>/^(?:月度|合计|总计|小计|第[一二三四五六七八九十\d]+周(?:合计)?)$/.test(v.trim()));
    if(summary||/^(周|星期|序号)$/.test(label))continue;
    if(difference&&(low||!value)){rank=5;reason=value?'数字字迹存疑，且该列合计有差额':'该列合计有差额，这格留空';}
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
