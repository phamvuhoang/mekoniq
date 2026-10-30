import {expect,test} from 'vitest';
import {coordinatorReady} from '../../packages/sync/src/coordinator-health';
test('a live listener cannot hide a suspended domain runtime',()=>{
 expect(coordinatorReady({serviceUp:true,runtimeLastSeenMs:1000,nowMs:5000,storeWritable:true})).toBe(false);
});
test('health requires a writable store and a bounded monotonic heartbeat age',()=>{
 const healthy={serviceUp:true,runtimeLastSeenMs:1000,nowMs:2500,storeWritable:true};
 expect(coordinatorReady(healthy)).toBe(true);
 expect(coordinatorReady({...healthy,storeWritable:false})).toBe(false);
 expect(coordinatorReady({...healthy,serviceUp:false})).toBe(false);
 expect(coordinatorReady({...healthy,runtimeLastSeenMs:3000})).toBe(false);
 expect(coordinatorReady({...healthy,runtimeLastSeenMs:NaN})).toBe(false);
});
