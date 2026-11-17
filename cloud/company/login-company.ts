import type {CompanyTx} from './store.ts';
import type {Company} from './model.ts';

type Registry={ids:string[];names?:Record<string,string>};

export async function registerCompany(tx:CompanyTx,registry:Registry,c:Pick<Company,'id'|'name'>){
 await tx.put('registry',{...registry,ids:[...registry.ids,c.id],names:{...registry.names,[c.id]:c.name}});
}

export async function resolveLoginCompany(tx:CompanyTx,identifier:string){
 if(/^co_[a-f0-9]{12}$/.test(identifier))return identifier;
 const registry=await tx.get<Registry>('registry');
 if(!registry)return null;
 const names={...registry.names};
 let changed=false;
 for(const id of registry.ids){
  if(names[id]!==undefined)continue;
  const company=await tx.get<Company>('company_'+id);
  if(company){names[id]=company.name;changed=true;}
 }
 if(changed)await tx.put('registry',{...registry,names});
 const matches=registry.ids.filter(id=>names[id]===identifier);
 return matches.length===1?matches[0]:null;
}
