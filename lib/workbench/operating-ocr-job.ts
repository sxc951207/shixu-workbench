import type {OcrWord} from './operating-ocr.ts';
type Transport=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'>;
type Options={multilineCells?:boolean;chineseCells?:boolean;digitsOnly?:boolean;remainingCells?:Uint8Array[];workerFactory:()=>Transport;assetBase:string;timeoutMs?:number;sparseCells?:boolean;singleLine?:boolean;onProgress?:(status:string,progress:number)=>void};
/** Pinned Tesseract.js 7 worker protocol. Owning the worker permits cancellation even during core/model initialization. */
export function startOcrJob(image:Uint8Array,{workerFactory,assetBase,remainingCells,multilineCells=false,chineseCells=false,digitsOnly=false,timeoutMs=120000,sparseCells=false,singleLine=false,onProgress}:Options){
 let worker:Transport|null=null,done=false,sequence=0,pending:{id:string;resolve:(data:any)=>void;reject:(error:Error)=>void}|null=null;
 let resolveFinal!:(result:{words:OcrWord[];text:string;cellTexts?:string[]})=>void,rejectFinal!:(error:Error)=>void;
 const promise=new Promise<{words:OcrWord[];text:string;cellTexts?:string[]}>((resolve,reject)=>{resolveFinal=resolve;rejectFinal=reject;});
 const cleanup=()=>{clearTimeout(timer);if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}};
 function fail(error:Error){if(done)return;done=true;const old=pending;pending=null;cleanup();old?.reject(error);rejectFinal(error);}
 const timer=setTimeout(()=>fail(Error('识别超时，请裁剪更小区域后重试')),Math.min(180000,Math.max(1,timeoutMs)));
 const request=(action:string,payload:any)=>new Promise<any>((resolve,reject)=>{if(done||!worker){reject(Error('识别已取消'));return;}const id=String(++sequence);pending={id,resolve,reject};worker.postMessage({workerId:'shixu-ocr',jobId:id,action,payload});});
 try{
  worker=workerFactory();worker.onerror=()=>fail(Error('识别资源加载失败，请检查网络后重试'));
  worker.onmessage=({data:packet})=>{
   if(done||!pending||packet?.jobId!==pending.id)return;
   if(packet.status==='progress'){try{onProgress?.(String(packet.data?.status||''),Math.max(0,Math.min(1,Number(packet.data?.progress)||0)));}catch{}return;}
   if(packet.status==='reject'){fail(Error('截图识别失败，请换清晰图片或重试'));return;}
   if(packet.status==='resolve'){const next=pending;pending=null;next.resolve(packet.data);}
  };
  void(async()=>{
   await request('load',{options:{lstmOnly:true,corePath:assetBase+'/core',logging:false}});
   await request('loadLanguage',{langs:remainingCells?[chineseCells?'chi_sim':'eng']:['eng','chi_sim'],options:{langPath:assetBase+'/lang',cacheMethod:'none',gzip:true,lstmOnly:true}});
   await request('initialize',{langs:remainingCells?(chineseCells?'chi_sim':'eng'):'eng+chi_sim',oem:1,config:{}});
   await request('setParameters',{params:{tessedit_pageseg_mode:multilineCells?'6':remainingCells||singleLine?'7':sparseCells?'11':'3',preserve_interword_spaces:'1',...(digitsOnly?{tessedit_char_whitelist:'0123456789.'}:{})}});
   if(remainingCells){
    const cellTexts:string[]=[];
    for(const cell of [image,...remainingCells]){const value=await request('recognize',{image:cell,options:{},output:{text:true}});cellTexts.push(String(value.text||'').trim());}
    done=true;cleanup();resolveFinal({words:[],text:'',cellTexts});return;
   }
   const data=await request('recognize',{image,options:{},output:{text:true,blocks:true}});
   if(done)return;
   const words:OcrWord[]=[];for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[])if(String(word.text||'').trim())words.push({text:word.text,confidence:word.confidence,bbox:word.bbox});
   if(!words.length)throw Error('没有识别到文字，请裁剪清晰表格后重试');
   done=true;cleanup();resolveFinal({words,text:String(data.text||'')});
  })().catch(e=>fail(e instanceof Error?e:Error('截图识别失败')));
 }catch(e){fail(e instanceof Error?e:Error('识别资源加载失败'));}
 return{promise,cancel:()=>fail(Error('识别已取消'))};
}
