import type {OcrBounds,ocrTable} from './operating-ocr.ts';

export type ScreenshotReview={
 rows:string[][];header:number;revenueMatrix:boolean;
 metadata:Omit<ReturnType<typeof ocrTable>,'rows'>&{reviewBounds?:OcrBounds};
};
const prefix='shixu:screenshot-review:v1:';
const week=7*24*60*60*1000;

export async function screenshotReviewKey(scope:string,bytes:ArrayBuffer){
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return prefix+JSON.stringify([scope,Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')]);
}
// Lossless clipboard conversions can change every file byte while leaving each
// displayed pixel intact. Hash full-resolution strips to bound temporary memory.
export async function screenshotPixelKey(scope:string,file:File,isCurrent:()=>boolean){
 const bitmap=await createImageBitmap(file);
 const canvas=document.createElement('canvas');
 try{
  const {width,height}=bitmap;
  if(!width||!height||width>12000||height>12000||width*height>12_000_000)return '';
  const stripHeight=Math.min(height,Math.max(1,Math.floor(262144/width)));
  canvas.width=width;canvas.height=stripHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return '';
  const hashes=new Uint8Array(Math.ceil(height/stripHeight)*32);
  for(let y=0,index=0;y<height;y+=stripHeight,index++){
   if(!isCurrent())return '';
   const h=Math.min(stripHeight,height-y);
   ctx.clearRect(0,0,width,h);
   ctx.drawImage(bitmap,0,y,width,h,0,0,width,h);
   const pixels=ctx.getImageData(0,0,width,h).data;
   hashes.set(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer)),index*32);
  }
  const digest=await crypto.subtle.digest('SHA-256',hashes);
  const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return prefix+JSON.stringify([scope,'rgba-v1',width,height,hex]);
 }finally{bitmap.close();canvas.width=canvas.height=0;}
}

export function readReviewedImage(storage:Storage,pixelsKey:string,bytesKey:string,now=Date.now()){
 if(pixelsKey){
  const saved=readScreenshotReview(storage,pixelsKey,now);
  if(saved)return saved;
 }
 const legacy=readScreenshotReview(storage,bytesKey,now);
 if(legacy&&pixelsKey){
  // Move the original timestamp along with the review. Browsers with full or
  // read-only storage can still use the original entry.
  try{
   const raw=storage.getItem(bytesKey);
   if(raw!==null){storage.setItem(pixelsKey,raw);storage.removeItem(bytesKey);}
  }catch{}
 }
 return legacy;
}
export function readScreenshotReview(storage:Storage,key:string,now=Date.now()):ScreenshotReview|undefined{
 const raw=storage.getItem(key);
 if(!raw)return;
 try{
  const {saved,review}=JSON.parse(raw);
  if(Number.isFinite(saved)&&saved<=now&&saved>now-week&&Number.isInteger(review.header)&&review.header>=0&&
    Array.isArray(review.rows)&&review.rows.length<=100&&review.header<review.rows.length&&
    review.rows.every((r:unknown)=>Array.isArray(r)&&r.length>=2&&r.length<=40&&r.every(c=>typeof c==='string'&&c.length<=200))&&
    Array.isArray(review.metadata?.uncertain)&&typeof review.metadata?.structured==='boolean'&&typeof review.revenueMatrix==='boolean')return review;
 }catch{/* The original screenshot can be read again. */}
 storage.removeItem(key);
}
export function writeScreenshotReview(storage:Storage,key:string,review:ScreenshotReview,now=Date.now()){
 if(storage.getItem(key)===null){
  for(let i=storage.length-1;i>=0;i--){
   const other=storage.key(i);
   if(other?.startsWith(prefix))readScreenshotReview(storage,other,now);
  }
 }
 storage.setItem(key,JSON.stringify({saved:now,review}));
}
