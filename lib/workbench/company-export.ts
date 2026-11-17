import{ARCHIVE_MAX_BYTES}from'./company-archive.ts';
export function serializeCompanyExport(manifest:any,versions:unknown[],maxBytes=ARCHIVE_MAX_BYTES):string{const file=JSON.stringify({...manifest,versions});if(new TextEncoder().encode(file).byteLength>maxBytes)throw Error('独立备份文件超过大小上限64 MiB，请保留云端数据并联系管理员处理');return file;}
