import type {OperatingField,OperatingSheet,OperatingTemplate} from '../../cloud/company/operating-model.ts';

const platformOrder=['orderedCoupons','orderAmount','verifiedCoupons','verifiedAmount','refundOrders','refundAmount','positiveReviews','negativeReviews','adSpend','stars'];
const platformAnchors:Record<string,string>={verificationRate:'verifiedAmount',refundRate:'refundAmount',positiveRate:'positiveReviews',verifiedRoi:'adSpend',orderRoi:'adSpend'};

export function operatingTableColumns<M extends {key:string}>(sheet:OperatingSheet,fields:OperatingField[],metrics:M[],template?:OperatingTemplate){
 const storePlatform=sheet==='meituan-stores'||sheet==='douyin-stores';
 const ordered=storePlatform?[...fields].sort((a,b)=>platformOrder.indexOf(a.key)-platformOrder.indexOf(b.key)):fields;
 const columns:({field:OperatingField;metric?:never}|{field?:never;metric:M})[]=[];
 const after=new Map<string,M[]>(),unplaced:M[]=[];
 for(const metric of metrics){
  const definition=template?.metrics.find(m=>m.key===metric.key);
  const anchor=definition?ordered.filter(f=>f.key===definition.numerator||f.key===definition.denominator).at(-1)?.key:storePlatform?platformAnchors[metric.key]:undefined;
  if(anchor&&ordered.some(f=>f.key===anchor)){const group=after.get(anchor)||[];group.push(metric);after.set(anchor,group);}else unplaced.push(metric);
 }
 for(const field of ordered){columns.push({field});for(const metric of after.get(field.key)||[])columns.push({metric});}
 for(const metric of unplaced)columns.push({metric});
 return columns;
}
