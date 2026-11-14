import {expect,test} from 'vitest';
import {createNavigationController} from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import {sealDocument} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {validateWorldScene,readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {resolve} from 'node:path';
const bounds={minM:[-.6,-.6] as [number,number],maxM:[6,4] as [number,number]};
test('world signed bounds admit actual full-footprint dock departure and return, preserving old route golden',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));
 const options={ramp:'previous-sent-command-v1' as const,composition:'single_world' as const,worldBounds:bounds};
 const from:[number,number,number]=[.34999996626296154,.48591624929828203,1.5707894921802183];
 const c=createNavigationController(scene.navigation,options);c.setGoal({robotId:'amr-1',commandId:'outbound',target:[5,3,0]});expect(c.route('amr-1',from)).not.toBeNull();
 c.setGoal({robotId:'amr-1',commandId:'return',target:[.35,.48591366218667575,Math.PI/2]});expect(c.route('amr-1',[5,3,0])).not.toBeNull();
 const old=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1'});old.setGoal({robotId:'amr-1',commandId:'legacy',target:[5,3,0]});expect(old.route('amr-1',from)).toBeNull();expect(old.route('amr-1',[.5,.5,Math.PI/2])).toBeNull();
 const golden=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1'});golden.setGoal({robotId:'amr-1',commandId:'golden',target:[5,3,0]});expect(golden.route('amr-1',[.5,.5,Math.PI/2])).toEqual([[.5,.5],[3,3],[5,3]]);
});
test('signed bounds fail closed for unsupported mode, invalid extent and out-of-map goal',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));
 expect(()=>createNavigationController(scene.navigation,{worldBounds:bounds})).toThrow('WORLD_NAVIGATION_BOUNDS_INVALID');
 for(const b of [{minM:[0,0],maxM:[0,1]},{minM:[NaN,0],maxM:[6,4]},{minM:[-1000,-1],maxM:[6,4]}])expect(()=>createNavigationController(scene.navigation,{composition:'single_world',worldBounds:b as typeof bounds})).toThrow('WORLD_NAVIGATION_BOUNDS_INVALID');
 const c=createNavigationController(scene.navigation,{composition:'single_world',worldBounds:bounds});c.setGoal({robotId:'amr-1',commandId:'outside',target:[6.1,2,0]});expect(c.route('amr-1',[.5,.5,0])).toBeNull();
 const other=structuredClone(scene.navigation);other.engine.id='irsim_2d';expect(()=>createNavigationController(other,{composition:'single_world',worldBounds:bounds})).toThrow('WORLD_NAVIGATION_BOUNDS_INVALID');
});
test('world precise arrival cannot hide an actual dock pose outside the readiness window',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));scene.navigation.robots[0]!.model.sensors=[];
 const target:[number,number,number]=[.35,.48591366218667575,Math.PI/2];
 const c=createNavigationController(scene.navigation,{composition:'single_world',worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016}});c.setGoal({robotId:'amr-1',commandId:'return',target});
 for(let tick=1;tick<=6;tick++){const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[target[0]+.015,target[1],target[2]],bodyVelocity:[0,0],scans:[]}]} as never,{});expect(r.decisions.some(d=>d.status==='arrived')).toBe(false);}
});
test('world v2 translation settles the actual lagged drive inside arrival bounds before retiring its leg',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));scene.navigation.robots[0]!.model.sensors=[];
 const c=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1',composition:'single_world',worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016},worldBraking:{designBrakingDecelerationMps2:.25,settleBeforeTranslationAdvance:true}});
 c.setGoal({robotId:'amr-1',commandId:'lagged',target:[5,.5,0]});let x=.5,v=0,arrived=false;
 for(let tick=1;tick<=1000;tick++){
  const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,.5,0],bodyVelocity:[v,0],scans:[]}]} as never,{});
  if(r.decisions.some(d=>d.status==='arrived')){arrived=true;expect(Math.abs(x-5)).toBeLessThanOrEqual(.008);expect(Math.abs(v)).toBeLessThanOrEqual(.01);break;}
  v+=.6*(r.velocities[0]!.vMps-v);x+=v*.02;
 }
 expect(arrived).toBe(true);
});
test('world v2 brakes at the observed 3.9225mm/0.1435mps boundary without prematurely retiring translation',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));scene.navigation.robots[0]!.model.sensors=[];
 const c=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1',composition:'single_world',worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016},worldBraking:{designBrakingDecelerationMps2:.25,settleBeforeTranslationAdvance:true}});
 c.setGoal({robotId:'amr-1',commandId:'boundary',target:[5,.5,0]});const sample=(tick:number,x:number,v:number)=>({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,.5,0],bodyVelocity:[v,0],scans:[]}]}) as never;
 c.advance(sample(1,.5,0),{});const r=c.advance(sample(2,4.99607749,.1435045),{});expect(r.decisions.some(d=>d.status==='arrived')).toBe(false);expect(r.velocities[0]!.vMps).toBe(0);expect(c.route('amr-1',[4.99607749,.5,0])?.slice(1).some(p=>Math.hypot(p[0]-5,p[1]-.5)<1e-12)).toBe(true);
});

