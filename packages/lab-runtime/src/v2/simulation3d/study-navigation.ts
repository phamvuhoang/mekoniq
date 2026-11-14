/** Only byte-bound durable drive poses support geometric study statements; lossy display telemetry is never the authority. */
import {gunzipSync} from 'node:zlib';
import type {TrajectoryRecord} from '../navigation2d/evidence';
import type {verifiedSimulationInput} from './simulation-input';
export function studyTrajectory(v:ReturnType<typeof verifiedSimulationInput>):TrajectoryRecord[]{
 const n=v.report.navigation2d!,rows:TrajectoryRecord[]=[];let total=0;
 if(n.completeness?.status!=='complete'||n.recording?.terminal||n.recording?.gaps.length||n.recording?.lastTick!==v.report.outcome.tick||n.recording.runTick!==v.report.outcome.tick||n.recordingGaps.length)throw Error('NAVIGATION_COVERAGE_INCOMPLETE');
 for(const ref of n.artifacts.trajectory){
  const actual=v.refs.get('evidence/'+ref.path),raw=v.documents.get('evidence/'+ref.path);
  if(!actual||actual.sha256!==ref.sha256||actual.bytes!==ref.bytes||!Buffer.isBuffer(raw))throw Error('TRAJECTORY_ARTIFACT_MISSING');
  const bytes=gunzipSync(raw,{maxOutputLength:64*1024*1024});total+=bytes.length;if(total>400*1024*1024)throw Error('TRAJECTORY_LIMIT');
  const lines=bytes.toString().trimEnd().split('\n');if(lines.length>65536||lines.some(l=>Buffer.byteLength(l)>256*1024))throw Error('TRAJECTORY_LIMIT');
  const parsed=lines.map(l=>JSON.parse(l) as TrajectoryRecord);
  if(parsed[0]?.tick!==ref.firstTick||parsed.at(-1)?.tick!==ref.lastTick)throw Error('TRAJECTORY_REF_WINDOW');rows.push(...parsed);
 }
 if(rows.length!==v.report.outcome.tick+1||rows.length>30001)throw Error('TRAJECTORY_WINDOW');
 for(let tick=0;tick<rows.length;tick++){
  const r=rows[tick]!;if(r.tick!==tick||r.simTimeNs!==String(BigInt(tick)*20000000n)||r.robots.length!==v.scene.robots.length)throw Error('TRAJECTORY_CLOCK_OR_IDENTITY');
  for(const robot of r.robots)if(!v.scene.robots.some(x=>x.robotId===robot.robotId)||robot.poseDriveMap.length!==3||!robot.poseDriveMap.every(Number.isFinite)||robot.bodyVelocity.length!==2||!robot.bodyVelocity.every(Number.isFinite)||!Array.isArray(robot.collisionIds))throw Error('TRAJECTORY_SHAPE');
 }
 return rows;
}
