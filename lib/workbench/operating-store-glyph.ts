/** Compare a difficult heading with the project's own store names using the fonts available on this device. */
export function matchPrintedStore(source:CanvasRenderingContext2D,x:number,y:number,width:number,height:number,names:string[]){
 const make=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d',{willReadFrequently:true})!;};
 function shape(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number){
  const p=ctx.getImageData(x,y,w,h).data;
  let left=w,top=h,right=-1,bottom=-1;
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
   if(p[(row*w+col)*4]>=165)continue;
   left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row);
  }
  if(right<left||bottom<top)return;
  const sample=make(64,24);
  sample.drawImage(ctx.canvas,x+left,y+top,right-left+1,bottom-top+1,0,0,64,24);
  const pixels=sample.getImageData(0,0,64,24).data;
  return {ink:Float32Array.from({length:64*24},(_,i)=>1-pixels[4*i]/255),aspect:(right-left+1)/(bottom-top+1)};
 }
 const obs=shape(source,x,y,width,height);
 if(!obs||names.length<2||names.length>30)return '';
 const ranked=names.map(label=>{
  let best=0;
  const ref=make(Math.max(160,label.length*26+8),48);
  for(const font of ['SimSun','Microsoft YaHei','serif'])for(const size of [16,18,19,20,21,22,24])for(const weight of ['normal','bold']){
   ref.fillStyle='white';ref.fillRect(0,0,ref.canvas.width,48);ref.font=weight+' '+size+'px "'+font+'"';ref.fillStyle='black';ref.fillText(label,3,32);
   const glyph=shape(ref,0,0,ref.canvas.width,48);
   if(!glyph||Math.abs(Math.log(glyph.aspect/obs.aspect))>.13)continue;
   let dot=0,aa=0,bb=0;
   for(let i=0;i<obs.ink.length;i++){dot+=obs.ink[i]*glyph.ink[i];aa+=obs.ink[i]**2;bb+=glyph.ink[i]**2;}
   best=Math.max(best,dot/Math.sqrt(aa*bb));
  }
  return {label,best};
 }).sort((a,b)=>b.best-a.best);
 return ranked[0].best>=.84&&ranked[0].best-ranked[1].best>=.10?ranked[0].label:'';
}
