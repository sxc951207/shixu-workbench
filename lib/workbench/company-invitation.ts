export function readCompanyInvitation(value:string){
 const p=new URLSearchParams(value.replace(/^#/,''));
 const token=p.get('join')||'',companyId=p.get('company')||'',login=p.get('login')||'';
 if(!/^[\w-]{43}$/.test(token)||!/^co_[a-f0-9]{12}$/.test(companyId)||!login||login.length>40)return null;
 return {token,companyId,login};
}

type Invite=NonNullable<ReturnType<typeof readCompanyInvitation>>;
export function companyInviteCode(invite:Invite){
 return ['拾序邀请',invite.companyId,invite.login,invite.token].join('|');
}
export function invitationFromLink(value:string,origin:string){
 const parts=value.trim().split('|');
 if(parts[0]==='拾序邀请'&&parts.length===4){
  const [,company,login,join]=parts;
  return readCompanyInvitation(new URLSearchParams({company,login,join}).toString());
 }
 let url:URL;
 try{url=new URL(value.trim());}catch{return null;}
 if(url.origin!==origin||url.pathname.replace(/\/$/,'')!=='/workbench')return null;
 return readCompanyInvitation(url.hash);
}
