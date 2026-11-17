import cloudbase from '@cloudbase/node-sdk';
import {createCloudStore} from './store';
import {createBackupTimer} from './backup-timer';
import {createCompanyStore} from './company/store';

const app = cloudbase.init({env:process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV});
const db = app.database();
const timer = createBackupTimer(createCloudStore(db), process.env.WB_BACKUP_TIMER_SECRET || '', createCompanyStore(db));

export const main = (event:Parameters<typeof timer>[0]) => timer(event);