test('world terminal approach recovers the retained turn displacement before same-goal arrival',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));scene.navigation.robots[0]!.model.sensors=[];
 const c=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1',composition:'single_world',worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016},worldBraking:{designBrakingDecelerationMps2:.25,settleBeforeTranslationAdvance:true},worldTerminalApproachM:.2});
 const target:[number,number,number]=[.35,.48591366218667575,Math.PI/2];c.setGoal({robotId:'amr-1',commandId:'same-return-command',target});
 let x=5,y=3,yaw=0,v=0,w=0,arrived=false,turn=0,shifted=false;
 // Replay the measured final-turn displacement once during a >2rad near-goal turn. This tests feedback policy, not native dynamics.
 for(let tick=1;tick<=4000;tick++){
  const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,y,yaw],bodyVelocity:[v,w],scans:[]}]} as never,{});
  const d=r.decisions[0];if(d){expect(d.commandId).toBe('same-return-command');expect(['blocked','no_path'],JSON.stringify({tick,x,y,yaw,v,w,d,route:c.route('amr-1',[x,y,yaw])})).not.toContain(d.status);if(d.status==='arrived'){arrived=true;expect(Math.hypot(x-target[0],y-target[1])).toBeLessThanOrEqual(.008);expect(Math.abs(Math.atan2(Math.sin(yaw-target[2]),Math.cos(yaw-target[2])))).toBeLessThanOrEqual(.016);expect(Math.abs(v)).toBeLessThanOrEqual(.01);expect(Math.abs(w)).toBeLessThanOrEqual(.02);break;}}
  v+=.6*(r.velocities[0]!.vMps-v);w+=.15*(.52*r.velocities[0]!.omegaRadps-w);
  x+=v*Math.cos(yaw)*.02;y+=v*Math.sin(yaw)*.02;yaw+=w*.02;
  turn=Math.abs(r.velocities[0]!.vMps)<.01?turn+Math.abs(w)*.02:0;
  if(!shifted&&turn>2&&Math.hypot(x-target[0],y-target[1])<.25){x+=.007841692584956761;y-=.004225625404484568;shifted=true;}
 }
 expect(shifted).toBe(true);expect(arrived).toBe(true);
});

