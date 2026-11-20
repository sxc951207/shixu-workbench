type DirectoryName={login:string;name:string};
export type ApprovalDisplay={
 approvalPreview?:string[];
 approvalFlow?:{steps:string[];names?:string[];index:number};
};

export function approvalPreview(members:readonly DirectoryName[],steps:readonly string[]):string[]{
 return steps.filter(Boolean).map(login=>{
  if(login==='owner')return '管理员';
  const person=members.find(member=>member.login===login);
  if(!person)return login;
  const sameName=members.some(member=>member.login!==login&&member.name===person.name);
  return sameName?person.name+'（'+login+'）':person.name;
 });
}

function stepNames(flow:NonNullable<ApprovalDisplay['approvalFlow']>){
 return flow.steps.map((login,index)=>flow.names?.[index]||(login==='owner'?'管理员':login));
}

export function approvalNext(record:ApprovalDisplay){
 const flow=record.approvalFlow;
 return flow?stepNames(flow)[flow.index+1]||'':'';
}

export function approvalDescription(record:ApprovalDisplay,status:string){
 const pending=status==='submitted',flow=pending?record.approvalFlow:undefined;
 const names=flow?stepNames(flow):record.approvalPreview;
 if(!names?.length||!['draft','returned','submitted'].includes(status))return '';
 if(!pending)return names.length===1?'提交后由'+names[0]+'确认（1 人）':'提交后由 '+names.length+' 人依次确认：'+names.join(' → ');
 const index=flow?.index??0;
 if(index<0||index>=names.length)return '';
 const route=names.length>1?'确认顺序（'+names.length+' 人）：'+names.join(' → ')+' · ':'';
 return route+'当前第 '+(index+1)+'/'+names.length+' 步，等待'+names[index]+'确认';
}
