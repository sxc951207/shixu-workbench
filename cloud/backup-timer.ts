import {timingSafeEqual} from 'node:crypto';
import {runAutomaticBackup} from './backups.ts';
import {runCompanyCheckpoints} from './company/checkpoints.ts';
import type {CompanyStore} from './company/store.ts';
import type {CloudStore} from './service.ts';

export const BACKUP_TRIGGER = 'ShixuBackupHourly';
type TimerEvent = {Type?:string; TriggerName?:string; Message?:unknown};

export function createBackupTimer(store:CloudStore, secret:string, companyStore:CompanyStore) {
  if (secret.length < 32) throw Error('Missing backup trigger secret');
  return async (event:TimerEvent, clock = new Date()) => {
    let token:unknown;
    try {
      if (typeof event?.Message === 'string' && event.Message.length < 1000) {
        token = JSON.parse(event.Message).token;
      }
    } catch { /* Invalid arguments fall through to the trigger check. */ }
    if (event?.Type !== 'Timer' || event.TriggerName !== BACKUP_TRIGGER ||
        typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
      throw Error('Unauthorized backup trigger');
    }

    const [personal, companies] = await Promise.allSettled([
      runAutomaticBackup(store, clock),
      runCompanyCheckpoints(companyStore, clock),
    ]);
    const companyFailed = companies.status === 'rejected' || !!companies.value.failedCompanies?.length;
    if (personal.status === 'rejected') {
      throw Error(companyFailed ? 'Personal and company backups failed' : 'Personal backup failed');
    }
    if (companyFailed) throw Error('Company backup failed');
    return {...personal.value, companies:companies.value};
  };
}
