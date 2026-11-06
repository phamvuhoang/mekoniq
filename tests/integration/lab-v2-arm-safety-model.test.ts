import {expect,test} from 'vitest';
import {PUMA560_SI,type ArmModelSI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {checkArmSweep,DEFAULT_ARM_GEOMETRY} from '../../packages/lab-runtime/src/v2/models/arm-collision';
import {MockArmPlant} from '../../packages/cell-adapters/src/mock-arm';
import type {CellCommand,CellReport} from '../../packages/cell-adapters/src/contract';
const simple:ArmModelSI={...PUMA560_SI,revision:'synthetic-one-metre-arm',toolM:[0,0,0],
 links:Array.from({length:6},(_,i)=>({alpha:0,a:i===1?1:0,d:0,thetaOffset:0})),limits:Array.from({length:6},()=>({min:-Math.PI,max:Math.PI,maxVelocity:2}))};
const q=(angle:number)=>[angle,0,0,0,0,0];
test('ARM03 swept checker catches a thin obstacle between clear endpoint poses and identifies the geometry pair',()=>{
 const world=[{id:'fixture-pin',kind:'sphere' as const,center:[0.955336489,-0.295520207,0] as [number,number,number],radiusM:0.003}];
 expect(checkArmSweep(simple,q(-1.2),q(-1.2),{world}).ok).toBe(true);
 expect(checkArmSweep(simple,q(1.2),q(1.2),{world}).ok).toBe(true);
 const result=checkArmSweep(simple,q(-1.2),q(1.2),{world});
 expect(result.ok).toBe(false);expect(result.pair).toContain('fixture-pin');expect(result.fraction).toBeGreaterThan(0);expect(result.fraction).toBeLessThan(1);
 expect(result).toMatchObject({engine:'capsule-sweep-v1',modelRevision:'synthetic-one-metre-arm',toleranceM:0.0005});
});
test('ARM03 held cup participates in collision checks; no cup means the same fixture is clear',()=>{
 const world=[{id:'cup-stop',kind:'box' as const,min:[0.99,-0.005,0.075] as [number,number,number],max:[1.01,0.005,0.085] as [number,number,number]}];
 expect(checkArmSweep(simple,q(0),q(0),{world}).ok).toBe(true);
 const result=checkArmSweep(simple,q(0),q(0),{world,heldCup:true});expect(result.ok).toBe(false);expect(result.pair).toEqual(['held-cup','cup-stop']);
});
test('ARM03 a clear sweep is checked and malformed or unbounded geometry cannot claim a pass',()=>{
 const result=checkArmSweep(simple,q(-1),q(1),{world:[{id:'far',kind:'sphere',center:[5,5,5],radiusM:0.1}]});
 expect(result.ok).toBe(true);expect(result.evaluations).toBeGreaterThan(0);expect(result.geometryRevision).toHaveLength(64);
 expect(()=>checkArmSweep(simple,q(0),q(1),{world:[],geometry:{...DEFAULT_ARM_GEOMETRY,linkRadiusM:-1}})).toThrow();
 expect(()=>checkArmSweep(simple,q(0),q(1),{world:[{id:'bad',kind:'sphere',center:[NaN,0,0],radiusM:1}]})).toThrow();
});
test('ARM03 non-adjacent links and the gripper are checked as geometry, not only the TCP point',()=>{
 const folded:ArmModelSI={...simple,links:simple.links.map((l,i)=>({...l,a:i>=1&&i<=3?0.4:0}))};
 const pose=[0,0,Math.PI,0,0,0];
 const self=checkArmSweep(folded,pose,pose,{world:[]});expect(self.ok).toBe(false);expect(self.pair).toEqual(['link-2','link-4']);
 const tool=checkArmSweep(simple,q(0),q(0),{world:[{id:'receiver-edge',kind:'sphere',center:[1,0,0.035],radiusM:0.002}]});
 expect(tool.ok).toBe(false);expect(tool.pair).toEqual(['gripper','receiver-edge']);
});
const command=(id:string):CellCommand=>({runId:'r',commandId:id,deviceId:'arm',controlEpoch:1,expiresAt:'2026-11-06T00:00:00Z',recipeRevision:1,programRef:{id:'cup-pick',hash:'a'.repeat(64)},payloadHash:'a'.repeat(64),capability:'start_job',payload:{jobId:'j'}});
test.each(['arm-following-error','arm-stop','arm-estop'] as const)('ARM05 %s reports stop request/ack/observed separately; reset never resumes an uncertain program or releases its cup',fault=>{
 const state=MockArmPlant.initial('arm');state.holding='cup-1';state.gripper='closed';
 const plant=new MockArmPlant(state,()=>Date.parse('2026-11-05T00:00:00Z'),()=> 'boot-2',{take:()=>null,put:()=>{throw new Error('must not release');}},()=>null),reports:CellReport[]=[];
 plant.on(r=>reports.push(r));expect(plant.execute(command('first')).accepted).toBe(true);plant.advance();const stopped=[...state.q];
 plant.fault(fault);for(let i=0;i<25;i++)plant.advance();
 expect(state.q).toEqual(stopped);expect(state.holding).toBe('cup-1');expect(plant.reconcile('first').status).toBe('unknown');
 expect(state.stop?.events.map(e=>e.stage)).toEqual(['requested','acknowledged','observed']);
 expect(reports.some(r=>r.observation?.result==='outcome_unknown')).toBe(true);
 plant.fault('arm-reset');for(let i=0;i<25;i++)plant.advance();
 expect(state.q).toEqual(stopped);expect(plant.execute(command('new')).reason).toBe('ARM_RECONCILE_REQUIRED');
 expect(state.stop).toMatchObject({latched:false,reconcileRequired:true});
});
test('ARM03 plant blocks an actual next motion at a fixture and retains modeled custody',()=>{
 const state=MockArmPlant.initial('arm');state.q=q(0);
 const plant=new MockArmPlant(state,()=>Date.parse('2026-11-05T00:00:00Z'),()=> 'boot-2',{take:()=>null,put:()=>{}},()=>null,simple);
 plant.setCollisionWorld([{id:'blocked-tool',kind:'sphere',center:[1,0,0],radiusM:0.05}]);
 expect(plant.execute(command('blocked')).accepted).toBe(true);plant.advance();
 expect(state.q).toEqual(q(0));expect(plant.reconcile('blocked').status).toBe('unknown');
 expect(state.collision?.last?.pair).toContain('blocked-tool');
});
