/** Frozen B05 direct-rig choreography replayed through the real worker protocol.
 * Event IDs explicitly identify rig provenance; this is not business custody. */
import type {WorldTickCommand} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
export async function runWorldRig(waypoints:Record<string,number[]>,initial:Sim3DSnapshotV1,step:(command:WorldTickCommand)=>Promise<Sim3DSnapshotV1>,offset:[number,number]=[0,0]){
 let q=[...waypoints.home!],grip=0,v=0,s=initial,tick=0,lastCup:number[]|undefined,maxJump=0,unexpected=0,window=0,longest=0,gripped=false,dockWindow=0;
 const next=async(birth=false)=>{s=await step({targetTick:++tick,velocities:[{robotId:'amr-1',vMps:v,omegaRadps:0}],actorUpdates:[],jointTargets:[{armId:'arm-1',positionsRad:[...q]}],gripperTargets:[{armId:'arm-1',openingM:.0889*(1-grip/.85)}],propPlacements:birth?[{propId:'cup-1',pose:{position:[.49+offset[0],offset[1],.151],quaternionXyzw:[0,0,0,1]}}]:[],...birth?{worldInteractions:[{eventId:'rig:birth:cup-1',cupId:'cup-1',propId:'cup-1',kind:'birth',targetTick:tick}]}:{}});
  if(s.worldStep!.workerPid!==initial.worldStep!.workerPid||s.worldStep!.physicsSubsteps!==(tick+1)*10||s.bootId!==initial.bootId)throw Error('RIG_NATIVE_CLOCK_IDENTITY');
  if(tick>=91&&tick<=100){const r=s.robots[0]!,p=r.poseDriveMap;dockWindow+=Math.hypot(p[0]!-.35,p[1]!-.48591366218667575)<=.01&&Math.abs(Math.atan2(Math.sin(p[2]!-Math.PI/2),Math.cos(p[2]!-Math.PI/2)))<=.02&&Math.abs(r.bodyVelocity[0]!)<=.01&&Math.abs(r.bodyVelocity[1]!)<=.02?1:0;}
  const p=s.props?.[0];if(p&&lastCup)maxJump=Math.max(maxJump,Math.hypot(...p.position.map((x,i)=>x-lastCup![i]!)));if(p)lastCup=p.position;
  unexpected+=s.physics!.contacts.filter(c=>(c.a.startsWith('amr-1/')&&c.b.startsWith('arm-1/'))||(c.b.startsWith('amr-1/')&&c.a.startsWith('arm-1/'))).length;
  return s;
 };
 const hold=async(n:number)=>{for(let i=0;i<n;i++)await next();};
 const move=async(name:string)=>{const start=[...q],target=waypoints[name]!;for(let i=1;i<=150;i++){const t=i/150,u=10*t**3-15*t**4+6*t**5;q=start.map((x,j)=>x+(target[j]!-x)*u);await next();}await hold(25);};
 await hold(100);await next(true);await hold(50);await move('pickApproach');await move('pick');
 for(let i=0;i<22;i++){grip=Math.min(.85,.04*(i+1));await next();}await hold(100);gripped=s.arms![0]!.gripper!.heldPropIds.includes('cup-1');
 await move('lift');const lifted=s.props![0]!.position[2]!>.25;await move('high');await move('placeApproach');await move('place');
 for(let i=0;i<22;i++){grip=Math.max(0,.85-.04*(i+1));await next();}
 for(let i=0;i<150;i++){await next();const p=s.props![0]!,l=s.physics!.loads[0]!,at=l.poseInSupport!.positionM;const valid=p.restingOn==='amr-1/tray-1'&&!s.arms![0]!.gripper!.heldPropIds.includes('cup-1')&&Math.abs(at[0]!)<.155&&Math.abs(at[1]!)<.185;window=valid?window+1:0;longest=Math.max(longest,window);}
 await move('placeApproach');await move('high');await move('home');const start=[...s.robots[0]!.poseDriveMap];
 for(let i=0;i<700;i++){v=Math.min(.15,(i+1)*.002);await next();if(Math.hypot(s.robots[0]!.poseDriveMap[0]!-start[0]!,s.robots[0]!.poseDriveMap[1]!-start[1]!)>=1)break;}
 v=0;await hold(100);const distance=Math.hypot(s.robots[0]!.poseDriveMap[0]!-start[0]!,s.robots[0]!.poseDriveMap[1]!-start[1]!);
 const final=s.physics!.loads[0]!.poseInSupport!.positionM,retained=Math.abs(final[0]!)<.155&&Math.abs(final[1]!)<.185&&final[2]!>.03&&final[2]!<.07;
 return {dockWindowTicks:dockWindow,retained,accepted:false,scope:'real worker rig; no Source business custody',offsetM:offset,logicalSteps:tick,primingSubsteps:s.worldStep!.primingSubsteps,totalPhysicsSubsteps:s.worldStep!.physicsSubsteps,workerCount:1,modelCount:s.worldStep!.modelCount,workerPid:s.worldStep!.workerPid,nativeModel:{nq:s.worldStep!.nq,nv:s.worldStep!.nv,nbody:s.worldStep!.nbody,ngeom:s.worldStep!.ngeom},gripped,lifted,receiverWindowTicks:longest,maxTickCupTranslationM:maxJump,unexpectedArmMobileContacts:unexpected,transportDistanceM:distance,finalCupInSupportM:s.physics!.loads[0]!.poseInSupport!.positionM,passed:dockWindow===10&&retained&&gripped&&lifted&&longest>=25&&maxJump<=.02&&unexpected===0&&distance>=1};
}