test('world terminal corridor is explicit, swept against obstacles and bounds, with no unchecked fallback',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));const options={ramp:'previous-sent-command-v1' as const,composition:'single_world' as const,worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016},worldBraking:{designBrakingDecelerationMps2:.25,settleBeforeTranslationAdvance:true as const},worldTerminalApproachM:.2};
 const c=createNavigationController(scene.navigation,options);c.setGoal({robotId:'amr-1',commandId:'return',target:[.35,.48591366218667575,Math.PI/2]});expect(c.route('amr-1',[5,3,0])?.slice(-2)).toEqual([[.35,.28591366218667574],[.35,.48591366218667575]]);
 c.setGoal({robotId:'amr-1',commandId:'already-docked',target:[.35,.48591366218667575,Math.PI/2]});expect(c.route('amr-1',[.35,.48591366218667575,Math.PI/2])).toEqual([[.35,.48591366218667575]]);
 c.setGoal({robotId:'amr-1',commandId:'impossible-stage',target:[-.2,2,0]});expect(c.route('amr-1',[1,2,0])).toBeNull();
 const blocked=structuredClone(scene.navigation);blocked.robots[0]!.model.footprint.verticesM=[[-.02,-.02],[.02,-.02],[.02,.02],[-.02,.02]];blocked.world.obstacles.push({id:'terminal-block',verticesM:[[4.87,2.99],[4.89,2.99],[4.89,3.01],[4.87,3.01]]} as never);const b=createNavigationController(blocked,options);b.setGoal({robotId:'amr-1',commandId:'blocked-stage',target:[5,3,0]});expect(b.route('amr-1',[3,3,0])).toBeNull();
 for(const v of [0,.1,NaN,Infinity])expect(()=>createNavigationController(scene.navigation,{...options,worldTerminalApproachM:v})).toThrow('WORLD_NAVIGATION_TERMINAL_APPROACH_INVALID');expect(()=>createNavigationController(scene.navigation,{worldTerminalApproachM:.2})).toThrow('WORLD_NAVIGATION_TERMINAL_APPROACH_INVALID');
});

test('world policy admission preserves archived v1/v2/v3 while requiring exact v4 reverse approach',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'),'coffee-delivery-cell-v1');
 for(const version of ['1','2','3','4']){const copy=structuredClone(scene),p=copy.controllerPolicy!;p.id=('grid-diff-world-v'+version) as typeof p.id;p.version=version as typeof p.version;if(!['3','4'].includes(version))delete p.terminalApproachDistanceM;if(version!=='4')delete p.terminalApproachDirection;if(version==='1')delete p.braking;expect(()=>validateWorldScene(sealDocument(copy,'sceneDigest'))).not.toThrow();}
 const missing=structuredClone(scene);delete missing.controllerPolicy!.terminalApproachDistanceM;expect(()=>validateWorldScene(sealDocument(missing,'sceneDigest'))).toThrow();
 const directionMissing=structuredClone(scene);delete directionMissing.controllerPolicy!.terminalApproachDirection;expect(()=>validateWorldScene(sealDocument(directionMissing,'sceneDigest'))).toThrow();
 const wrong=structuredClone(scene);(wrong.controllerPolicy! as unknown as {terminalApproachDistanceM:number}).terminalApproachDistanceM=.1;expect(()=>validateWorldScene(sealDocument(wrong,'sceneDigest'))).toThrow();
});

