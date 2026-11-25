import {expect,test} from 'vitest';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import {TwinStore,type TwinSample} from '../../src/twin/store';
// Opt-in measurement (LAB_TWIN_MEASURE=<file.json>): verification workload entities (2 AMR + 1 arm + 1 coffee cell; 6 tables are static,
// no telemetry) at 10 Hz for 180 s into the browser TwinStore. Records apply latency and heap; asserts only the buffer bound.
test.runIf(!!process.env.LAB_TWIN_MEASURE)('measure TwinStore apply latency and memory on the verification workload',async()=>{
 let clock=0;const store=new TwinStore({now:()=>clock});
 const ents=[['amr-1','mock_amr','map'],['amr-2','mock_amr','map'],['arm-1','mock_arm','arm_base'],['coffee-1','mock_coffee','cell_base']] as const;
 const mk=(e:typeof ents[number],tick:number):TwinSample=>({schemaVersion:2,runId:'r',entityId:e[0],providerId:e[1],bootId:'b',seq:String(tick),simTimeNs:String(BigInt(tick)*20000000n),observedAt:null,receivedMonotonicNs:'0',frameId:e[2],origin:'mock',
  quality:e[1]==='mock_arm'?'unknown':'valid',reasonCodes:e[1]==='mock_arm'?['NO_ENCODER_MOCK']:[],commanded:e[1]==='mock_arm'?{jointsRad:[0,1,2,3,4,5].map(i=>i*0.1+tick*1e-4),gripper:'open'}:null,
  observed:e[1]==='mock_amr'?{xM:tick*0.01,yM:1,yawRad:0,moving:true,hold:null}:e[1]==='mock_coffee'?{cycleState:'brew',cupPresent:true,machineStatus:'ready'}:null,estimated:null,causationId:null});
 (globalThis as {gc?:()=>void}).gc?.();const heap0=process.memoryUsage().heapUsed,lat:number[]=[];
 for(let i=1;i<=1800;i++){clock=i*100;for(const e of ents){const s=mk(e,i*5),t=process.hrtime.bigint();store.apply(s);lat.push(Number(process.hrtime.bigint()-t)/1000);}}
 lat.sort((a,b)=>a-b);const q=(p:number)=>lat[Math.floor(p*(lat.length-1))]!;
 const held=ents.reduce((n,e)=>n+store.history(e[0]).length,0);
 expect(held).toBeLessThanOrEqual(4*2000);
 await writeFile(process.env.LAB_TWIN_MEASURE!,JSON.stringify({host:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,memGiB:Math.round(os.totalmem()/2**30)},
  command:'LAB_TWIN_MEASURE=docs/implementation/evidence/digital-twin-v2/F06-twin-store-measure.json pnpm exec vitest run tests/integration/twin-telemetry-measure.test.ts',
  workload:'2 AMR + 1 arm + 1 coffee cell at 10 Hz, 180 s simulated receipt time (7200 samples); Node (not a browser) process',
  applyLatencyUs:{p50:q(0.5),p95:q(0.95),p99:q(0.99),max:lat[lat.length-1]},heldSamples:held,stats:store.stats,heapDeltaMiB:+((process.memoryUsage().heapUsed-heap0)/2**20).toFixed(2)},null,2)+'\n');
});
