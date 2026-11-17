export type OcrReviewState={rows:string[][];header:number;uncertain:string[];checked:boolean};
const copy=(state:OcrReviewState)=>({...state,rows:state.rows.map(row=>[...row]),uncertain:[...state.uncertain],checked:false});
export function assertOcrSingleCell(value:string){if(/[\r\n\t]/.test(value))throw Error('单格不能含回车、换行或Tab分隔符，请只填写这一格的内容');if(value.length>200)throw Error('每格最多200字');return value;}
export function replaceOcrCell(state:OcrReviewState,row:number,column:number,value:string){
 if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||column<0||row>=state.rows.length||column>=state.rows[row].length)throw Error('单元格位置无效，请重新选择');
 assertOcrSingleCell(value);const next=copy(state);next.rows[row][column]=value;return next;
}
const numericOrDate=(text:string)=>/^[¥￥]?\s*[+-]?\d[\d,.]*\s*(?:元|万元|千元|分|人|单|张|次|个|%)?$/.test(text.trim())||/^\d{1,4}[-/.年]\d{1,2}[-/.月]\d{1,4}日?$/.test(text.trim())||/^\d{1,2}月\d{1,2}日$/.test(text.trim());
function markers(items:string[],convert:(row:number,column:number)=>[number,number]|null){return[...new Set(items.map(item=>{const match=/^(\d+):(\d+)$/.exec(item);if(!match)throw Error('候选风险标记无效');const next=convert(Number(match[1]),Number(match[2]));return next?next.join(':'):null;}).filter((key):key is string=>key!==null))];}
export function removeOcrRow(state:OcrReviewState,index:number){
 if(!Number.isInteger(index)||index<0||index>=state.rows.length||state.rows.length<=1)throw Error('至少保留一行');const next=copy(state);next.rows.splice(index,1);next.header=Math.min(next.rows.length-1,Math.max(0,state.header-(index<state.header?1:0)));next.uncertain=markers(state.uncertain,(r,c)=>r===index?null:[r-(r>index?1:0),c]);return next;
}
export function removeOcrColumn(state:OcrReviewState,index:number){
 if(!Number.isInteger(index)||index<0||index>=(state.rows[0]?.length||0)||(state.rows[0]?.length||0)<=1)throw Error('至少保留一列');const next=copy(state);next.rows=next.rows.map(row=>row.filter((_,c)=>c!==index));next.uncertain=markers(state.uncertain,(r,c)=>c===index?null:[r,c-(c>index?1:0)]);return next;
}
export function mergeOcrHeaders(state:OcrReviewState){
 const h=state.header;if(!Number.isInteger(h)||h<0||h+1>=state.rows.length)throw Error('表头后没有可合并的下一行');
 if(state.rows[h+1].some(numericOrDate))throw Error('下一行含数字或日期，可能是数据行，不能合并进表头');
 const next=copy(state);next.rows[h]=next.rows[h].map((a,c)=>{const b=next.rows[h+1][c]||'';let value=!a?b:!b||a===b?a:/^(元|万元|千元|分|人|张|单|次|个|倍|%)$/.test(b.trim())?a+'（'+b.trim()+'）':a+b;if(value.length>200)throw Error('合并后表头超过200字，请手动精简');return value;});next.rows.splice(h+1,1);
 next.uncertain=markers(state.uncertain,(r,c)=>[r===h+1?h:r-(r>h+1?1:0),c]);return next;
}
export function suggestOcrHeader(rows:string[][]){
 let best=0,score=-1;rows.forEach((row,index)=>{const text=[...new Set(row.map(v=>v.trim()).filter(v=>v&&!numericOrDate(v)&&!/^[(（]?(元|万元|千元|分|人|张|单|次|个|倍|%)[)）]?$/.test(v)))];if(text.length<2)return;const value=text.length+text.filter(v=>/^(日期|业务日期|门店|门店名称|范围|渠道|账号)$/.test(v)).length*2+text.filter(v=>/金额|线索|核销|订单|业绩|消耗|花费|成交/.test(v)).length*2;if(value>score){best=index;score=value;}});return best;
}
