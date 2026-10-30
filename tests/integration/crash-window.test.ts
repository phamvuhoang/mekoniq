import {expect,test} from 'vitest';
import {createLab} from '../support/lab';
test('kill after real SQLite commit returns unknown; retry creates one event',async()=>{
  const lab=await createLab();
  try {
    await lab.fault('kill-after-local-commit');
    expect((await lab.command('cashier','Journal.RecordNote',{text:'persist'},'op-crash')).status).toBe('unknown');
    await lab.restart('coordinator');
    expect((await lab.command('cashier','Journal.RecordNote',{text:'persist'},'op-crash')).duplicate).toBe(true);
    expect(await lab.count('NoteRecorded')).toBe(1);
  } finally {await lab.close();}
});
test('exception before commit rolls back journal and sequence',async()=>{
  const lab=await createLab();
  try {
    await lab.fault('before-local-commit');
    await expect(lab.command('cashier','Journal.RecordNote',{text:'not committed'},'op-rollback')).rejects.toThrow('INJECTED_FAILURE');
    expect(await lab.count('NoteRecorded')).toBe(0);
    await lab.command('cashier','Journal.RecordNote',{text:'persist'},'op-success');
    expect((await(await lab.getStore('coordinator')).journal(lab.scope))[0].sequence).toBe('1');
  }finally{await lab.close();}
});
