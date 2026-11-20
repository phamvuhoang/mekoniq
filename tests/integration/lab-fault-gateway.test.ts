// V08: the gateway's face of the drive fault catalog: what health offers, what validate says about a schedule, what a run request may carry. No engine: a stub context and factory.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {validateRunRequestV2} from '../../packages/lab-runtime/src/v2/contracts';

const gateways:LabGateway[]=[],dirs:string[]=[];afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const origin='http://127.0.0.1:4175';
async function open(withFaults:boolean){
 const directory=await mkdtemp(join(tmpdir(),'fault-gw-'));dirs.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test',schemaHash:'a'.repeat(64),v2:{...withFaults?{driveFaultContext:async(r:{backendSetId:string;driveExperimentId?:string})=>r.backendSetId==='engineering-mujoco-cell-v1'&&r.driveExperimentId?{axes:['arm-1/J1','arm-1/gripper','amr-1/wheel-left','amr-1/wheel-right'],lidars:[]}:null}:{}}});gateways.push(g);
 const token=(await (await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})})).json()).sessionToken as string;
 const post=async(path:string,body:unknown)=>{const r=await fetch(g.url+'/lab/v2'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as Record<string,unknown>};};
 return {g,post,token};
}
const entry=(faultId:string,targetId:string,at:number,durationMs:number,params:Record<string,number>={})=>({id:`${faultId}-${at}`,faultId,targetId,trigger:{kind:'elapsed_sim_ms',value:at},durationMs,params});
const ask=(schedule:unknown[],extra:Record<string,unknown>={})=>({driveFaultSchedule:schedule,backendSetId:'engineering-mujoco-cell-v1',scenarioId:'MJ-CELL-BV01',driveExperimentId:'drive-nominal-v1',...extra});

test('health offers the catalog (without the campaign-only fault) only where the runtime can run drive faults',async()=>{
 const on=await open(true),h=await (await fetch(on.g.url+'/lab/v2/health')).json() as {faultCatalog?:{id:string;layer:string;target:string;params:Record<string,{min:number;max:number;required:boolean}>}[]};
 expect(h.faultCatalog!.map(f=>f.id).sort()).toEqual(['command-delay','command-loss','encoder-dropout','grip-weak','lidar-noise','motor-weak','drive-trip'].sort());
 expect(h.faultCatalog!.find(f=>f.id==='motor-weak')).toMatchObject({layer:'drive',target:'axis',params:{torqueScale:{min:0.2,max:0.95,required:true}}});
 const off=await open(false);expect(((await (await fetch(off.g.url+'/lab/v2/health')).json()) as {faultCatalog?:unknown}).faultCatalog).toBeUndefined();
});
test('validate checks a drive fault schedule against the experiment; a project body still goes the old way',async()=>{
 const {post}=await open(true);
 expect(await post('/projects/validate',ask([entry('motor-weak','amr-1/wheel-left',1000,2000,{torqueScale:0.5})]))).toMatchObject({status:200,body:{ok:true}});
 const overlap=await post('/projects/validate',ask([entry('motor-weak','amr-1/wheel-left',1000,2000,{torqueScale:0.5}),entry('motor-weak','amr-1/wheel-left',2000,1000,{torqueScale:0.5})]));
 expect(overlap.status).toBe(422);expect(overlap.body).toMatchObject({error:'INVALID_FAULT_SCHEDULE',reasonCodes:['FAULT_OVERLAP']});
 expect((await post('/projects/validate',ask([entry('drive-reset','amr-1/wheel-left',0,20)]))).body).toMatchObject({reasonCodes:['FAULT_CAMPAIGN_ONLY']});   // never from a browser
 expect((await post('/projects/validate',ask([entry('encoder-dropout','amr-1/wheel-left',0,300)],{driveExperimentId:undefined}))).body).toMatchObject({error:'FAULT_BACKEND_UNSUPPORTED'});   // no drive on this run
 expect((await post('/projects/validate',{...ask([]),extra:1})).status).toBe(422);                                   // nothing else rides along
 expect((await post('/projects/validate',{})).body).toMatchObject({error:'INVALID_PROJECT'});
});
test('without a fault context the runtime refuses to check a schedule at all',async()=>{
 const {post}=await open(false);
 expect((await post('/projects/validate',ask([entry('encoder-dropout','amr-1/wheel-left',0,300)]))).body).toMatchObject({error:'FAULT_BACKEND_UNSUPPORTED'});
});
test('a run request carries driveFaultSchedule only on a simulation run of a drive scenario, never on a bench',()=>{
 const base={scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation',backendSetId:'engineering-mujoco-cell-v1',access:'simulated',runtimeIdentity:{sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64)},engineeringRef:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)},driveExperimentId:'drive-nominal-v1'};
 const sched=[entry('encoder-dropout','amr-1/wheel-left',0,300)];
 const first=validateRunRequestV2({...base,driveFaultSchedule:sched});expect(first.ok,JSON.stringify(first)).toBe(true);
 expect(validateRunRequestV2({...base,driveFaultSchedule:Array.from({length:17},(_,i)=>entry('encoder-dropout','amr-1/wheel-left',i*1000,100))}).ok).toBe(false);   // 17 entries: schema
 expect(validateRunRequestV2({...base,mode:'mock',backendSetId:'mock-mock',driveExperimentId:undefined,driveFaultSchedule:sched})).toMatchObject({ok:false,issues:[{code:'FAULT_BACKEND_UNSUPPORTED'}]});
 expect(validateRunRequestV2({...base,driveExperimentId:undefined,driveFaultSchedule:sched})).toMatchObject({ok:false,issues:[{code:'FAULT_BACKEND_UNSUPPORTED'}]});   // a cell run needs its drive experiment
 expect(validateRunRequestV2({scenarioId:'MJ-BENCH-WHEEL',scenarioRevision:1,seed:7,mode:'simulation',backendSetId:'engineering-mujoco-bench-v1',access:'simulated',runtimeIdentity:{sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64)},driveFaultSchedule:sched,bench:{}}).ok).toBe(false);
});
