export type OcrWord={text:string;confidence:number;bbox:{x0:number;y0:number;x1:number;y1:number}};
export type OcrBounds={width:number;height:number;x:number[];y:number[];prefix:number;sourceRows?:number[];sourceColumns?:number[]};
type RuleBand={start:number;end:number;center:number};
export type OcrGrid={width:number;height:number;x:number[];y:number[];recoveredRules?:{x:RuleBand[];y:RuleBand[]}};
const bytesLimit=10*1024*1024,pixelLimit=12_000_000;
export function ocrProcessingSize(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>pixelLimit)throw Error('图片尺寸无效或像素过大');
 const scale=Math.min(2,Math.sqrt(6_000_000/(width*height)));return{width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
export function ocrImageInfo(bytes:Uint8Array,name:string,size:number){
 if(size>bytesLimit)throw Error('图片不能超过10MiB，请裁剪表格区域');
 if(!/\.(png|jpe?g|webp)$/i.test(name)||bytes.length<24)throw Error('请选择PNG、JPG或WebP图片');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
 let width=0,height=0,type='';
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&ascii(12,16)==='IHDR'){width=v.getUint32(16);height=v.getUint32(20);type='image/png';}
 else if(bytes[0]===255&&bytes[1]===216){
  type='image/jpeg';let i=2;while(i+3<bytes.length){if(bytes[i++]!==255)break;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(i+2>bytes.length)break;const length=v.getUint16(i);if(length<2||i+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=v.getUint16(i+3);width=v.getUint16(i+5);break;}i+=length;}
 }else if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'){
  type='image/webp';const kind=ascii(12,16);
  if(kind==='VP8X'&&bytes.length>=30){width=1+bytes[24]+bytes[25]*256+bytes[26]*65536;height=1+bytes[27]+bytes[28]*256+bytes[29]*65536;}
  else if(kind==='VP8L'&&bytes[20]===47&&bytes.length>=25){const bits=v.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  else if(kind==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
 }
 if(!type||!width||!height)throw Error('图片格式或尺寸无法读取，请使用有效PNG、JPG或WebP截图');
 if(width>12000||height>12000||width*height>pixelLimit)throw Error('图片尺寸过大，最多1200万像素，请只截表格区域');
 return{width,height,type};
}
export function detectOcrGrid(image:{width:number;height:number;data:Uint8ClampedArray}):OcrGrid{
 const{width,height,data}=image;if(width*height>6_000_000||data.length!==width*height*4)throw Error('处理图片像素超限');
 const columns=new Uint32Array(width),rows=new Uint32Array(height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(data[i+3]>128&&(r+g+b)/3<170&&Math.max(r,g,b)-Math.min(r,g,b)<75){columns[x]++;rows[y]++;}}
 function scan(counts:Uint32Array,span:number){
  const bands:RuleBand[]=[];
  for(let i=0;i<counts.length;i++){
   if(counts[i]<span*.65)continue;
   const start=i;while(i+1<counts.length&&counts[i+1]>=span*.65)i++;
   bands.push({start,end:i,center:Math.round((start+i)/2)});
  }
  const thin=bands.filter(b=>b.end-b.start<=Math.max(4,counts.length*.004));
  return {bands,thin};
 }
 const vertical=scan(columns,height),horizontal=scan(rows,width);
 // At 2x, adjacent cell strokes can merge into six-pixel separators between thin outer borders.
 // Require full-width recurring rules and ample, even spacing before replacing the two-border result.
 function recurrent(axis:ReturnType<typeof scan>,counts:Uint32Array,span:number,crossings:number){
  const {bands,thin}=axis;
  if(crossings<3||thin.length!==2||bands.length<4||bands.length>101||thin[0]!==bands[0]||thin[1]!==bands.at(-1))return false;
  const spacing=(bands.at(-1)!.center-bands[0].center)/(bands.length-1);
  return bands.every((band,i)=>{
   const thickness=band.end-band.start+1;
   return thickness<=8&&thickness*10<=spacing&&counts[band.center]>=span*.90&&
    (!i||Math.abs(band.center-bands[i-1].center-spacing)<=spacing*.12);
  });
 }
 const recoverX=recurrent(vertical,columns,height,horizontal.thin.length);
 const recoverY=recurrent(horizontal,rows,width,vertical.thin.length);
 const x=recoverX?vertical.bands:vertical.thin,y=recoverY?horizontal.bands:horizontal.thin;
 // A screenshot may end at the final data row without a bottom horizontal rule.
 const ys=y.map(b=>b.center),end=ys.at(-1);
 if(end!==undefined&&ys.length>=4&&x.length>=4){
  const gaps=ys.slice(-4).slice(1).map((v,i)=>v-ys.slice(-4)[i]).sort((a,b)=>a-b);
  const tail=height-1-end,step=gaps[1];
  if(tail>=step*.8&&tail<=step*1.15){
   const extended=x.filter(b=>{let n=0;for(let py=end+2;py<height;py++){
    const i=(py*width+b.center)*4;if(Math.max(data[i],data[i+1],data[i+2])<175)n++;
   }return n>tail*.75;});
   if(extended.length>=Math.max(3,x.length*.65))ys.push(height-1);
  }
 }
 return{width,height,x:x.map(b=>b.center),y:ys,...(recoverX||recoverY?{recoveredRules:{x,y}}:{})};
}
export function cleanOcrGrid(image:{width:number;height:number;data:Uint8ClampedArray},grid:OcrGrid){
 const data=Uint8ClampedArray.from(image.data);if(grid.x.length<3||grid.y.length<2)return data;
 const paint=(x:number,y:number)=>{if(x>=0&&x<image.width&&y>=0&&y<image.height){const i=(y*image.width+x)*4;data[i]=data[i+1]=data[i+2]=data[i+3]=255;}};
 // Narrow outer margins cannot hold another data column. A viewer overlay can
 // otherwise yield a word there and make ocrTable infer a spurious first column.
 if(grid.x.length>=6&&grid.y.length>=6){
  const left=grid.x[0],right=grid.x.at(-1)!,top=grid.y[0],bottom=grid.y.at(-1)!;
  const margin=(right-left)/(grid.x.length-1)*.15;
  if(left<margin)for(let y=top;y<=bottom;y++)data.fill(255,4*y*image.width,4*(y*image.width+left));
  if(image.width-right<margin)for(let y=top;y<=bottom;y++)data.fill(255,4*(y*image.width+right+1),4*(y+1)*image.width);
  // Detect a full-width neutral viewer bar followed by a white gutter. Keep
  // printed titles above grids without this chrome, and retain source coordinates.
  let barEnd=-1;
  for(let y=0;y<top;y++){let neutral=0,white=0;
   for(let x=0;x<image.width;x+=4){const i=(y*image.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
    if(r>=165&&r<=242&&Math.max(r,g,b)-Math.min(r,g,b)<5)neutral++;
    if(Math.min(r,g,b)>247)white++;
   }
   const samples=Math.ceil(image.width/4);
   if(neutral>samples*.87)barEnd=y;
   if(barEnd>=5&&y-barEnd>=6&&white>samples*.98){data.fill(255,0,4*(y+1)*image.width);break;}
  }
 }
 if(grid.recoveredRules){
  for(const rule of grid.recoveredRules.x)for(let x=rule.start;x<=rule.end;x++)for(let y=grid.y[0];y<=grid.y.at(-1)!;y++)paint(x,y);
  for(const rule of grid.recoveredRules.y)for(let y=rule.start;y<=rule.end;y++)for(let x=grid.x[0];x<=grid.x.at(-1)!;x++)paint(x,y);
  return data;
 }
 const radius=Math.max(1,Math.round(Math.max(image.width,image.height)/1600));
 for(const x of grid.x)for(let y=grid.y[0];y<=grid.y.at(-1)!;y++)for(let d=-radius;d<=radius;d++)paint(x+d,y);
 for(const y of grid.y)for(let x=grid.x[0];x<=grid.x.at(-1)!;x++)for(let d=-radius;d<=radius;d++)paint(x,y+d);
 return data;
}
function lineGroups(words:OcrWord[]){
 const lines:OcrWord[][]=[];for(const word of [...words].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0)){
  const cy=(word.bbox.y0+word.bbox.y1)/2,line=lines.find(row=>{const b=row[0].bbox;return Math.abs(cy-(b.y0+b.y1)/2)<Math.max(3,Math.min(b.y1-b.y0,word.bbox.y1-word.bbox.y0)*.6);});
  if(line)line.push(word);else lines.push([word]);
 }return lines;
}
function joinWords(words:OcrWord[]){return[...words].sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text.trim()).join(' ').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fffA-Za-z])/g,'$1').replace(/([A-Za-z])\s+(?=[\u3400-\u9fff])/g,'$1').replace(/([\d.,%/+-])\s+(?=[\d.,%/+-])/g,'$1');}
export function ocrTable(words:OcrWord[],grid:OcrGrid){
 if(!words.length)throw Error('没有识别到文字，请换清晰截图');if(words.length>6000)throw Error('识别内容过多，请分区域截图');
 for(const w of words){const b=w.bbox;if(typeof w.text!=='string'||![b.x0,b.y0,b.x1,b.y1,w.confidence].every(Number.isFinite)||b.x0<0||b.y0<0||b.x1>grid.width||b.y1>grid.height||b.x0>b.x1||b.y0>b.y1)throw Error('识别坐标超出图片范围，请重新识别');}
 const singleRuledLine=grid.y.length===2&&lineGroups(words).length===1&&words.every(word=>{
  const center=(word.bbox.y0+word.bbox.y1)/2;
  return center>=grid.y[0]&&center<=grid.y[1];
 });
 let bounds:OcrBounds|undefined;
 let cells:OcrWord[][][],structured=grid.x.length>=3&&(grid.y.length>=3||singleRuledLine),inferredBorders=false;
 if(structured){
  const body=words.filter(w=>(w.bbox.y0+w.bbox.y1)/2>=grid.y[0]&&(w.bbox.y0+w.bbox.y1)/2<=grid.y.at(-1)!);grid={...grid,x:[...grid.x]};
  if(body.some(w=>(w.bbox.x0+w.bbox.x1)/2<grid.x[0])){grid.x.unshift(0);inferredBorders=true;}
  if(body.some(w=>(w.bbox.x0+w.bbox.x1)/2>grid.x.at(-1)!)){grid.x.push(grid.width);inferredBorders=true;}
  const prefix=words.filter(w=>(w.bbox.y0+w.bbox.y1)/2<grid.y[0]),suffix=words.filter(w=>(w.bbox.y0+w.bbox.y1)/2>grid.y.at(-1)!);
  cells=Array.from({length:grid.y.length-1},()=>Array.from({length:grid.x.length-1},()=>[] as OcrWord[]));
  for(const w of words){const x=(w.bbox.x0+w.bbox.x1)/2,y=(w.bbox.y0+w.bbox.y1)/2;if(y<grid.y[0]||y>grid.y.at(-1)!)continue;const r=grid.y.findIndex((n,i)=>i<grid.y.length-1&&y>=n&&y<=grid.y[i+1]),c=grid.x.findIndex((n,i)=>i<grid.x.length-1&&x>=n&&x<=grid.x[i+1]);if(r<0||c<0)throw Error('有文字在表格边界外，请裁剪完整表格或手动整理');cells[r][c].push(w);}
  const outside=(list:OcrWord[])=>lineGroups(list).map(line=>[line,...Array.from({length:grid.x.length-2},()=>[] as OcrWord[])]);
  const before=outside(prefix);bounds={...grid,prefix:before.length};
  cells=[...before,...cells,...outside(suffix)];
 }else{
  // Without a reliable grid, preserve text by line rather than guess which blank column a number belongs to.
  cells=lineGroups(words).map(line=>[line]);
 }
 const uncertain:string[]=[],rows=cells.map((row,r)=>row.map((cell,c)=>{if(cell.some(w=>w.confidence<80))uncertain.push(r+':'+c);return joinWords(cell);}));
 // Very small digits can look convincing to OCR even when read incorrectly.
 // Compare numeric glyph heights only within their own column.
 if(structured){
  const marked=new Set(uncertain);
  for(let c=0;c<(rows[0]?.length||0);c++){
   const samples:{row:number;height:number}[]=[];
   for(let r=0;r<rows.length;r++){
    if(!/^[+-]?\d[\d,.]*%?$/.test(rows[r][c]||''))continue;
    const words=cells[r][c];if(!words.length)continue;
    const height=Math.max(...words.map(w=>w.bbox.y1-w.bbox.y0));
    if(height>0)samples.push({row:r,height});
   }
   if(samples.length<3)continue;
   const sorted=samples.map(s=>s.height).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
   for(const sample of samples)if(sample.height<=median*.75&&median-sample.height>=3)marked.add(sample.row+':'+c);
  }
  uncertain.splice(0,uncertain.length,...marked);
 }
 if(rows.length>100||rows.some(row=>row.length>40||row.some(cell=>cell.length>200)))throw Error('识别表格过大或单元格超过200字，请裁剪到100行40列以内');
 return{rows,uncertain,lowConfidence:uncertain.length,structured,inferredBorders,bounds};
}
export function reviewedOcrRows(rows:string[][],headerRow:number,checked:boolean,purpose:'data'|'template'='data'){
 if(!checked)throw Error(purpose==='template'?'请对照截图核对表头、单位和分行名称，再勾选确认':'请对照截图核对全部表头、数字和日期，再勾选确认');
 if(!rows.length||rows.length>100||rows.some(row=>row.length<2||row.length>40||row.length!==rows[0].length||row.some(cell=>typeof cell!=='string'||cell.length>200)))throw Error('表格须为100行40列以内的矩形，列数一致且单格不超过200字');
 if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=rows.length)throw Error('请选择有效的表头行');
 if(purpose==='data'&&headerRow===rows.length-1)throw Error('请选择包含数据行的正确表头行');
 return rows.map(row=>[...row]);
}
