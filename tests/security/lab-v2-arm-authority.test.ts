// A05 security: the Lab has no raw actuator path to the arm. The adapter exposes only allowlisted cell capabilities (no jog, no MDI, no HAL),
// every envelope is schema-validated before it leaves (forbidden fields are named, never forwarded), local/revoke shapes are never produced,
// and the simulation backend stays unavailable in the catalog until it is installed: no mock fallback, no mode change mid-run.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import type {JsonValue} from '../../packages/contracts/src/index';
import {hashPayload} from '../../packages/contracts/src/canonical';
import type {CellCommand} from '../../packages/cell-adapters/src/contract';
import {LinuxcncArmAdapter,loadArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {classifyField,validateArmCommand} from '../../packages/lab-runtime/src/v2/contracts';
import {admitBackend,defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {instantiateBackends} from '../../packages/lab-runtime/src/v2/backend-registry';
import {ArmBridgeDouble} from '../support/arm-bridge-double';
const RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c',PROFILE='integrations/arm-controller/configs/sim/puma560/profile.json';
const t=Date.parse('2026-11-05T08:00:00Z');
const cmd=(capability:string,payload:Record<string,unknown>,extra:Record<string,unknown>={}):CellCommand=>({commandId:'c-1',runId:RUN,deviceId:'arm-1',controlEpoch:1,expiresAt:new Date(t+30000).toISOString(),recipeRevision:null,programRef:null,capability,payloadHash:hashPayload(payload as JsonValue),payload,...extra} as unknown as CellCommand);

test('the adapter has no jog, MDI, HAL or endpoint surface and never emits local or revoke shapes',async()=>{
 const double=new ArmBridgeDouble(loadArmProfile(PROFILE),()=>t),adapter=new LinuxcncArmAdapter({port:double,profile:loadArmProfile(PROFILE),runId:RUN,cellId:'cell-1',deviceId:'arm-1',nowMs:()=>t});
 await adapter.open();
 expect((await adapter.describe()).capabilities).toEqual(['stage_program','start_job','pause_job','resume_job','cancel_job','query_outcome']);
 for(const name of ['jog','jogJoint','mdi','halcmd','local','revoke','sendGcode','setEndpoint'])expect((adapter as unknown as Record<string,unknown>)[name],name).toBeUndefined();
 expect(await adapter.execute(cmd('query_outcome',{targetCommandId:'x',url:'http://10.0.0.1/halcmd'}))).toEqual({accepted:false,unknown:false,reason:'ARM_ENVELOPE_INVALID:ENDPOINT_FORBIDDEN'});
 expect(await adapter.execute(cmd('query_outcome',{targetCommandId:'x'},{gcode:'G0 X1'}))).toEqual({accepted:false,unknown:false,reason:'ARM_ENVELOPE_INVALID:RAW_COMMAND_FORBIDDEN'});
 expect(await adapter.execute(cmd('query_outcome',{targetCommandId:'x'},{actor:'local_operator'}))).toEqual({accepted:false,unknown:false,reason:'ARM_ENVELOPE_INVALID:ACTOR_FORBIDDEN'});
 expect(double.log.filter(m=>m.command||m.local||m.revoke)).toEqual([]);                   // nothing forbidden reached the bridge
 expect(double.log.every(m=>m.owner.actor==='lab_simulation')).toBe(true);
});

test('forbidden envelope fields are classified by name, including browser-supplied actors and endpoints',()=>{
 const fx=JSON.parse(readFileSync('tests/fixtures/digital-twin/arm/messages.json','utf8')) as {valid:{message:Record<string,unknown>}[]};
 const base=structuredClone(fx.valid.find(v=>(v.message as {command?:unknown}).command)!.message) as Record<string,unknown>&{owner:Record<string,unknown>;command:Record<string,unknown>};
 expect(validateArmCommand({...base,endpoint:'tcp://10.0.0.1:5000'}).ok).toBe(false);
 expect(classifyField('endpoint')).toBe('ENDPOINT_FORBIDDEN');expect(classifyField('halcmd')).toBe('RAW_COMMAND_FORBIDDEN');expect(classifyField('principal')).toBe('ACTOR_FORBIDDEN');expect(classifyField('backendSetId')).toBe('MODE_IMMUTABLE');
 const forged={...base,owner:{...base.owner,actor:'authorized_cell_job'},local:{action:'jog_start',joint:0,velocityDegS:5}};
 const r=validateArmCommand(forged);expect(r.ok).toBe(false);if(!r.ok)expect(r.issues.map(i=>i.code)).toContain('MESSAGE_SHAPE_AMBIGUOUS');
});

test('linuxcnc_sim is unavailable in the catalog until installed; no run instantiates it and no mock stands in',()=>{
 expect(admitBackend('simulation',['linuxcnc_sim'],defaultCatalog,'simulated')).toMatchObject({ok:false,reasonCodes:expect.arrayContaining(['BACKEND_NOT_INSTALLED'])});
 expect(()=>instantiateBackends('coffee-simulation',defaultCatalog,['gazebo_nav2','linuxcnc_sim','coffee_io_sim'])).toThrow(/BACKEND_EXECUTION_DISABLED|BACKEND_UNAVAILABLE/);
 expect(admitBackend('mock',['linuxcnc_sim'],defaultCatalog,'simulated').reasonCodes).toContain('MODE_BACKEND_MISMATCH');
});
