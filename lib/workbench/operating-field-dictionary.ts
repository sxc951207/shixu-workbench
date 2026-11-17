import type {OperatingField} from '../../cloud/company/operating-model.ts';
export function isIdentifierColumn(label:string){
 const name=label.trim();
 return /手机号|手机号码|电话|条形码|条码|身份证|证件号|流水号|单号|货号|编码|代码|编号|邮编|SKU|邮箱/i.test(name)||
  /(?:[\u3400-\u9fff]|[_\s-]|^)id(?:[（(].*[)）])?$/i.test(name)||/[a-z](?:ID|Id)$/.test(name);
}
const descriptions:Record<string,string>={
 leads:'当日新增线索条数；去重范围以本项目约定为准，不跨项目自动合并。',
 validLeads:'当日核实有效的线索数；有效标准应在本项目填写提示中说明。',
 appointments:'当日达成的预约数，按预约发生日记录。',arrivals:'当日实际到店或到访数，按实际发生日记录。',deals:'当日实际成交数，需与成交金额使用同一成交口径。',
 revenue:'可归属本项目客资、当日实际成交的金额，单位元；人工归属，由主管核实来源。',
 spend:'当日实际投放或获客花费，单位元；金额ROI不代表利润。',
 impressions:'平台当日曝光次数，不等于去重人数。',clicks:'平台当日点击次数，不等于去重人数。',orders:'当日实际订单数；是否剔除退款以本项目约定为准。',
 orderAmount:'当日订单或成交金额，单位元；按本项目所选平台及业务定义记录。',refundAmount:'当日实际发生的退款金额，单位元，不反推退款对应的历史成交日期。',
};
export function operatingFieldDefinition(field:Pick<OperatingField,'key'|'label'|'kind'>):string{
 if(field.key==='revenue'&&field.label==='门店总业绩')return'当日门店全来源总业绩，单位元，已包含美团、抖音等收入；不可再与平台金额相加。';
 return descriptions[field.key]||`${field.label}：${field.kind==='money'?'金额统一以元记录':field.kind==='stars'?'0至5星，保留一位小数，不相加或平均；原生美团门店累计展示截止日星级':'非负整数，按本项目同一口径记录'}。`;
}
export function assertOperatingYuanUnit(label:string){if(/万元|千元|百元|亿元|美元|美金|欧元|港币|日元|\bUSD\b|\bEUR\b|金额[（(]分[）)]/i.test(label))throw Error('当前金额单位统一为元，请先把“'+label+'”换算为元并修改表头，系统不会猜测单位');}
