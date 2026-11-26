// Sensor cases (KSN, contracts §6.2), first part (K06): KSN01, KSN03, KSN04, KSN05. KSN02, KSN06 and KSN07 ask the operator and come with the prompt io.
// Sensor cases never ask for torque: every tick sends enable:false. The stream is the sensors worker's (stepped by runCase in the same tick); durations are the policy's
// (soakMinutes), thresholds too (badFrameFractionMax). evaluate() is a pure function of (trace, kit, policy): the evidence reader re-runs it on stored traces.
import type {LidarScanV1} from '../../../contracts/generated/navigation2d';
import {hashJson} from '../../../lab-runtime/src/v2/hash';
import {validateLidarScan,type BenchKitV1,type BenchPolicy,type Measurement} from '../contracts';
import type {BenchCase,CaseScript,CaseTrace,CaseVerdict,ImuRow,LidarFrameRow,LidarScanRow} from './types';

const TICK_MS=20,CELLS=360,LD19_FRAME_LEN=47,WIT_FRAME_LEN=11,FRAMES_PER_IMU_SAMPLE=3,SCAN_CHECK_TICKS=250;   // KSN03 needs a few turns, not the soak
/** assumed (the LD19 manual text gives no range; the research notes give 12 m and, for the STL-19P, 0.03 m): KSN02 measures them. */
export const LIDAR_RANGE_M={rangeMinM:0.03,rangeMaxM:12} as const;
const GYRO_LSB_RAD_S=Math.PI/180*2000/32768,ANGLE_LSB_RAD=Math.PI/180*180/32768;   // one count of the int16 scales: the floor of every uncertainty below
export interface Ld19Frame{speedDegS:number;startDeg:number;endDeg:number;sensorMs:number;points:readonly (readonly [number,number])[]}

/** One turn of LD19 frames on 360 cells of one degree (cell i is centred on i degrees, clockwise from the sensor's front as the sensor counts: the sensor is left-handed, the
 * axis convention of the scan is settled by KSN07). A point under rangeMinM is below_min, over rangeMaxM no_return, otherwise a hit; of several points in one cell a hit beats
 * below_min beats no_return and the nearest hit wins. */
export function toLidarScan(frames:readonly Ld19Frame[],o:{sensorId:string;frameId:string;tick:number;tMonoNs:bigint;rangeMinM:number;rangeMaxM:number}):LidarScanV1{
 const rangesM:(number|null)[]=Array(CELLS).fill(null),states:LidarScanV1['states']=Array(CELLS).fill('no_return'),rank={no_return:0,below_min:1,invalid:1,hit:2};
 for(const f of frames){
  const n=f.points.length,step=n>1?((((f.endDeg-f.startDeg)%360)+360)%360)/(n-1):0;   // the manual's interpolation; end < start means the frame crosses 360
  f.points.forEach(([mm],j)=>{
   const cell=Math.round((f.startDeg+step*j)%360)%CELLS,m=mm/1000,s=m<o.rangeMinM?'below_min':m>o.rangeMaxM?'no_return':'hit';
   if(rank[s]>rank[states[cell]!]||s==='hit'&&states[cell]==='hit'&&m<rangesM[cell]!){states[cell]=s;rangesM[cell]=s==='hit'?m:null;}
  });
 }
 return {sensorId:o.sensorId,frameId:o.frameId,tick:o.tick,simTimeNs:o.tMonoNs.toString(),angleMinRad:0,angleIncrementRad:2*Math.PI/CELLS,rangeMinM:o.rangeMinM,rangeMaxM:o.rangeMaxM,rangesM,states};
}
const isScan=(x:LidarFrameRow|LidarScanRow):x is LidarScanRow=>'scan' in x;
const framesOf=(t:CaseTrace)=>(t.lidar??[]).filter((x):x is LidarFrameRow=>!isScan(x));
/** The scans of a run: a turn ends where the first angle goes down. The frames after the last such drop are an unfinished turn and give no scan. Bench scans, named as such. */
export function scanRows(frames:readonly LidarFrameRow[]):LidarScanRow[]{
 const out:LidarScanRow[]=[];let turn:LidarFrameRow[]=[];
 const flush=()=>{const last=turn.at(-1)!;out.push({tick:last.tick,tMonoNs:last.tMonoNs,scan:toLidarScan(turn,{sensorId:'bench/ld19',frameId:'bench/lidar-clockwise',tick:last.tick,tMonoNs:BigInt(last.tMonoNs),...LIDAR_RANGE_M})});turn=[];};
 for(const f of frames){if(turn.length&&f.startDeg<turn.at(-1)!.startDeg)flush();turn.push(f);}
 return out;
}

