import React from 'react';
import type {OcrBounds} from '../lib/workbench/operating-ocr';

export function OriginalCell({url,bounds,row,column}:{url:string;bounds?:OcrBounds;row:number;column:number}){
 const index=row-(bounds?.prefix??0);
 const x=bounds?.x[column],right=bounds?.x[column+1],y=bounds?.y[index],bottom=bounds?.y[index+1];
 if(!bounds||x===undefined||right===undefined||y===undefined||bottom===undefined||right<=x||bottom<=y)
  return <details className="op-source-local"><summary>就地查看完整原图</summary><div><img src={url} alt="完整原图，可滚动查看"/></div></details>;
 const width=right-x,height=bottom-y;
 return <figure className="op-source-cell"><figcaption>原图 · 第{row+1}行第{column+1}列</figcaption>
  <svg role="img" aria-label="当前格的原图局部" viewBox={[0,0,width,height].join(" ")}>
   <svg width={width} height={height} overflow="hidden"><image href={url} x={-x} y={-y} width={bounds.width} height={bounds.height} preserveAspectRatio="none"/></svg>
  </svg></figure>;
}

export function nextUncertain(positions:string[],row:number,column:number){
 const cells=positions.map(key=>key.split(':').map(Number)).filter(([r,c])=>r!==row||c!==column).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 return cells.find(([r,c])=>r>row||(r===row&&c>column))??cells[0];
}
