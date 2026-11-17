import type {OperatingStore} from '../../cloud/company/operating-model.ts';

export class StoreMappingNeeded extends Error {
 sourceName:string;
 choices:OperatingStore[];
 constructor(sourceName:string,choices:OperatingStore[],ambiguous:boolean){
  super((ambiguous?'多个项目门店可能对应':'未知门店')+'：“'+sourceName+'”。请选择项目里对应的门店。');
  this.sourceName=sourceName;this.choices=choices;
 }
}
const normalized=(s:string)=>s.trim().replace(/\s*[（(]\s*/g,'（').replace(/\s*[)）]\s*/g,'）');
function branch(name:string){
 return /^[^（）]+（([^（）]+(?:店|分院|院区))）$/.exec(name)?.[1];
}
export function matchImportStore(token:string,stores:OperatingStore[],aliases?:ReadonlyMap<string,string>){
 const exact=stores.find(s=>s.name.trim()===token||s.id===token);
 if(exact)return exact;
 if(!token)throw Error('门店名称为空，请核对源表。');
 if(stores.length===1&&stores[0].id==='all')throw Error('未知门店：“'+token+'”。当前为总数填报；含门店的表请在对应门店填报模式打开。');
 const selected=aliases?.get(token);
 if(selected){const store=stores.find(s=>s.id===selected);if(store)return store;}
 const name=normalized(token),short=branch(name);
 const matches=stores.filter(s=>{
  const target=normalized(s.name);
  return name===target||(short?short===target:branch(target)===name);
 });
 if(matches.length===1)return matches[0];
 throw new StoreMappingNeeded(token,stores,matches.length>1);
}
