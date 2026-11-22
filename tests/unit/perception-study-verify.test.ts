// R4.4 review R06/R07: the study verifier rebuilds what it reports from the run's own evidence (the report and the belief stream); a changed result or a nudge the run never had does not pass, even when the inventory hash is made to agree.
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {verifyPerceptionStudy,PERCEPTION_STUDY_POINTS} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
import {openBeliefRecorder} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
const COMMIT='c'.repeat(40),SCENE='d'.repeat(64);
const profileDigest=async(id:string)=>JSON.parse(await readFile(`robotics/simulation-mujoco/fixtures/perception-v1/${id}.json`,'utf8')).digest as string;
interface Opt {/** no belief sample in the 25 ticks after the commit (a stale profile): the cup can only be seen moving in the run's per-tick props trace */sparse?:boolean;nudgeReport?:boolean;shift?:{dt:number;dx:number}|null;result?:Record<string,unknown>;nudgeInput?:boolean}
const truth=(x:number):[number,number,number]=>[0.49+x,0,0.151];
const belief=(tick:number,x:number)=>({tick,objectId:'cup-1',belief:{objectId:'cup-1',kind:'cup' as const,frameId:'arm-base',positionM:[0.49,0,0.151] as [number,number,number],sigmaM:[0.002,0.002,0] as [number,number,number],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim' as const,valid:true},dropped:false,truthAtObservedTick:truth(x),errorM:x});
async function run(root:string,pointId:string,seed:number,o:Opt={}){
 const p=PERCEPTION_STUDY_POINTS.find(x=>x.id===pointId)!,dir=join(root,pointId,`s${seed}`),runId=`run-${pointId}-${seed}`;await mkdir(join(dir,'run'),{recursive:true});
 const pd=await profileDigest(p.profileId??'perception-ground-truth-v1'),ev=join(dir,'run/belief-evidence');
 const rec=await openBeliefRecorder({directory:ev,identity:{runId,bootId:'boot',sceneDigest:SCENE,perceptionProfileDigest:pd,recoveryPolicyDigest:null,graspMode:p.mode as 'belief_ground_truth',seed},maxBytes:1<<20});
 const shift=o.shift===undefined?(p.nudge?{dt:10,dx:0.005}:null):o.shift;
 for(let t=1400;t<=1700;t+=10)if(!(o.sparse&&t>1535&&t<1600))await rec.appendBelief(belief(t,shift&&t-5>=1535+shift.dt?shift.dx:0));
 // the run's own per-tick truth of the cup (what the shared world committed), named by its hash as the runtime names it
 const trace=JSON.stringify({schemaVersion:1,note:'test',frame:'map',samples:Array.from({length:301},(_,k)=>({tick:1400+k,props:[{propId:'cup-1',positionM:truth(shift&&1400+k>=1535+shift.dt?shift.dx:0),quaternionXyzw:[0,0,0,1],restingOn:null,held:false}]}))});
 await writeFile(join(dir,`run/arm-props-trace-${createHash('sha256').update(trace).digest('hex')}.json`),trace);
 const at=(stage:'plan'|'commit'|'outcome',recordedTick:number,outcome:'unknown'|'lifted')=>({attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:stage==='plan'?1444:1535,mode:p.mode as 'belief_ground_truth',beliefUsed:null,beliefErrorAtCommitM:0,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],outcome,stage,recordedTick});
 await rec.appendAttempt(at('plan',1444,'unknown') as never);await rec.appendAttempt(at('commit',1535,'unknown') as never);await rec.appendAttempt(at('outcome',1700,'lifted') as never);await rec.finish(null);
 const result={runId,outcome:'lifted',attempts:1,recovered:false,attention:false,ticks:1700,unexpectedContacts:0,directory:dir,beliefErrorAtCommitM:0,...o.result};
 await writeFile(join(dir,'rig-run.json'),JSON.stringify({schemaVersion:1,input:{seed,mode:p.mode,truthOffsetM:p.truthOffsetM,profileId:p.profileId,nudge:o.nudgeInput??p.nudge,recoveryPolicyId:null},offsetM:[0,0],result}));
 await writeFile(join(dir,'report.json'),JSON.stringify({manifest:{runId,sourceCommit:COMMIT,models:[{id:'mujoco_shared_world',hash:SCENE}],profiles:o.nudgeReport??p.nudge?[{id:'world-cup-nudge-v1',revision:1,hash:'e'.repeat(64),provenance:'registered_disturbance'}]:[]},outcome:{status:'running',served:'0',tick:1700},coffee:{},worldSweep:{nativeContacts:{unexpected:0}}}));
 await writeFile(join(dir,'case.json'),JSON.stringify({sourceCommit:COMMIT,artifacts:await cellArtifacts(dir)}));
}
const root=async(points:{id:string;seed:number;o?:Opt}[])=>{const r=await mkdtemp(join(tmpdir(),'study-v-'));await writeFile(join(r,'campaign.json'),JSON.stringify({campaign:{id:'perception-gap-v1'},sourceCommit:COMMIT}));for(const p of points)await run(r,p.id,p.seed,p.o);return r;};
const issuesOf=async(r:string,point:string,run:string)=>(await verifyPerceptionStudy(r,point)).issues.filter(i=>i.startsWith(run+':'));

test('a run whose report and stream say what its record says verifies',async()=>{
 const r=await root([{id:'truth-0',seed:1}]),v=await verifyPerceptionStudy(r,'truth-0');expect(v.issues).toEqual([]);expect(v.completedRuns).toBe(1);
});
test('R07: recovered, attention, ticks and the belief error at commit are recomputed from the report and the stream, not taken from the run record',async()=>{
 for(const [k,v] of [['recovered',true],['attention',true],['ticks',1],['beliefErrorAtCommitM',0.042]] as const){
  const r=await root([{id:'truth-0',seed:1,o:{result:{[k]:v}}}]);
  expect(await issuesOf(r,'truth-0','truth-0/s1'),k).toEqual([expect.stringContaining('RESULT_NOT_FROM_EVIDENCE')]);
 }
});
test('R06: a nudge point needs the nudge in the run\'s own report and the cup moving right after the commit; a run without it does not become a nudge case by changing its record',async()=>{
 const intent=await root([{id:'stale-nudge',seed:1,o:{nudgeReport:false,shift:null}}]);expect(await issuesOf(intent,'stale-nudge','stale-nudge/s1')).toEqual([expect.stringContaining('NUDGE_NOT_REGISTERED')]);
 const none=await root([{id:'stale-nudge',seed:1,o:{shift:null}}]);expect(await issuesOf(none,'stale-nudge','stale-nudge/s1')).toEqual([expect.stringContaining('NUDGE_NOT_OBSERVED')]);
 const late=await root([{id:'stale-nudge',seed:1,o:{shift:{dt:90,dx:0.01}}}]);expect(await issuesOf(late,'stale-nudge','stale-nudge/s1')).toEqual([expect.stringContaining('NUDGE_NOT_OBSERVED')]); // the normal movement of a grasp, long after the commit
 const real=await root([{id:'stale-nudge',seed:1}]);expect(await issuesOf(real,'stale-nudge','stale-nudge/s1')).toEqual([]);
 const stray=await root([{id:'truth-0',seed:1,o:{nudgeReport:true}}]);expect(await issuesOf(stray,'truth-0','truth-0/s1')).toEqual([expect.stringContaining('NUDGE_NOT_REGISTERED')]);
});

test('R06 (stale profile): a nudge that no belief sample shows is still observed in the run\'s per-tick props trace; the trace, not the stream, decides',async()=>{
 const seen=await root([{id:'stale-nudge',seed:1,o:{sparse:true}}]);expect(await issuesOf(seen,'stale-nudge','stale-nudge/s1')).toEqual([]);
 const still=await root([{id:'stale-nudge',seed:1,o:{sparse:true,shift:null}}]);expect(await issuesOf(still,'stale-nudge','stale-nudge/s1')).toEqual([expect.stringContaining('NUDGE_NOT_OBSERVED')]);
 const late=await root([{id:'stale-nudge',seed:1,o:{sparse:true,shift:{dt:90,dx:0.01}}}]);expect(await issuesOf(late,'stale-nudge','stale-nudge/s1')).toEqual([expect.stringContaining('NUDGE_NOT_OBSERVED')]);
});
