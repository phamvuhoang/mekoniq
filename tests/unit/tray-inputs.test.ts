import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {trayDocumentIssues,actorEvidenceIssues} from '../../packages/lab-runtime/src/v2/simulation3d/tray-inputs';
import {MOBILE_CONTROLLER_POLICY,MOBILE_STOP_POLICY} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {mobileDriveBundle} from '../../packages/lab-runtime/src/v2/control/drive-experiments';
import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {sealDocument} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const fx=join(__dirname,'../../robotics/simulation-mujoco/fixtures/serve-tray-v1/'),WR='robotics/simulation-mujoco';
const plant='e'.repeat(64);
async function docs(id:'tray-nominal-v1'|'tray-low-friction-v1'){
 const load=JSON.parse(await readFile(fx+(id==='tray-nominal-v1'?'cup-triple':'cup-triple-low-friction')+'.json','utf8')),b=await mobileDriveBundle(WR,'drive-nominal-v1',plant,false,1);
 const phys=JSON.parse(await readFile(fx+(id==='tray-nominal-v1'?'drive-contact-profile':'drive-contact-tray-low-v1')+'.json','utf8'));
 return {load,physicsSha:'',physics:phys,driveControl:b.control,driveModel:b.model,plant,controllerPolicy:MOBILE_CONTROLLER_POLICY,stopPolicy:MOBILE_STOP_POLICY};
}
test('the documents of a nominal tray run are the registered ones',async()=>{
 const d=await docs('tray-nominal-v1');
 expect(trayDocumentIssues('tray-nominal-v1',{...d,physicsSha:(await import('node:crypto')).createHash('sha256').update(await readFile(fx+'drive-contact-profile.json')).digest('hex')})).toEqual([]);
});
test('a control profile with another gain or jerk limit, re-sealed, is refused; so are another load shape, other policies, another plant',async()=>{
 const d=await docs('tray-nominal-v1'),sha=(await import('node:crypto')).createHash('sha256').update(await readFile(fx+'drive-contact-profile.json')).digest('hex'),base={...d,physicsSha:sha};
 const gain=sealDriveDocument({...d.driveControl,axes:d.driveControl.axes.map((a,i)=>i===0?{...a,loop:{...a.loop,kp:3}}:a)});
 expect(trayDocumentIssues('tray-nominal-v1',{...base,driveControl:gain as never})).toContain('driveControl');
 const jerk=sealDriveDocument({...d.driveControl,controllers:d.driveControl.controllers.map(c=>c.controllerId==='diff-drive-base-v1'?{...c,params:{...c.params,maxJerkMps3:15}}:c)});
 expect(trayDocumentIssues('tray-nominal-v1',{...base,driveControl:jerk as never})).toContain('driveControl');
 expect(trayDocumentIssues('tray-nominal-v1',{...base,driveControl:{...d.driveControl,plantModelDigest:'f'.repeat(64)} as never})).toContain('plantModelDigest');
 const mass=sealDocument({...d.load,props:d.load.props.map((p:{massKg:number},i:number)=>i===0?{...p,massKg:p.massKg*2}:p)},'digest');
 expect(trayDocumentIssues('tray-nominal-v1',{...base,load:mass})).toContain('load');
 expect(trayDocumentIssues('tray-nominal-v1',{...base,stopPolicy:{...MOBILE_STOP_POLICY,loadDropM:0.5}})).toContain('stopPolicy');
 expect(trayDocumentIssues('tray-nominal-v1',{...base,controllerPolicy:{...MOBILE_CONTROLLER_POLICY,ramp:'x'}})).toContain('controllerPolicy');
 expect(trayDocumentIssues('tray-nominal-v1',{...base,physicsSha:'0'.repeat(64)})).toContain('physics');
 expect(hashJson(d.driveModel)).toBeTruthy();
});

const person={id:'person-1',radiusM:0.25,initialPoseMap:[5.5,3.7,0] as [number,number,number],startTick:1875,speedMps:0.8,path:[[5.5,3.7],[5.5,10.5]] as [number,number][]};
import {actorUpdatesAt} from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
const update=(t:number)=>actorUpdatesAt({actors:[person]} as never,t);
const control=(n:number,f:(t:number)=>unknown[]=update)=>Array.from({length:n},(_,i)=>({tick:i,targetTick:i+1,singleStep:false,velocities:[],actorUpdates:f(i+1)}));
test('the person the run really moved is the registered one: every step carries exactly the scheduled pose, and the fixture file is the registered body',()=>{
 const fixtureFile={schemaVersion:1,scenarioId:'MJ-TRAY01',fixtureHash:'h',actors:[{id:'person-1',radiusM:0.25,initialPoseMap:[5.5,3.7,0]}]};
 const run={actors:[person],fixtureFile,fixtureBytes:JSON.stringify(fixtureFile)};
 expect(actorEvidenceIssues(control(300),{...run,recordedFixtureBytes:run.fixtureBytes})).toEqual([]);
 // a different radius or start in the file the worker was bound to
 expect(actorEvidenceIssues(control(300),{...run,recordedFixtureBytes:JSON.stringify({...fixtureFile,actors:[{...fixtureFile.actors[0],radiusM:0.5}]})})).toContain('fixtureFile');
 // missing steps, a step that moved the person elsewhere, an extra actor
 expect(actorEvidenceIssues(control(300).slice(0,200),{...run,expectedSteps:300,recordedFixtureBytes:run.fixtureBytes})).toContain('controlSteps');
 expect(actorEvidenceIssues(control(300,t=>t===100?[{actorId:'person-1',poseMap:[9,9,0]}]:update(t)),{...run,recordedFixtureBytes:run.fixtureBytes})).toContain('actorUpdates:100');
 expect(actorEvidenceIssues(control(300,t=>[...update(t),{actorId:'ghost',poseMap:[0,0,0]}]),{...run,recordedFixtureBytes:run.fixtureBytes})).toContain('actorUpdates:1');
 // a variant with no person carries none
 expect(actorEvidenceIssues(control(50,()=>[]),{actors:[],fixtureFile:null,fixtureBytes:null,recordedFixtureBytes:null})).toEqual([]);
 expect(actorEvidenceIssues(control(50),{actors:[],fixtureFile:null,fixtureBytes:null,recordedFixtureBytes:null})).toContain('actorUpdates:1');
 expect(actorEvidenceIssues(control(50,()=>[]),{actors:[],fixtureFile:null,fixtureBytes:null,recordedFixtureBytes:'{}'})).toContain('fixtureFile');
});