const reverseOptions={ramp:'previous-sent-command-v1' as const,composition:'single_world' as const,worldBounds:bounds,worldTolerances:{legM:.004,positionM:.008,yawRad:.016},worldBraking:{designBrakingDecelerationMps2:.25,settleBeforeTranslationAdvance:true as const},worldTerminalApproachM:.2,worldTerminalApproachDirection:'reverse' as const};
const rearScan=(tick:number)=>({sensorId:'lidar-2d',frameId:'lidar/head',tick,simTimeNs:String(tick*20000000),angleMinRad:-Math.PI,angleIncrementRad:2*Math.PI/360,rangeMinM:.05,rangeMaxM:10,rangesM:Array.from({length:360},()=>null as number|null),states:Array.from({length:360},()=> 'no_return' as 'no_return'|'invalid'|'hit')});
test('world reverse terminal step preserves body heading, signed ramp/wheel limits and unchanged goal hold',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));const c=createNavigationController(scene.navigation,reverseOptions),target:[number,number,number]=[.35,.48591366218667575,Math.PI/2];
 c.setGoal({robotId:'amr-1',commandId:'same-reverse-command',target});expect(c.route('amr-1',[5,3,0])?.slice(-2)).toEqual([[.35,.6859136621866757],[target[0],target[1]]]);
 let x=5,y=3,yaw=0,v=0,w=0,turn=0,shifted=false,arrived=false,negative=0,previous=[0,0];const k=scene.navigation.robots[0]!.model.kinematics;
 for(let tick=1;tick<=4000;tick++){
  const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,y,yaw],bodyVelocity:[v,w],scans:[rearScan(tick)]}]} as never,{}),cmd=r.velocities[0]!,d=r.decisions[0];
  expect(Math.abs(cmd.vMps-previous[0]!)).toBeLessThanOrEqual(.0100000001);expect(Math.abs(cmd.omegaRadps-previous[1]!)).toBeLessThanOrEqual(.0300000001);expect(Math.abs((cmd.vMps-cmd.omegaRadps*k.wheelSeparationM/2)/k.wheelRadiusM)).toBeLessThanOrEqual(k.maxWheelRadps.left+1e-9);expect(Math.abs((cmd.vMps+cmd.omegaRadps*k.wheelSeparationM/2)/k.wheelRadiusM)).toBeLessThanOrEqual(k.maxWheelRadps.right+1e-9);previous=[cmd.vMps,cmd.omegaRadps];if(cmd.vMps<0)negative++;
  if(d){expect(d.commandId).toBe('same-reverse-command');expect(['blocked','no_path']).not.toContain(d.status);if(d.status==='arrived'){arrived=true;expect(Math.hypot(x-target[0],y-target[1])).toBeLessThanOrEqual(.008);expect(Math.abs(Math.atan2(Math.sin(yaw-target[2]),Math.cos(yaw-target[2])))).toBeLessThanOrEqual(.016);expect(Math.abs(v)).toBeLessThanOrEqual(.01);expect(Math.abs(w)).toBeLessThanOrEqual(.02);break;}}
  v+=.6*(cmd.vMps-v);w+=.15*(.52*cmd.omegaRadps-w);x+=v*Math.cos(yaw)*.02;y+=v*Math.sin(yaw)*.02;yaw+=w*.02;turn=Math.abs(cmd.vMps)<.01?turn+Math.abs(w)*.02:0;
  if(!shifted&&turn>2&&Math.hypot(x-target[0],y-target[1])<.25){x+=.007841692584956761;y-=.004225625404484568;shifted=true;}
 }
 expect(arrived).toBe(true);expect(negative).toBeGreaterThan(20);expect(shifted).toBe(true);
});
test('world reverse terminal motion refuses rear invalid, stale, missing coverage and actual rear obstacles with asymmetric body footprint',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));const target:[number,number,number]=[2,2,0];
 for(const fault of ['invalid','stale','future','partial','missing','obstacle'] as const){const c=createNavigationController(scene.navigation,reverseOptions);c.setGoal({robotId:'amr-1',commandId:fault,target});const scan=rearScan(1);if(fault==='invalid')scan.states[0]='invalid';if(fault==='stale')scan.tick=-10;if(fault==='future')scan.tick=2;if(fault==='partial'){scan.states=scan.states.slice(90,270);scan.rangesM=scan.rangesM.slice(90,270);scan.angleMinRad=-Math.PI/2;}if(fault==='obstacle'){scan.states[0]='hit';scan.rangesM[0]=.62;}
  const r=c.advance({tick:1,robots:[{robotId:'amr-1',poseDriveMap:[2.2,2,0],bodyVelocity:[0,0],scans:fault==='missing'?[]:[scan]}]} as never,{});expect(r.velocities[0]!.vMps).toBe(0);expect(r.decisions[0]!.reason).toBe(fault==='stale'||fault==='missing'?'SENSOR_STALE':fault==='obstacle'?'DYNAMIC_OBSTACLE':'SENSOR_INVALID');
 }
});

