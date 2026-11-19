// A protocol double of the neutral drive (R4-A §5.1): the same state machine and watchdog as the specification, ideal kinematics, no engine.
// It is NOT a plant: no inertia, no torque (reported null, never a made-up 0), no feedback delay, no following-error trips. Evidence made with it is `protocol_double`.
import type {ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveFault,DriveModelV1,DriveState} from './drive-io';
const TICK_S=0.02,SUBSTEPS=10;
interface Axis {state:DriveState;fault:DriveFault|null;seq:number;resetPrev:boolean;quiet:number;enableSubsteps:number;quickStopSubsteps:number;position:number;velocity:number;applied:number}
export interface MockDrive {
 readonly identity:{testLevel:'protocol_double';driveModelDigest:string;controlProfileDigest:string};
 /** One logical tick. Refuses (throws a coded Error) before changing any state when the commands are not admissible. */
 step(commands:readonly DriveCommandV1[]):DriveAxisSnapshot[];
}
const refuse=(code:string,detail:string):never=>{throw new Error(`${code}: ${detail}`);};

export function createMockDrive(model:DriveModelV1,control:ControlProfileV1):MockDrive{
 const ids=model.axes.map(a=>a.axisId);
 if(control.axes.length!==ids.length||control.axes.some(a=>!ids.includes(a.axisId)))refuse('AXIS_SET_MISMATCH','control profile axes differ from the drive model');
 const spec=new Map(model.axes.map(a=>[a.axisId,a]));
 const axes=new Map<string,Axis>(ids.map(id=>[id,{state:'disabled',fault:null,seq:0,resetPrev:false,quiet:0,enableSubsteps:0,quickStopSubsteps:0,position:0,velocity:0,applied:0}]));
 let tick=0;
 return {
  identity:{testLevel:'protocol_double',driveModelDigest:model.digest,controlProfileDigest:control.digest},
  step(commands){
   const by=new Map<string,DriveCommandV1>();
   for(const c of commands){
    const a=spec.get(c.axisId);
    if(!a)refuse('DRIVE_AXIS_UNKNOWN',c.axisId);
    if(by.has(c.axisId))refuse('DRIVE_COMMAND_SEQ_INVALID',`two commands for ${c.axisId}`);
    if(c.mode!==a!.mode)refuse('DRIVE_MODE_MISMATCH',c.axisId);
    if(!Number.isFinite(c.target)||(a!.mode==='csv'&&Math.abs(c.target)>a!.velocityLimitRadS))refuse('DRIVE_TARGET_OUT_OF_RANGE',c.axisId);
    if(c.seq<axes.get(c.axisId)!.seq)refuse('DRIVE_COMMAND_SEQ_INVALID',`${c.axisId} seq went backwards`);
    by.set(c.axisId,c);
   }
   for(const id of ids)if(!by.has(id))refuse('DRIVE_COMMAND_REQUIRED',id);
   const out:DriveAxisSnapshot[]=[];
   for(const id of ids){
    const a=spec.get(id)!,s=axes.get(id)!,c=by.get(id)!;
    const fresh=c.seq>s.seq;
    s.seq=c.seq;
    const edge=c.faultReset&&!s.resetPrev;
    s.resetPrev=c.faultReset;
    if(s.state==='fault'){
     if(edge&&fresh){s.state='disabled';s.fault=null;s.quiet=0;}  // the cause (silence) is over only when a new command has arrived
    }else if(s.state==='quick_stop'){
     s.quickStopSubsteps+=SUBSTEPS;
     if(s.quickStopSubsteps>=a.quickStopSubsteps)s.state='disabled';
    }else if(c.quickStop&&s.state==='enabled'){
     s.state='quick_stop';s.quickStopSubsteps=SUBSTEPS;
     if(s.quickStopSubsteps>=a.quickStopSubsteps)s.state='disabled';
    }else if(!c.enable||c.quickStop){
     s.state='disabled';
    }else{
     if(s.state==='disabled'){s.state='ready';s.enableSubsteps=0;}
     if(s.state==='ready'){s.enableSubsteps+=SUBSTEPS;if(s.enableSubsteps>=a.enableDelaySubsteps)s.state='enabled';}
    }
    if(s.state==='enabled'&&a.watchdogTicks!==null){
     s.quiet=fresh?0:s.quiet+1;
     if(s.quiet>=a.watchdogTicks){s.state='fault';s.fault='COMMAND_TIMEOUT';}
    }else if(s.state!=='enabled')s.quiet=0;
    if(s.state==='enabled'){  // a command is applied only to an axis that is enabled once this tick's transitions are done; any other is acknowledged (commandSeq) and dropped
     const before=s.position;
     if(a.mode==='csp'){const step=a.velocityLimitRadS*TICK_S;s.position+=Math.max(-step,Math.min(step,c.target-s.position));s.applied=c.target;}
     else{s.applied=c.target;s.position+=c.target*TICK_S;}
     s.velocity=(s.position-before)/TICK_S;
    }else s.velocity=0;
    const q=a.encoder.countsPerRev===null?null:2*Math.PI/a.encoder.countsPerRev;
    out.push({axisId:id,state:s.state,fault:s.fault,commandSeq:s.seq,positionRad:q===null?s.position:Math.round(s.position/q)*q,velocityRadS:s.velocity,torqueNm:null,tick,
     targetApplied:s.applied,actualPositionRad:s.position,actualVelocityRadS:s.velocity,saturatedSubsteps:0,followingErrorRad:a.mode==='csp'&&a.followingError?s.applied-s.position:null});
   }
   tick+=1;
   return out;
  }};
}
