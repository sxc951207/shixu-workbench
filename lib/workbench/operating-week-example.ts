import type {OperatingRecord,OperatingSnapshot} from '../../cloud/company/operating-model.ts';
import {buildOperatingComparison,operatingComparisonPeriods,type PreparedOperatingComparison} from './operating-comparison.ts';

const scope={companyId:'co_000000000000',projectId:'p_'+'0'.repeat(24),projectName:'示例连锁门店'};
const dailyYuan=[4000,4500,4000,3500,4500,5000,4500,3000,2500,2500,2000,3000,4000,3000];

export function weeklyComparisonExample(missing:boolean):PreparedOperatingComparison{
 const records:OperatingRecord[]=dailyYuan.map((yuan,i)=>{
  const day=String(i+2).padStart(2,'0'),date='2026-11-'+day;
  const snapshot:OperatingSnapshot={...scope,id:'op_'+day.padStart(32,'0'),date,sheet:'revenue',status:'approved',
   version:3,publishedVersion:3,writerLogin:'staff',reviewerLogin:'manager',submittedBy:'staff',submittedName:'示例填报人',
   reviewerName:'示例主管',comment:'',createdAt:date+'T08:00:00Z',submittedAt:date+'T09:00:00Z',updatedAt:date+'T10:00:00Z',
   rows:[{storeId:'s001',storeName:'示例门店 A',values:{revenue:yuan*100}}]};
  return {...snapshot,published:snapshot};
 });
 const periods=operatingComparisonPeriods('2026-11-15','week');
 const eligible=missing?records.filter(r=>r.date!=='2026-11-14'):records;
 return {...buildOperatingComparison(eligible,periods,scope),revision:1,preparedAt:'2026-11-15T10:00:00Z',pendingChanges:0};
}
