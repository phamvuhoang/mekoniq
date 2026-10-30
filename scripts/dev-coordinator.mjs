import {spawn} from 'node:child_process';
if(process.env.MEKONIQ_DEV_LAB!=='1')throw new Error('Set MEKONIQ_DEV_LAB=1 for the isolated development fixture server');
const child=spawn(process.execPath,['--import','tsx','tests/support/coordinator-server.ts'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));
child.once('exit',code=>process.exit(code??1));
