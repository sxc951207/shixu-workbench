export type BackupKind='automatic'|'manual'|'before-restore';
export interface BackupSummary{id:string;kind:BackupKind;createdAt:string;count:number;bytes:number;revision:number;checksum:string;}
export interface BackupPreview{backup:BackupSummary;currentRevision:number;currentCount:number;targetCount:number;added:number;removed:number;changed:number;counts:Record<string,number>;}
