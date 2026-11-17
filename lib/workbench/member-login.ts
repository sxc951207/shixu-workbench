export const memberLoginPattern=/^(?:[a-z0-9][a-z0-9._-]{2,39}|(?=[\s\S]*\p{Script=Han})[\p{Script=Han}a-z0-9][\p{Script=Han}a-z0-9._-]{1,39})$/u;

export function suggestedMemberLogin(name:string,logins:readonly string[]){
 const base=name.trim().toLowerCase();
 if(base==='owner'||base.length>40||!memberLoginPattern.test(base))return '';
 const used=new Set(logins);
 if(!used.has(base))return base;
 for(let i=1;i<=used.size+1;i++){
  const suffix=String(i).padStart(2,'0'),candidate=base.slice(0,40-suffix.length)+suffix;
  if(memberLoginPattern.test(candidate)&&!used.has(candidate))return candidate;
 }
 return '';
}