test('world reverse rear hold reaches bounded no-progress without arrival or a new command',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));scene.navigation.policy.parameters.noProgressTicks=5;const c=createNavigationController(scene.navigation,reverseOptions);c.setGoal({robotId:'amr-1',commandId:'rear-blocked',target:[2,2,0]});let terminal=false;
 for(let tick=1;tick<=8;tick++){const scan=rearScan(tick);scan.states[0]='hit';scan.rangesM[0]=.62;const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[2.2,2,0],bodyVelocity:[0,0],scans:[scan]}]} as never,{});expect(r.velocities[0]!.vMps).toBe(0);expect(r.decisions.some(d=>d.status==='arrived')).toBe(false);const d=r.decisions.find(d=>d.status==='blocked');if(d){expect(d).toMatchObject({commandId:'rear-blocked',reason:'NO_PROGRESS'});terminal=true;break;}}
 expect(terminal).toBe(true);
});

test('world v4 arrival ramps the last sent angular command to zero before reporting the unchanged goal complete',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));const c=createNavigationController(scene.navigation,reverseOptions);c.setGoal({robotId:'amr-1',commandId:'bounded-arrival',target:[2,2,0]});let previous=0,arrived=false;
 // Actual near-stop can coexist with a larger command under native contact/friction; freeze03-derived v4 diagnostic had .213sent/.0116actual at5322.
 for(let tick=1;tick<=40;tick++){const r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[2,2,tick<10?-.1:-.015],bodyVelocity:[0,tick<10?.03:.0116],scans:[rearScan(tick)]}]} as never,{}),w=r.velocities[0]!.omegaRadps;expect(Math.abs(w-previous)).toBeLessThanOrEqual(.0300000001);previous=w;const d=r.decisions.find(d=>d.status==='arrived');if(d){expect(d.commandId).toBe('bounded-arrival');expect(w).toBe(0);expect(tick).toBeGreaterThan(14);arrived=true;break;}}
 expect(arrived).toBe(true);
});

test('world v4 terminal braking rechecks the actual window, keeps sensor/deadline guards and arrives once',async()=>{
 const {scene}=await readWorldFixture(resolve('robotics/simulation-mujoco'));const c=createNavigationController(scene.navigation,reverseOptions);c.setGoal({robotId:'amr-1',commandId:'window-recheck',target:[2,2,0]});let arrivals=0,previous=0,left=false;
 for(let tick=1;tick<=55;tick++){const yaw=tick<10?-.1:tick===15?-.04:-.015,r=c.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[2,2,yaw],bodyVelocity:[0,tick<10?.03:.0116],scans:[rearScan(tick)]}]} as never,{});if(tick===15){expect(r.decisions.some(d=>d.status==='arrived')).toBe(false);expect(r.velocities[0]!.omegaRadps).toBeGreaterThan(previous);left=true;}arrivals+=r.decisions.filter(d=>d.status==='arrived').length;previous=r.velocities[0]!.omegaRadps;}
 expect(left).toBe(true);expect(arrivals).toBe(1);
 for(const guard of ['sensor','deadline','no-progress'] as const){const copy=structuredClone(scene.navigation);if(guard==='deadline')copy.policy.parameters.goalDeadlineTicks=3;if(guard==='no-progress')copy.policy.parameters.noProgressTicks=3;const p=createNavigationController(copy,reverseOptions);p.setGoal({robotId:'amr-1',commandId:guard,target:[2,2,0]});const reasons:string[]=[];
  for(let tick=1;tick<=8;tick++){const r=p.advance({tick,robots:[{robotId:'amr-1',poseDriveMap:[2,2,-.015],bodyVelocity:[0,.0116],scans:guard==='sensor'?[]:[rearScan(tick)]}]} as never,{});expect(r.decisions.some(d=>d.status==='arrived')).toBe(false);reasons.push(...r.decisions.flatMap(d=>d.reason?[d.reason]:[]));}
  expect(reasons).toContain(guard==='sensor'?'SENSOR_STALE':guard==='deadline'?'GOAL_DEADLINE':'NO_PROGRESS');
 }
});
