import type {OperatingSheet,OperatingTemplate} from '../../cloud/company/operating-model.ts';
import {operatingFields} from './operating-data.ts';
import {platformImportField} from './operating-paste.ts';
import {suggestOcrHeader} from './operating-ocr-review.ts';
import {operatingLeafLabels} from './operating-template-inference.ts';

export function projectReportLayout(rows:unknown[][],sheet?:OperatingSheet,template?:OperatingTemplate){
 const first=rows.slice(0,30),fallback=suggestOcrHeader(first.map(row=>row.map(v=>v==null?'':v instanceof Date?v.toISOString().slice(0,10):String(v))));
 if(!sheet)return {header:fallback,matches:0};
 const fields=operatingFields(sheet,template);
 let header=fallback,matches=0;
 for(const row of [fallback,...first.map((_,i)=>i).filter(i=>i!==fallback)]){
  if(!first[row])continue;
  const matched=new Set<string>();
  let labels:string[];try{labels=operatingLeafLabels(first,row);}catch{continue;}
  for(const label of labels){
   try{const field=platformImportField(label,sheet,fields);if(field)matched.add(field.key);}catch{/* Preview will explain a conflicting unit. */}
  }
  if(matched.size>matches){header=row;matches=matched.size;}
 }
 return {header,matches};
}
