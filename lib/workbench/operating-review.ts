import type {OperatingRecord} from '../../cloud/company/operating-model.ts';
import {operatingFields} from './operating-data.ts';
export function operatingReviewChanges(record:OperatingRecord){
 if(!record.published)return[];
 const fields=operatingFields(record.sheet,record.template),changes:{storeName:string;label:string;kind:'money'|'count'|'stars';before:number|null;after:number|null}[]=[];
 for(const row of record.rows){const previous=record.published.rows.find(r=>r.storeId===row.storeId);for(const field of fields){const before=previous?.values[field.key]??null,after=row.values[field.key]??null;if(before!==after)changes.push({storeName:row.storeName,label:field.label,kind:field.kind,before,after});}}
 for(const previous of record.published.rows)if(!record.rows.some(r=>r.storeId===previous.storeId))for(const field of fields){const before=previous.values[field.key]??null;if(before!==null)changes.push({storeName:previous.storeName,label:field.label,kind:field.kind,before,after:null});}
 if((record.sharedAdSpend??null)!==(record.published.sharedAdSpend??null))changes.push({storeName:'全平台',label:'累计消耗',kind:'money',before:record.published.sharedAdSpend??null,after:record.sharedAdSpend??null});
 return changes;
}
