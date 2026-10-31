import {expect,test} from 'vitest';
import {startCloudSync,type CloudSyncOptions} from '../../apps/tablet-android/src/cloud-sync';
import {createLab} from '../support/lab';
import {testPublicJwk} from '../support/storage-cases';

test('cloud request deadline aborts the native request rather than just abandoning its promise',async()=>{
 const lab=await createLab();let aborted=false;
 const request:CloudSyncOptions['request']=async input=>{
  const signal=(input as typeof input & {signal?:AbortSignal}).signal;
  return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('CLOUD_REQUEST_CANCELLED'));},{once:true}));
 };
 const loop=startCloudSync({store:await lab.getStore('coordinator'),scope:lab.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:false,cloudPublicJwk:testPublicJwk,request,requestTimeoutMs:20,autostart:false,dispatchDelegated:async()=>{throw new Error('not delegated');}});
 try{expect((await loop.tick()).status).toBe('unavailable');expect(aborted).toBe(true);}
 finally{await loop.close();await lab.close();}
});

test('closing cloud synchronization aborts the active native request',async()=>{
 const lab=await createLab();let signal:AbortSignal|undefined;
 let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
 const loop=startCloudSync({store:await lab.getStore('coordinator'),scope:lab.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:false,cloudPublicJwk:testPublicJwk,autostart:false,request:async input=>{signal=input.signal;ready();return new Promise(()=>{});},dispatchDelegated:async()=>{throw new Error('not delegated');}});
 try{const cycle=loop.tick();await started;await loop.close();expect(signal?.aborted).toBe(true);expect((await cycle).status).toBe('unavailable');}
 finally{await loop.close();await lab.close();}
});

test('native bridge cancellation targets the same request and does not serialize AbortSignal',async()=>{
 const {nativeCloudRequest}=await import('../../apps/tablet-android/src/native-cloud-request');
 const pending=new Map<string,(reason:Error)=>void>();let cancelled=0;
 const request=nativeCloudRequest({cloudRequest:input=>{
  expect(Object.hasOwn(input,'signal')).toBe(false);
  return new Promise((_resolve,reject)=>{pending.set(input.requestId,reject);});
 },cancelNetworkRequest:async({requestId})=>{
  const reject=pending.get(requestId);if(!reject)return {cancelled:false};
  pending.delete(requestId);cancelled++;reject(new Error('NETWORK_CANCELLED'));return {cancelled:true};
 }});
 const controller=new AbortController(),result=request({method:'POST',path:'/v1/sync/handshake',signal:controller.signal});
 expect(pending.size).toBe(1);controller.abort();await expect(result).rejects.toThrow('NETWORK_CANCELLED');expect(pending.size).toBe(0);expect(cancelled).toBe(1);
});