const tested=(measurements:Measurement[]):CaseVerdict=>({status:'tested',reason:null,measurements});
const failed=(reason:string):CaseVerdict=>({status:'failed',reason,measurements:[]});
const m=(caseId:string,id:string,value:number,unit:string,uncertaintyAbs:number,n=1):Measurement=>({id,value,unit,uncertaintyAbs,caseId,n});
export const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
export const std=(x:number[])=>{const u=mean(x);return Math.sqrt(x.reduce((a,b)=>a+(b-u)**2,0)/(x.length-1));};
export const median=(x:number[])=>{const s=[...x].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]!:(s[s.length/2-1]!+s[s.length/2]!)/2;};
const soakTicks=(p:BenchPolicy)=>Math.round(p.soakMinutes*60*1000/TICK_MS);
/** Frames the decoder dropped (bytes / frame length) over those dropped plus those it gave; a frame is counted by its bytes, so this is the fraction of the stream lost. */
const lostFraction=(droppedBytes:number,frameLen:number,good:number)=>{const lost=droppedBytes/frameLen;return lost/(lost+good);};
const badFrames=(bad:number,max:number)=>bad>max?failed(`BAD_FRAME_FRACTION ${bad.toFixed(4)} > ${max}`):undefined;

const sensorCase=(id:string,o:Pick<BenchCase,'evaluate'>&{ticks?:(p:BenchPolicy)=>number}):BenchCase=>({id,needsTorque:false,requires:[],needsSensors:true,evaluate:o.evaluate,
 script:(kit:BenchKitV1,p:BenchPolicy):CaseScript=>({ticks:o.ticks?.(p)??soakTicks(p),
  commandsAt:k=>kit.axes.map(a=>({axisId:a.axisId,seq:k+1,mode:'csv' as const,target:0,enable:false,quickStop:false,faultReset:false}))})});

const KSN01=sensorCase('KSN01',{evaluate(t,_k,p){
 const f=framesOf(t);
 if(f.length<2)return failed('NO_LIDAR_FRAMES');
 const bad=lostFraction(t.sensorDropped?.lidarBytes??0,LD19_FRAME_LEN,f.length),over=badFrames(bad,p.badFrameFractionMax);
 if(over)return over;
 // points per turn = 360 degrees over the angular spacing of the points (median over frames: robust to a lost frame and to the seam of a looped replay)
 const spacing=median(f.map(x=>((((x.endDeg-x.startDeg)%360)+360)%360)/(x.points.length-1))),perScan=360/spacing,t0=f[0]!.tMonoNs,span=(f.at(-1)!.tMonoNs-t0)/1e9;
 const after=f.filter(x=>x.tMonoNs>t0).length*f[0]!.points.length;   // the first tick's frames are the ones that arrived before the clock started
 if(!(span>0)||after===0)return failed('LIDAR_SPAN_TOO_SHORT');
 const rate=after/span/perScan;
 return tested([m('KSN01','scanRateHz',rate,'Hz',rate/(after/f[0]!.points.length),f.length),
  m('KSN01','pointsPerScan',perScan,'point',360/spacing**2*0.0142/(f[0]!.points.length-1),f.length),m('KSN01','badFrameFraction',bad,'ratio',0,f.length)]);
}});

