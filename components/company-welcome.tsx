'use client';
import '../app/company-welcome.css';
import React,{useState} from 'react';
import {ArrowRight,BookOpen,X} from 'lucide-react';

const starts={
 employee:{title:'填好第一份经营数据',tab:'operating',button:'打开数据报表',steps:['打开「数据报表」，选择分配给你的项目、业务日期和模板。数据通常次日出，日期按原表填写。','日数据选「日录入」。手里是平台的门店累计表，就选「门店累计」、对应平台，再展开「已有平台累计表」并点「填写累计明细」。','可以直接填写，也可以在「导入表格 / 识别截图」里选文件或粘贴截图。对照原表核对日期、门店和金额，读取到填报预览。','保存草稿后点「提交确认」。如果主管退回，按退回意见修改并再次提交。']},
 supervisor:{title:'核实第一份提交',tab:'review',button:'打开待我确认',steps:['打开「待我确认」，选择项目，找到待审的指标方案或填报记录。','点开记录，核对业务日期、原始来源和金额。更正记录还要看旧值、新值和更正原因。','核实后点确认。如果需要补资料，选择退回，写清要改哪一项。项目确认主管也可以核实自己提交的经营报表。']},
 leader:{title:'查到开会要用的数字',tab:'summary',button:'打开领导视图',steps:['打开「领导视图」，先看当前公司各项目昨天已确认的数字。','在「各项目经营数据」点「上周」或「上月」切换期间。展开项目，按日期查门店明细。','需要看上次会议的数据时，用「会议查阅」选项目和期间。比较涨跌前，核对统计范围、确认时间和缺报提示。']},
 owner:{title:'让第一位同事开始填报',tab:'members',button:'打开成员与项目',steps:['在「成员与项目」点「添加成员」，保存姓名、账号和角色，再用「邀请 / 重设登录」取得邀请链接。','在项目看板新建或打开项目，指定负责人、参与员工和确认主管。领导按公司授权。','员工在「填报指标」选择已有字段或从原表生成方案。主管确认后，员工就能到「数据报表」填第一份记录。']}
};
export function firstSteps(roles:string[]){
 const assigned=(['owner','supervisor','employee','leader'] as const).filter(role=>roles.includes(role)||(role==='owner'&&roles.includes('admin')));
 return (assigned.length?assigned:['employee' as const]).map(role=>starts[role]);
}
export function CompanyWelcome({scope,roles,onGuide,disabled=false}:{scope:string;roles?:string[];onGuide:()=>void;disabled?:boolean}){
 const key='shixu-welcome-v2:'+scope;
 const [dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem(key)==='1';}catch{return false;}});
 if(dismissed)return null;
 function dismiss(){setDismissed(true);try{localStorage.setItem(key,'1');}catch{}}
 return <aside className="sx-welcome" aria-label="新人入门"><BookOpen size={22} aria-hidden="true"/><div><strong>欢迎使用拾序</strong><p>个人待办放在自己的工作总览。公司的项目数据由员工填报、主管核实，领导查看已确认的结果。</p><button type="button" disabled={disabled} onClick={()=>{dismiss();onGuide();}}>{roles?firstSteps(roles)[0].title:'查看我的操作步骤'} <ArrowRight size={15}/></button></div><button type="button" className="sx-welcome-close" aria-label="关闭首次使用提示" onClick={dismiss}><X size={17}/></button></aside>;
}
