/** Byte-bound inputs shared by the two comparison scopes. No paths or URLs are fetched by a comparison. */
import {createHash} from 'node:crypto';
import {hashJson} from '../hash';
import type {RunReport} from '../report';
import {validateNavigationDocument,validateNavigationEvidence,type NavigationSceneV1} from '../navigation2d/contracts';
export interface StudyRef {path:string;sha256:string;bytes:number}
export interface StudyArtifact {ref:StudyRef;content:string;encoding?:'base64'}
export interface SimulationRunInput {report:StudyArtifact;artifacts:StudyArtifact[]}
export const bytesSha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function artifactBytes(a:StudyArtifact):Buffer{
 if(!a||!a.ref||typeof a.content!=='string'||a.content.length>24*1024*1024||a.encoding!==undefined&&a.encoding!=='base64')throw Error('ARTIFACT_LIMIT');
 const b=Buffer.from(a.content,a.encoding==='base64'?'base64':'utf8');if(b.length>16*1024*1024||b.length!==a.ref.bytes||bytesSha(b)!==a.ref.sha256)throw Error('ARTIFACT_DIGEST_MISMATCH');return b;
}
export function artifactJson(a:StudyArtifact):unknown{
 if(!a||!a.ref||typeof a.content!=='string'||Buffer.byteLength(a.content)>8*1024*1024||a.ref.bytes!==Buffer.byteLength(a.content)||a.ref.sha256!==bytesSha(a.content)||!a.ref.path||a.ref.path.length>512)throw Error('ARTIFACT_DIGEST_MISMATCH');
 return JSON.parse(a.content);
}
export function verifiedSimulationInput(input:SimulationRunInput){
 const report=artifactJson(input.report) as RunReport;
 if(!Array.isArray(input.artifacts)||input.artifacts.length>4000)throw Error('ARTIFACT_LIMIT');
 const documents=new Map<string,unknown>(),refs=new Map<string,StudyRef>();
 for(const a of input.artifacts){if(refs.has(a.ref.path))throw Error('DUPLICATE_ARTIFACT');artifactBytes(a);documents.set(a.ref.path,a.ref.path.endsWith('.json')?JSON.parse(artifactBytes(a).toString()):artifactBytes(a));refs.set(a.ref.path,a.ref);}
 const get=<T>(path:string):T=>{if(!documents.has(path))throw Error(`ARTIFACT_MISSING:${path}`);return documents.get(path) as T;};
 const scene=get<NavigationSceneV1>('navigation-scene.json');
 if(!validateNavigationDocument(scene).ok||scene.robots.length!==1||report.schemaVersion!==2||!report.manifest||!report.outcome||!Array.isArray(report.businessEvents)||!Array.isArray(report.effects)||!Array.isArray(report.confirmations)||!report.navigation2d)throw Error('INPUT_DOCUMENT_INVALID');
 const n=report.navigation2d,m=report.manifest;
 if(!validateNavigationEvidence(n).ok||n.runId!==m.runId||n.sceneRef.path!=='bundle/navigation-scene.json'||n.sceneDigest!==scene.sceneDigest||n.sceneRef.sha256!==refs.get('navigation-scene.json')?.sha256||n.sceneRef.bytes!==refs.get('navigation-scene.json')?.bytes||hashJson(n.modelDigests)!==hashJson(scene.robots.map(r=>r.model.modelDigest))||n.policyRef.hash!==scene.policy.hash||n.policyRef.id!==scene.policy.id||n.seed.runSeed!==m.seed||m.clock.tickMs!==scene.clock.tickMs||m.models.find(x=>x.id===scene.engine.id)?.hash!==scene.sceneDigest||m.backends.length!==1||m.backends[0]!.id!==scene.engine.id)throw Error('REPORT_INPUT_IDENTITY_MISMATCH');
 for(const f of scene.files){const ref=refs.get(f.path);if(!ref||ref.bytes!==f.bytes||ref.sha256!==f.sha256)throw Error('SCENE_FILE_MISMATCH');}
 const project=get<Record<string,unknown>>('engineering-project.json');
 if(hashJson(project)!==scene.inputs.project.digest||m.engineering?.projectDigest!==scene.inputs.project.digest)throw Error('PROJECT_INPUT_IDENTITY_MISMATCH');
 const runtime=project.runtimeProject as {world:Record<string,unknown>};
 const {revision:_revision,...world}=runtime.world;void _revision;
 if(hashJson(runtime.world)!==scene.inputs.world.hash||hashJson(world)!==m.world.hash||m.world.id!==scene.world.id||m.world.revision!==scene.world.revision||hashJson(get('runtime-project.json'))!==m.project.hash)throw Error('WORLD_INPUT_IDENTITY_MISMATCH');
 return {report,scene,project,get,documents,refs};
}
