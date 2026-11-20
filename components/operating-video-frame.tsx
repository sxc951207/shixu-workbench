'use client';
import React,{useEffect,useRef,useState} from 'react';

export const reportMediaAccept='image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';
export function isReportVideo(file:File){
 return file.type.startsWith('video/')||/\.(mp4|m4v|mov|webm)$/i.test(file.name);
}

export default function OperatingVideoFrame({url,name,disabled,onFrame,onClear}:{url:string;name:string;disabled:boolean;onFrame:(image:File)=>void;onClear:()=>void}){
 const video=useRef<HTMLVideoElement>(null);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function capture(){
  const media=video.current;
  if(disabled||busy||!media||media.seeking||media.readyState<2)return;
  media.pause();setBusy(true);setError('');
  const canvas=document.createElement('canvas');
  try{
   const width=media.videoWidth,height=media.videoHeight;
   if(!width||!height||width*height>12_000_000)throw Error('这一帧超过可处理尺寸或尚未载入。请直接截取表格区域。');
   canvas.width=width;canvas.height=height;
   const context=canvas.getContext('2d');
   if(!context)throw Error('浏览器无法读取视频画面，请暂停视频后截图。');
   context.drawImage(media,0,0,width,height);
   const stamp=media.currentTime.toFixed(3);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!blob||blob.size>10*1024*1024)throw Error('画面过大或无法截取，请暂停后只截表格区域。');
   if(alive.current)onFrame(new File([blob],name.replace(/\.[^.]+$/,'')+'-'+stamp+'秒.png',{type:'image/png'}));
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'取帧失败，请换一帧重试。');}
  finally{canvas.width=canvas.height=0;if(alive.current)setBusy(false);}
 }
 return <section aria-label="选择录屏画面" className="op-note">
  <strong>从录屏选一帧</strong><p>拖动进度条，停在表头和数据都清楚的一帧。每次读取当前画面。</p>
  <video ref={video} src={url} controls playsInline muted preload="auto" aria-label="本地报表录屏" style={{display:'block',width:'100%',maxHeight:'45vh'}} onLoadedData={()=>setReady(true)} onSeeking={()=>setReady(false)} onSeeked={()=>setReady(true)} onError={()=>{setReady(false);setError('此浏览器无法播放这段录屏。可用系统播放器暂停后截图，或导出为 H.264 MP4 再选。');}}/>
  <div className="op-ocr-actions"><button type="button" className="op-button" disabled={disabled||!ready||busy} onClick={()=>void capture()}>{busy?'正在取帧…':'使用当前画面'}</button><button type="button" className="op-button" onClick={onClear}>移除录屏</button></div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
