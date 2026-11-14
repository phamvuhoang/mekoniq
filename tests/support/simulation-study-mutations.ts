/** Coherent offline mutations only. Producer evidence is never edited or reidentified on disk. */
import type {SimulationRunInput} from '../../packages/lab-runtime/src/v2/simulation3d/simulation-input';
import type {NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import {sealDocument} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {artifact,sha} from './simulation-study';
export function resealStudyProfile(input:SimulationRunInput,path:string,mutate:(document:Record<string,unknown>)=>void,seal=true):SimulationRunInput{
 const run=structuredClone(input),index=run.artifacts.findIndex(a=>a.ref.path===path);if(index<0)throw Error('MUTATION_ARTIFACT_MISSING');
 const value=JSON.parse(run.artifacts[index]!.content);mutate(value);run.artifacts[index]=artifact(path,seal?sealDocument(value,'digest'):value);
 const scene=JSON.parse(run.artifacts.find(a=>a.ref.path==='navigation-scene.json')!.content) as NavigationSceneV1;
 if(scene.engine.id!=='mujoco_3d')throw Error('MUTATION_ENGINE_UNSUPPORTED');
 const changed=run.artifacts[index]!.ref,entry=scene.files.find(f=>f.path===path);if(!entry)throw Error('MUTATION_REF_MISSING');Object.assign(entry,{sha256:changed.sha256,bytes:changed.bytes});
 for(const ref of [scene.engine.loadProfileRef,scene.engine.physicsProfileRef])if(ref.path===path)ref.sha256=changed.sha256;
 const sealed=sealDocument(scene,'sceneDigest');
 for(const p of ['navigation-scene.json','scene.json']){const i=run.artifacts.findIndex(a=>a.ref.path===p);if(i>=0)run.artifacts[i]=artifact(p,sealed);}
 const sceneRef=run.artifacts.find(a=>a.ref.path==='navigation-scene.json')!.ref,report=JSON.parse(run.report.content) as RunReport,n=report.navigation2d!;
 n.sceneDigest=sealed.sceneDigest;n.sceneRef={...sceneRef,path:'bundle/navigation-scene.json'};
 for(const m of report.manifest.models)if(m.id===scene.engine.id)m.hash=sealed.sceneDigest;
 if(n.engine.id!=='mujoco_3d')throw Error('MUTATION_REPORT_ENGINE_UNSUPPORTED');
 n.engine.loadProfileRef={...scene.engine.loadProfileRef};n.engine.physicsProfileRef={...scene.engine.physicsProfileRef};
 if(report.physicsEvidence){const p=report.physicsEvidence;p.manifest.identity.sceneDigest=sealed.sceneDigest;p.manifest.identity.loadProfileDigest=scene.engine.loadProfileRef.sha256;p.manifest.identity.physicsProfileDigest=scene.engine.physicsProfileRef.sha256;
  const m=artifact('physics/manifest.json',p.manifest),i=run.artifacts.findIndex(a=>a.ref.path===m.ref.path);if(i>=0){run.artifacts[i]=m;p.manifestSha256=m.ref.sha256;}else p.manifestSha256=sha(JSON.stringify(p.manifest));
 }
 run.report=artifact(run.report.ref.path,report);return run;
}
/** A different valid navigation document cannot impersonate the load's physical model, even after every derived binding is resealed. */
export function substituteStudyPhysicalWithNavigation(input:SimulationRunInput):SimulationRunInput{
 const run=structuredClone(input),scene=JSON.parse(run.artifacts.find(a=>a.ref.path==='navigation-scene.json')!.content) as NavigationSceneV1,robot=scene.robots[0]!,path=`physical-model/${robot.robotId}.json`;
 const substituted=artifact(path,robot.model),physicalIndex=run.artifacts.findIndex(a=>a.ref.path===path),physicalRef=scene.files.find(f=>f.path===path);if(physicalIndex<0||!physicalRef)throw Error('MUTATION_PHYSICAL_MODEL_MISSING');
 run.artifacts[physicalIndex]=substituted;Object.assign(physicalRef,substituted.ref);
 robot.model=sealDocument({...robot.model,physicalModelDigest:robot.model.modelDigest},'modelDigest');
 const navPath=`navigation-model/${robot.robotId}.json`,navIndex=run.artifacts.findIndex(a=>a.ref.path===navPath);if(navIndex<0)throw Error('MUTATION_NAVIGATION_MODEL_MISSING');run.artifacts[navIndex]=artifact(navPath,robot.model);
 run.artifacts[run.artifacts.findIndex(a=>a.ref.path==='navigation-scene.json')]=artifact('navigation-scene.json',scene);
 const report=JSON.parse(run.report.content) as RunReport;report.navigation2d!.modelDigests=scene.robots.map(r=>r.model.modelDigest);
 for(const model of report.manifest.models)if(model.id===`navigation-model:${robot.robotId}`)model.hash=robot.model.modelDigest;
 run.report=artifact(run.report.ref.path,report);
 return resealStudyProfile(run,'empty.json',load=>{load.modelRef={path,sha256:substituted.ref.sha256};});
}
