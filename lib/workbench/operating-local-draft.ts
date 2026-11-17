/** A device-local safety copy only. Restoring and saving to the cloud stay explicit UI actions. */
export type OperatingDraftIdentity={companyId:string;projectId:string;sheet:string;date:string;login:string};
export type OperatingDraftStorage={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void};
export type OperatingDraftInput={baseVersion:number;schema:string;rows:{id:string;name:string}[];form:Record<string,Record<string,string>>;source:string};
export type OperatingLocalDraft=OperatingDraftInput&{format:'shixu.operating.local-draft.v1';savedAt:number};
export type OperatingDraftWriteResult={ok:boolean;error?:string};
export function operatingDraftRowsMatch(draftRows:readonly {id:string;name:string}[],expected:readonly {id:string;name:string}[]){return draftRows.length===expected.length&&draftRows.every(row=>expected.some(other=>other.id===row.id&&other.name===row.name));}

const format='shixu.operating.local-draft.v1' as const;
const lifetime=7*24*60*60*1000,maxSourceBytes=128*1024,maxDraftBytes=256*1024,maxSchemaBytes=32*1024;
const inputKeys=['baseVersion','schema','rows','form','source'];
const envelopeKeys=[...inputKeys,'format','savedAt'];
const forbidden=new Set(['__proto__','prototype','constructor']);
const encoder=new TextEncoder();

function record(value:unknown):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}
function exactKeys(value:Record<string,unknown>,keys:string[]){const actual=Object.keys(value);return actual.length===keys.length&&actual.every(key=>keys.includes(key));}
function timestamp(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function boundedText(value:unknown,max:number,nonempty=false):value is string{return typeof value==='string'&&value.length<=max&&(!nonempty||value.trim().length>0);}
function identifier(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!forbidden.has(value);}
function bytes(value:string){return encoder.encode(value).byteLength;}
function validInput(value:unknown):value is OperatingDraftInput{
 if(!record(value)||!exactKeys(value,inputKeys)||!timestamp(value.baseVersion)||!boundedText(value.schema,maxSchemaBytes,true)||bytes(value.schema)>maxSchemaBytes)return false;
 if(!boundedText(value.source,maxSourceBytes)||bytes(value.source)>maxSourceBytes||!Array.isArray(value.rows)||value.rows.length<1||value.rows.length>30||!record(value.form))return false;
 const ids=new Set<string>();
 for(const row of value.rows){
  if(!record(row)||!exactKeys(row,['id','name'])||!identifier(row.id)||!boundedText(row.name,128,true)||ids.has(row.id))return false;
  ids.add(row.id);
 }
 const rowKeys=Object.keys(value.form);
 if(rowKeys.length!==ids.size||rowKeys.some(key=>!ids.has(key)))return false;
 const fields=new Set<string>();
 for(const key of rowKeys){
  const row=value.form[key];if(!record(row))return false;
  const keys=Object.keys(row);if(keys.length<1||keys.length>30)return false;
  for(const field of keys){if(!identifier(field)||!boundedText(row[field],64))return false;fields.add(field);}
 }
 return fields.size<=30;
}
function validEnvelope(value:unknown,now:number):value is OperatingLocalDraft{
 if(!record(value)||!exactKeys(value,envelopeKeys)||value.format!==format||!timestamp(value.savedAt)||value.savedAt>now)return false;
 return validInput({baseVersion:value.baseVersion,schema:value.schema,rows:value.rows,form:value.form,source:value.source});
}

/** JSON tuple encoding prevents delimiter collisions. Cloud baseVersion deliberately is not part of the identity. */
export function operatingDraftKey({companyId,projectId,sheet,date,login}:OperatingDraftIdentity):string{
 return 'shixu-operating-draft:v1:'+JSON.stringify([companyId,projectId,sheet,date,login]);
}

/** Never deletes the previous safety copy when validation or browser quota prevents a new write. */
export function writeOperatingDraft(storage:OperatingDraftStorage,key:string,value:OperatingDraftInput,now=Date.now()):OperatingDraftWriteResult{
 try{
  if(!timestamp(now)||!validInput(value))return{ok:false,error:'本机草稿内容不完整或超过大小限制，请先保留填写内容。'};
  const serialized=JSON.stringify({...value,format,savedAt:now});
  if(serialized.length>maxDraftBytes||bytes(serialized)>maxDraftBytes)return{ok:false,error:'本机草稿超过大小限制，请先保留填写内容。'};
  storage.setItem(key,serialized);
  return{ok:true};
 }catch{return{ok:false,error:'本机草稿未能保存，请先保留填写内容。'};}
}

/** No cloud version comparison or replay: the caller must offer explicit restore/discard and check baseVersion/schema. */
export function readOperatingDraft(storage:OperatingDraftStorage,key:string,now=Date.now()):OperatingLocalDraft|null{
 if(!timestamp(now))return null;
 let serialized:string|null;
 try{serialized=storage.getItem(key);}catch{return null;}
 if(serialized===null)return null;
 try{
  if(typeof serialized!=='string'||serialized.length>maxDraftBytes||bytes(serialized)>maxDraftBytes)throw Error('invalid draft size');
  const value:unknown=JSON.parse(serialized);
  if(!validEnvelope(value,now)||now-value.savedAt>=lifetime)throw Error('invalid or expired draft');
  return value;
 }catch{removeOperatingDraft(storage,key);return null;}
}

export function removeOperatingDraft(storage:OperatingDraftStorage,key:string):void{
 try{storage.removeItem(key);}catch{/* Unavailable local storage must not interrupt editing. */}
}
