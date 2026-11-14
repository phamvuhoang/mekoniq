import type {PhysicsTickRecord,LoadObservation} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
export const pose=(x=0,y=0)=>({positionM:[x,y,0],quaternionXyzw:[0,0,0,1]});
export const load=(x=0):LoadObservation=>({propId:'cup',poseMap:pose(x),linearVelocityMapMps:[0,0,0],angularVelocityMapRadps:[0,0,0],supportId:'tray',poseInSupport:pose(x)});
export const tick=(n=0):PhysicsTickRecord=>({schemaVersion:1,tick:n,simTimeNs:String(n*20_000_000),contacts:[{a:'floor',b:'robot/base',samples:10,peakNormalN:10,normalImpulseNs:.2,netImpulseMapNs:[0,0,.2],pointAtPeakMapM:[0,0,0],expected:true}],loads:[load()],wheels:[{robotId:'robot',angleRad:[0,0],velocityRadS:[0,0],torqueNm:[0,0],targetRadS:[0,0],saturatedSubsteps:0}],odometry:[{robotId:'robot',poseDriveMap:[1,0,0]}],base:[{robotId:'robot',poseMap:pose(),rollRad:0,pitchRad:0}]});
export const admission={robotId:'robot',props:[{propId:'cup',supportId:'tray'}],contactIds:['floor','robot/base','prop/cup'],tickMs:20,substeps:10,driveFrameInBase:{xyzM:[1,0,0],quaternionXyzw:[0,0,0,1]}};
export const identity={runId:'run',bootId:'boot',sceneDigest:'a'.repeat(64),loadProfileDigest:'b'.repeat(64),physicsProfileDigest:'c'.repeat(64)};
export const assumptions=[{kind:'assumed' as const,documentId:'test',revision:'1',locator:'fixture',contentSha256:'d'.repeat(64)}];