const KSN03=sensorCase('KSN03',{ticks:p=>Math.min(soakTicks(p),SCAN_CHECK_TICKS),evaluate(t){
 const f=framesOf(t),stored=(t.lidar??[]).filter(isScan);
 if(!f.length)return failed('NO_LIDAR_FRAMES');
 if(!stored.length)return failed('NO_SCANS');
 const bad=stored.flatMap(r=>validateLidarScan(r.scan))[0];
 if(bad)return failed(`SCAN_INVALID ${bad.path} ${bad.detail}`);
 if(hashJson(stored)!==hashJson(scanRows(f)))return failed('SCAN_NOT_FROM_FRAMES');
 return tested([m('KSN03','scansValid',stored.length,'scan',0,stored.length)]);
}});

/** Slope of y against x by least squares and its standard error. */
function slope(x:number[],y:number[]){
 const mx=mean(x),my=mean(y),sxx=x.reduce((a,b)=>a+(b-mx)**2,0),b=x.reduce((a,xi,i)=>a+(xi-mx)*(y[i]!-my),0)/sxx;
 const rss=x.reduce((a,xi,i)=>a+(y[i]!-my-b*(xi-mx))**2,0);
 return {b,se:Math.sqrt(rss/(x.length-2)/sxx)};
}
const unwrap=(a:number[])=>{let k=0;return a.map((v,i)=>{if(i&&v-a[i-1]!>Math.PI)k--;else if(i&&a[i-1]!-v>Math.PI)k++;return v+2*Math.PI*k;});};
const imuOf=(t:CaseTrace)=>t.imu??[];

const KSN04=sensorCase('KSN04',{evaluate(t){
 const s:ImuRow[]=imuOf(t),n=s.length;
 if(n<3)return failed('NO_IMU_SAMPLES');
 const axes=['X','Y','Z'],ms:Measurement[]=[],gyro=[0,1,2].map(i=>s.map(r=>r.gyroRadS[i]!));
 gyro.forEach((g,i)=>ms.push(m('KSN04',`gyroBias${axes[i]}RadS`,mean(g),'rad/s',Math.max(std(g)/Math.sqrt(n),GYRO_LSB_RAD_S),n)));
 gyro.forEach((g,i)=>ms.push(m('KSN04',`gyroNoise${axes[i]}RadS`,std(g),'rad/s',Math.max(std(g)/Math.sqrt(2*(n-1)),GYRO_LSB_RAD_S),n)));
 const x=s.map(r=>r.tMonoNs/1e9),{b,se}=slope(x,unwrap(s.map(r=>r.rpyRad[2]!))),span=x.at(-1)!-x[0]!;
 if(!(span>0))return failed('IMU_SPAN_TOO_SHORT');
 ms.push(m('KSN04','yawDriftRadS',b,'rad/s',Math.max(se,ANGLE_LSB_RAD/span),n));
 return tested(ms);
}});

const KSN05=sensorCase('KSN05',{evaluate(t,_k,p){
 const s=imuOf(t);
 if(s.length<3)return failed('NO_IMU_SAMPLES');
 // ponytail: three frames (0x51, 0x52, 0x53) per sample; the time packet is not decoded, so the sensor's own timestamps are not measured: the jitter below is the host's, second by second
 const bad=lostFraction(t.sensorDropped?.imuBytes??0,WIT_FRAME_LEN,s.length*FRAMES_PER_IMU_SAMPLE),over=badFrames(bad,p.badFrameFractionMax);
 if(over)return over;
 const t0=s[0]!.tMonoNs,span=(s.at(-1)!.tMonoNs-t0)/1e9,after=s.filter(x=>x.tMonoNs>t0).length,seconds=Math.floor(span);
 if(!(span>0)||seconds<2)return failed('IMU_SPAN_TOO_SHORT');
 const perSecond=Array(seconds).fill(0) as number[];
 for(const r of s){const k=Math.floor((r.tMonoNs-t0)/1e9);if(k<seconds)perSecond[k]!++;}
 return tested([m('KSN05','imuSampleRateHz',after/span,'Hz',after/span/after,s.length),m('KSN05','imuRateJitterHz',std(perSecond),'Hz',1,seconds),m('KSN05','imuBadFrameFraction',bad,'ratio',0,s.length)]);
}});

/** KSN02, KSN06 and KSN07 are not here: they need operator prompts. */
export const SENSOR_CASES:BenchCase[]=[KSN01,KSN03,KSN04,KSN05];
