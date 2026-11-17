import {digest,text} from './core.ts';
import {WorkbenchError} from '../../lib/workbench/domain.ts';
import type {CompanyTx} from './store.ts';
import type {OperatingField} from './operating-model.ts';

export async function operatingColumnRules(tx:CompanyTx,company:string,project:string,sheet:string,fields:OperatingField[],b:any){
 const signature=text(b.signature,24000,true);
 const key='column_rules_'+digest(JSON.stringify([company,project,sheet,signature]));
 const old=await tx.get<{version:number;rules:[string,string][]}>(key)??{version:0,rules:[]};
 if(b.action==='ops.columnRules.read')return old;
 if(b.version!==old.version)throw new WorkbenchError('其他成员已更新列对应，请重新读取。',409);
 if(!Array.isArray(b.rules)||b.rules.length>60)throw new WorkbenchError('列对应数量无效');
 const keys=new Set(fields.map(f=>f.key)),mapping=new Map<string,string>();
 for(const row of b.rules){
  if(!Array.isArray(row)||row.length!==2)throw new WorkbenchError('列对应格式无效');
  const label=text(row[0],200,true),field=row[1];if(mapping.has(label)||field!==''&&!keys.has(field))throw new WorkbenchError('列对应的项目指标无效');mapping.set(label,field);
 }
 const next={version:old.version+1,rules:[...mapping]};await tx.put(key,next);return next;
}
