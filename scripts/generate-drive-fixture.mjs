import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/**
 * Deterministically generate the R4 drive fixtures from committed inputs (physics profiles, the xArm component and the V01 spike output). No engine runs.
 * Every number is `assumed` and `not_calibrated`; the starting values are the ones locked by docs/research/2026-11-virtual-drive-spike.md (section 5).
 */
export async function generateDriveFixture(outDir){
 const {sealDriveDocument}=await tsImport('../packages/lab-runtime/src/v2/control/drive-io.ts',import.meta.url);
 const serve=join(root,'robotics/simulation-mujoco/fixtures/serve-payload-v1'),arm=join(root,'robotics/simulation-mujoco/fixtures/xarm6-g2-v1');
 const bytesOf={servePhysics:await readFile(join(serve,'drive-contact-profile.json')),servePhysical:await readFile(join(serve,'physical-model-amr-1.json')),armPhysics:await readFile(join(arm,'physics.json')),armComponent:await readFile(join(arm,'component.json')),spike:await readFile(join(root,'docs/research/virtual-drive-spike/results.json'))};
 const servePhysics=JSON.parse(bytesOf.servePhysics),physical=JSON.parse(bytesOf.servePhysical),armPhysics=JSON.parse(bytesOf.armPhysics),component=JSON.parse(bytesOf.armComponent);
 const files=new Map(),json=(name,v)=>files.set(name,JSON.stringify(v,null,2)+'\n');
 const src=(documentId,bytes,locator)=>({kind:'assumed',documentId,revision:'1',locator,contentSha256:hash(bytes)});
 const spike=locator=>src('docs/research/virtual-drive-spike/results.json',bytesOf.spike,locator);
 const sources=(over={})=>({torque:src('xarm6-g2-v1/component.json',bytesOf.armComponent,'joint effort limits'),velocity:src('xarm6-g2-v1/component.json',bytesOf.armComponent,'joint velocity limits'),encoder:spike('section 5: countsPerRev starting values'),
  delays:spike('case 4: command delay, queue equals native buffer'),watchdog:spike('section 5: watchdog and enable sequence starting values'),disable:spike('case 3: group-bit switch-off and brake softness'),followingError:spike('section 5: following error starting value'),...over});
 const serveSources=sources({torque:src('serve-payload-v1/drive-contact-profile.json',bytesOf.servePhysics,'driveCurve and brakeTorqueNm'),velocity:src('serve-payload-v1/physical-model-amr-1.json',bytesOf.servePhysical,'drive.actuatorMaxSpeedRadps')});
 // ---- axes ----
 const wheels=[['amr-1/wheel-left'],['amr-1/wheel-right']].map(([axisId])=>({axisId,mode:'csv',velocityLimitRadS:physical.drive.actuatorMaxSpeedRadps.value}));
 const chain=['J1','J2','J3','J4','J5','J6'];
 const effort=id=>component.joints.find(j=>j.id===id).limits.effort.value,speed=id=>component.joints.find(j=>j.id===id).limits.velocity.value;
 // brake torque starting value: 3x the gravity torque at home measured in the V01 spike (case 3), floored at 1 N m, rounded up to 0.01
 const gravity=[0,1.0376634833222989,15.93472168220259,0.1693687703501081,1.7380175163819618,0.021117444163507526];
 const brake=chain.map((_,i)=>Math.max(1,Math.ceil(3*gravity[i]*100)/100));
 const joints=chain.map((id,i)=>({axisId:`xarm-1/${id}`,mode:'csp',torque:{kind:'effort',limitNm:effort(id)},velocityLimitRadS:speed(id),brakeTorqueNm:brake[i]}));
 // the gripper drive joint closes at up to 7.7 rad/s on a cup (measured in the V03 closing test); the 2 rad/s command rate of the R2b program is a rate of command, not a speed limit, and OVERSPEED trips at 1.2x this value
 const gripper={axisId:'xarm-1/gripper',mode:'csp',torque:{kind:'effort',limitNm:armPhysics.gripper.forceRangeNm},velocityLimitRadS:10,brakeTorqueNm:armPhysics.gripper.forceRangeNm};
 const model=(axis,p)=>{
  const csp=axis.mode==='csp',counts=axis.axisId.includes('wheel')?p.wheelCounts:axis.axisId.endsWith('gripper')?p.wheelCounts:p.jointCounts;
  return {axisId:axis.axisId,mode:axis.mode,torque:axis.torque??{kind:'envelope_ref',scale:p.torqueScale},velocityLimitRadS:axis.velocityLimitRadS,encoder:{countsPerRev:counts,velocityWindowSubsteps:counts===null?1:5},
   feedbackDelaySubsteps:p.feedbackDelay,feedbackLossSubsteps:p.feedbackLoss,commandDelaySubsteps:p.commandDelay,commandInterpolation:'hold',watchdogTicks:p.watchdog,enableDelaySubsteps:p.enableDelay,quickStopSubsteps:p.quickStop,
   onDisable:'brake',brakeTorqueNm:axis.brakeTorqueNm??servePhysics.brakeTorqueNm,followingError:csp&&p.followingError&&!axis.axisId.endsWith('gripper')?{limitRad:0.5,substeps:100}:null};  // a gripper closed on a cup is held 0.7 rad short of its target by the cup: it has no following-error monitor
 };
 const ideal={wheelCounts:null,jointCounts:null,torqueScale:1,feedbackDelay:0,feedbackLoss:0,commandDelay:0,watchdog:null,enableDelay:0,quickStop:100,followingError:false};
 const nominal={...ideal,wheelCounts:4096,jointCounts:16384,feedbackDelay:1,feedbackLoss:25,commandDelay:1,watchdog:5,enableDelay:25,followingError:true};
 const variants={ideal,nominal,'torque-limited':{...nominal,torqueScale:0.1}  /* R4-A said x 0.4; the nominal mission's peak wheel torque is 1.63 N m against the 6 N m envelope, so x 0.4 never binds (0 saturated substeps) and x 0.2 binds without changing the speed deficit (0.295 against 0.301 rad/s). x 0.1 = 0.6 N m does: deficit 0.47-0.75 rad/s, tracking events, the mission stops for attention (V05 review, seed 7) */,latency:{...nominal,commandDelay:50},'coarse-encoder':{...nominal,wheelCounts:256,jointCounts:1024}};
 const driveModel=(id,axes,p,s)=>sealDriveDocument({schemaVersion:1,documentType:'drive-model',id,revision:1,digest:'',calibration:'not_calibrated',axes:axes.map(a=>model(a,p)),sources:s});
 const serveModels=Object.entries(variants).map(([k,p])=>driveModel(`serve-drive-${k}-v1`,wheels,p,serveSources));
 const armModels=['ideal','nominal','latency','coarse-encoder'].map(k=>driveModel(`xarm6-drive-${k}-v1`,[...joints,gripper],variants[k],sources({torque:src('xarm6-g2-v1/physics.json',bytesOf.armPhysics,'actuators, gripper.forceRangeNm'),velocity:src('xarm6-g2-v1/component.json',bytesOf.armComponent,'joint velocity limits')})));
 for(const m of [...serveModels,...armModels])json(m.id+'.json',m);
 // ---- control profiles: gains equal the R2b gains (ki = 0, no slew), so the ideal drive reproduces R2b ----
 const wheelLoop={kp:servePhysics.velocityGainNmsPerRad,ki:0,kd:0,integralLimit:null,slewLimit:null};
 const armGain=Object.fromEntries(armPhysics.actuators.map(a=>[a.joint,a]));
 const serveControl=sealDriveDocument({schemaVersion:1,documentType:'control-profile',id:'serve-control-v1',revision:1,digest:'',calibration:'not_calibrated',plantModelDigest:physical.modelDigest,driveModelDigests:serveModels.map(m=>m.digest),
  axes:wheels.map(w=>({axisId:w.axisId,loop:{...wheelLoop},accelerationLimit:null})),controllers:[{controllerId:'diff-drive-base-v1',revision:1,params:{maxAccelerationMps2:1,maxJerkMps3:10}}],
  sources:{loop:src('serve-payload-v1/drive-contact-profile.json',bytesOf.servePhysics,'velocityGainNmsPerRad'),limits:spike('section 5'),controller:spike('section 5')}});
 const armControl=sealDriveDocument({schemaVersion:1,documentType:'control-profile',id:'xarm6-control-v1',revision:1,digest:'',calibration:'not_calibrated',plantModelDigest:hash(bytesOf.armComponent),driveModelDigests:armModels.map(m=>m.digest),
  axes:[...chain.map(id=>({axisId:`xarm-1/${id}`,loop:{kp:armGain[id].kp,ki:0,kd:armGain[id].kv,integralLimit:null,slewLimit:null},accelerationLimit:null})),
   {axisId:'xarm-1/gripper',loop:{kp:armPhysics.gripper.kp,ki:0,kd:armPhysics.gripper.kv,integralLimit:null,slewLimit:null},accelerationLimit:null}],controllers:[{controllerId:'joint-trajectory-follower-v1',revision:1,params:{}}],
  sources:{loop:src('xarm6-g2-v1/physics.json',bytesOf.armPhysics,'actuators[].kp, kv; gripper.kp, kv'),limits:spike('section 5'),controller:spike('section 5')}});
 json('serve-control-v1.json',serveControl);json('xarm6-control-v1.json',armControl);
 // ---- tuning envelope: the server's bounds; kd of a velocity axis and a slew of a velocity axis are pinned to 0 / absent ----
 const bound=(min,max)=>({min,max});
 const envelope=sealDriveDocument({schemaVersion:1,documentType:'tuning-envelope',id:'tuning-envelope-v1',revision:1,digest:'',calibration:'not_calibrated',axes:[
  ...wheels.map(w=>({axisId:w.axisId,kp:bound(0,20),ki:bound(0,64),kd:bound(0,0),integralLimit:bound(0,servePhysics.brakeTorqueNm),slewLimit:bound(0,0),accelerationLimit:bound(0.5,100)})),
  ...chain.map(id=>({axisId:`xarm-1/${id}`,kp:bound(0,2*armGain[id].kp),ki:bound(0,armGain[id].kp),kd:bound(0,2*armGain[id].kv),integralLimit:bound(0,effort(id)),slewLimit:bound(0.1,speed(id)),accelerationLimit:bound(0.5,50)})),
  {axisId:'xarm-1/gripper',kp:bound(0,2*armPhysics.gripper.kp),ki:bound(0,armPhysics.gripper.kp),kd:bound(0,2*armPhysics.gripper.kv),integralLimit:bound(0,armPhysics.gripper.forceRangeNm),slewLimit:bound(0.1,gripper.velocityLimitRadS),accelerationLimit:bound(0.5,50)}],
  source:spike('section 5: starting values, bounds are server policy')});
 json('tuning-envelope-v1.json',envelope);
 // ---- oracle policy: locked here, before any campaign ----
 json('control-oracle-v1.json',sealDriveDocument({schemaVersion:1,documentType:'control-oracle',id:'control-oracle-v1',revision:1,digest:'',calibration:'not_calibrated',metricPolicy:{finalWindowS:0.5,settleBand:0.02,holdWindowS:0.25},
  sustainedOscillation:{windowRatio:0.9,thresholdRad:0.02,thresholdRadS:0.1},minAmplitudeQuanta:10,source:spike('section 5: metric windows are test policy, not safety parameters')}));
 files.set('README.md',`# Drive fixtures v1\n\nGenerate with \`node scripts/generate-drive-fixture.mjs [out-dir]\`. Inputs are the committed Serve physics profile and physical model, the xArm 6 physics and component, and the V01 spike output (docs/research/virtual-drive-spike/results.json).\n\n- \`serve-drive-{ideal,nominal,torque-limited,latency,coarse-encoder}-v1.json\`, \`xarm6-drive-{ideal,nominal}-v1.json\`: DriveModelV1, the device. \`ideal\` has no quantisation, no delay, no watchdog and no enable sequence.\n- \`serve-control-v1.json\`, \`xarm6-control-v1.json\`: ControlProfileV1, the tuning. Gains equal the R2b gains (wheel kp = velocityGainNmsPerRad, joint kp/kd = physics kp/kv, every ki = 0, no slew), so the ideal drive reproduces the R2b path. One profile lists every drive model it is declared for (driveModelDigests): the experiments vary the device, not the tuning. plantModelDigest is the physical model's modelDigest (AMR) or the SHA-256 of the xArm component file.\n- \`tuning-envelope-v1.json\`: the server's bounds per axis. \`integralLimit\` is a force limit in N m (ki * imax in the engine's pid actuator); a velocity axis allows no kd and no slew.\n- \`control-oracle-v1.json\`: metric windows and the sustained-oscillation threshold, locked before any campaign.\n\nEvery value is \`assumed\`, every document \`not_calibrated\`; none is the parameter set of a real driver. Arm brake torque is 3x the gravity torque at home measured in the V01 spike (floored at 1 N m). The gripper's velocityLimitRadS is 10 rad/s, above the 7.7 rad/s its drive joint reaches closing on a cup: it is an OVERSPEED reference (trip at 1.2x), not the 2 rad/s command rate of the R2b program; a world needs one combined drive model and profile, which V05 adds.\n`);
 files.set('NOTICE','drive-v1\nFirst-party fixtures generated from first-party inputs; the xArm numbers come from the xarm6-g2-v1 fixture (see its NOTICE). Nothing here is vendor data, and no value is measured.\n');
 json('manifest.json',{schemaVersion:1,documentType:'drive-fixture-manifest',id:'drive-v1',generator:'scripts/generate-drive-fixture.mjs',calibration:'not_calibrated',files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,sha256:hash(bytes),bytes:Buffer.byteLength(bytes)}))});
 await mkdir(outDir,{recursive:true});for(const [name,bytes] of files)await writeFile(join(outDir,name),bytes);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateDriveFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/drive-v1')));
