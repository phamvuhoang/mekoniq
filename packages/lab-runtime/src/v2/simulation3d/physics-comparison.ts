import {verifiedStudyPhysics} from './study-physics';
import {PAYLOAD_SPEED_DIFFERENCES} from './payload-experiments';
import {hashJson} from '../hash';
import {verifiedSimulationInput,type SimulationRunInput} from './simulation-input';
import {verifiedPhysicsInputs,changedLeaves} from './physics-inputs';
/** Descriptive deltas in the producer's verified report window; never an engine-accuracy or performance ranking. */
export function comparePhysicsRuns(a:SimulationRunInput,b:SimulationRunInput){
 const reasons:string[]=[],deltas:{id:string;unit:string;a:number|null;b:number|null;delta:number|null;reasons:string[];samplesA:number;samplesB:number}[]=[],inputs:string[]=[];
 let window:{kind:string;a:{firstTick:number;lastTick:number};b:{firstTick:number;lastTick:number}}|null=null;
 try{
  const va=verifiedSimulationInput(a),vb=verifiedSimulationInput(b),pa=verifiedPhysicsInputs(va),pb=verifiedPhysicsInputs(vb);
  const same=(x:unknown,y:unknown,code:string)=>{if(hashJson(x??null)!==hashJson(y??null))reasons.push(code);};
  const {mujocoExperimentId:_a,...projectA}=pa.project,{mujocoExperimentId:_b,...projectB}=pb.project;void _a;void _b;
  same(projectA,projectB,'UNCHANGED_INPUTS_DIFFER');same(pa.resolved,pb.resolved,'MECHANICS_DIFFER');
  for(const p of ['assets.json','recipes.json','bom.json','assumptions.json','cell-layout.json','canonical-physical-model.json'])same(va.get(p),vb.get(p),'UNCHANGED_INPUTS_DIFFER');
  const changes=['load','physics','maxLinearMps','maxAngularRadps'].filter(k=>pa.experiment[k as keyof typeof pa.experiment]!==pb.experiment[k as keyof typeof pb.experiment]);
  const dimensions=new Set(changes.map(k=>k.startsWith('max')?'speed':k));if(dimensions.size>1)reasons.push('MULTIPLE_EXPERIMENT_DIMENSIONS');
  const ma=va.report.manifest,mb=vb.report.manifest,na=va.report.navigation2d!,nb=vb.report.navigation2d!;
  const engine=(n:typeof na)=>{const e={...n.engine} as Record<string,unknown>;delete e.loadProfileRef;delete e.physicsProfileRef;return e;};
  same(engine(na),engine(nb),'ENGINE_DIFFERS');same(na.controller,nb.controller,'CONTROLLER_DIFFERS');same(na.identity,nb.identity,'PRODUCER_DIFFERS');
  for(const k of ['sourceCommit','clock','seed','scenario','simulationPerturbation','completionObservation','world','assets','prng'] as const)same(ma[k],mb[k],`${k.toUpperCase()}_DIFFERS`);
  same(va.report.outcome.status,vb.report.outcome.status,'WINDOW_DIFFERS');
  if(!['completed','cancelled'].includes(va.report.outcome.status))reasons.push('WINDOW_INCOMPLETE');
  if(va.report.outcome.status==='cancelled')same(va.report.businessEvents.filter(e=>e.type==='MissionCancellationRequested').map(e=>e.at),vb.report.businessEvents.filter(e=>e.type==='MissionCancellationRequested').map(e=>e.at),'CANCEL_SCHEDULE_DIFFERS');
  window={kind:va.report.outcome.status==='completed'?'completed-fd01':'registered-cancel',a:{firstTick:1,lastTick:va.report.outcome.tick},b:{firstTick:1,lastTick:vb.report.outcome.tick}};
  for(const [p,doc]of va.documents)if(!p.startsWith('evidence/')&&!p.startsWith('physics/'))inputs.push(...changedLeaves(doc,vb.documents.get(p),p));
  const metricsA=verifiedStudyPhysics(va,pa),metricsB=verifiedStudyPhysics(vb,pb);
  for(const id of Object.keys(metricsA) as (keyof typeof metricsA)[]){const x=metricsA[id],y=metricsB[id];if(!y){reasons.push('METRIC_POLICY_DIFFERS');continue;}const available=x.available&&y.available&&x.unit===y.unit&&Number.isFinite(x.value)&&Number.isFinite(y.value);deltas.push({id,unit:x.unit,a:x.value,b:y.value,delta:available&&!reasons.length?y.value!-x.value!:null,reasons:[...!x.available?[x.reason]:[],...!y.available?[y.reason]:[],...x.unit!==y.unit?['UNIT_DIFFERS']:[]],samplesA:x.available?x.samples:0,samplesB:y.available?y.samples:0});}
 }catch(e){reasons.push('EVIDENCE_INVALID',e instanceof Error?e.message:'INVALID_INPUT');}
 if(reasons.length)for(const d of deltas)d.delta=null;
 return {registeredDifferences:PAYLOAD_SPEED_DIFFERENCES,comparable:!reasons.length,reasons:[...new Set(reasons)],window,population:{runsA:1,runsB:1},inputs:[...new Set(inputs)].sort(),deltas,percentiles:null,note:'One run per side; no p50/p95 or performance ranking. not_calibrated. Stop distance begins at the first actual zero plant target, after the command ramp; it excludes reaction and ramp-down distance. Low sliding input 0.3 is masked by floor 0.8/cup 0.6 maximum contact mixing; no lower effective floor friction is established.'};
}
