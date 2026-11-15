// Lifecycle protocol doubles. These test evidence classification, not native startup/execution.
import {test,expect,vi,afterEach} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import * as factory from '../../packages/lab-runtime/src/v2/sil/xarm-provider';
import {runXarmCase} from '../../packages/lab-runtime/src/v2/sil/xarm-cli';
afterEach(()=>vi.restoreAllMocks());
for(const [name,ack]of Object.entries({lostAck:{accepted:false,unknown:true,reason:'ACK_UNKNOWN'},rejected:{accepted:false,unknown:false,reason:'ACTION_REJECTED'}})){
 test('CLI '+name+' remains attempted and retains command receipt',async()=>{
  const out=join(await mkdtemp(join(tmpdir(),'xarm-cli-')),'run');let attempts=0;
  vi.spyOn(factory,'createXarmSimProvider').mockResolvedValue({evidenceKind:'protocol_double',adapter:{execute:async()=>{attempts++;return ack;}},close:async()=>{}} as never);
  const r=await runXarmCase({sourceRoot:resolve('.'),out,mode:'X2',environmentProfile:'engineering-arm64',nativeCase:'nominal'});
  expect(r.motion).toMatchObject({status:'executed',result:'fail'});expect(attempts).toBe(1);expect(JSON.parse(await readFile(join(out,'source-command.json'),'utf8')).ack).toEqual(ack);
  expect(r.evidenceKind).toBe('protocol_double');
  expect(JSON.parse(await readFile(join(out,'source-lifecycle.json'),'utf8'))).toMatchObject({phase:'command_attempted',startup:'ready',command:ack.unknown?'unknown':'rejected'});
 });
}
for(const [name,error,status]of [['preflight','XARM_NATIVE_NOT_QUALIFIED:OS_MISMATCH','not_run'],['startup','XARM_STARTUP_TIMEOUT','executed']] as const){
 test('CLI '+name+' phase is distinct',async()=>{
  vi.spyOn(factory,'createXarmSimProvider').mockRejectedValue(Error(error));
  const out=join(await mkdtemp(join(tmpdir(),'xarm-cli-')),'run');const r=await runXarmCase({sourceRoot:resolve('.'),out,mode:'X2',environmentProfile:'engineering-arm64',nativeCase:'nominal'});
  expect(r.motion.status).toBe(status);expect(r.motion.result).toBe(status==='not_run'?'blocked_external':'fail');
 });
}

test('CLI durably records dispatch intent before transport and preserves unknown on thrown ACK and failed close',async()=>{
 const out=join(await mkdtemp(join(tmpdir(),'xarm-cli-')),'run');
 vi.spyOn(factory,'createXarmSimProvider').mockResolvedValue({evidenceKind:'protocol_double',adapter:{execute:async()=>{
  expect(JSON.parse(await readFile(join(out,'source-lifecycle.json'),'utf8'))).toMatchObject({phase:'command_attempted',command:'unknown'});
  expect(JSON.parse(await readFile(join(out,'source-command.json'),'utf8')).ack).toBeNull();throw Error('TRANSPORT_LOST');
 }},close:async()=>{throw Error('CLOSE_UNKNOWN');}} as never);
 const r=await runXarmCase({sourceRoot:resolve('.'),out,mode:'X2',environmentProfile:'engineering-arm64',nativeCase:'nominal'});
 expect(r.motion).toEqual({status:'executed',result:'fail',reason:'TRANSPORT_LOST'});
 expect(JSON.parse(await readFile(join(out,'source-lifecycle.json'),'utf8'))).toMatchObject({command:'unknown',shutdownErrors:['CLOSE_UNKNOWN']});
});
