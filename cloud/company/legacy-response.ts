function projectResponse(project:any):any{if(!project)return project;const{work,published,...safe}=project;return{...safe,...(Object.hasOwn(project,'published')?{published:published?projectResponse(published):null}:{})};}
// Legacy board/history render progress fields; collaboration data has its own
// authorization and recipient projection in delivery.* and is not sent here.
export function legacyCompanyResponse(value:any){return{...value,...(value.project?{project:projectResponse(value.project)}:{}),...(Array.isArray(value.projects)?{projects:value.projects.map(projectResponse)}:{}),...(Array.isArray(value.versions)?{versions:value.versions.map((v:any)=>({...v,...(v.project?{project:projectResponse(v.project)}:{})}))}:{})};}
