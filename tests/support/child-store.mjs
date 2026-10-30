// Test-only process: exercise a real abrupt exit after SQLite COMMIT and before IPC/ACK.
import {createPrivateKey,sign} from 'node:crypto';
import {openStore} from '../../packages/sync/src/store.ts';
import {processCommand} from '../../packages/sync/src/command-processor.ts';
import {stateEvent} from '../../packages/domain/src/modules.ts';
import {createProductionRegistry} from '../../packages/domain/src/application.ts';
const command=JSON.parse(process.env.MEKONIQ_TEST_COMMAND);
const privateKey=createPrivateKey({key:JSON.parse(process.env.MEKONIQ_TEST_KEY),format:'jwk'});
const store=await openStore({driver:'sqlite',url:process.env.MEKONIQ_TEST_STORE,producer:{deviceId:'coordinator',deviceEpoch:'epoch-1'},signer:bytes=>sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url'),fault:point=>{if(point==='after-local-commit'&&process.env.MEKONIQ_TEST_FAULT==='kill-after-local-commit')process.kill(process.pid,'SIGKILL');}});
const registry=createProductionRegistry();
registry.register('Journal.RecordNote',c=>({ok:true,events:[stateEvent('NoteRecorded','note',c.operationId,{text:c.payload.text})],value:{}}));
await processCommand(store,command,(c,s)=>registry.decide(c,s),async()=>true);
await store.close();
