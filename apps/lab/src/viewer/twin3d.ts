import {tr} from '../i18n';
import {mapExtent} from '../twin/world-view';
import {isMobilePreset,payloadGeometry} from '../twin/payload';
// Optional WebGL view of the same TwinFrame/ViewState the 2D plan draws. Read-only. The scene is kept: update() rebuilds it only when the scene itself
// (sceneKey: project, world, navigation scene, layers, selection) changes; an object whose own drawing changes (objectKeys: it appears or goes, its source,
// a cup entering or leaving the plant's report, the arm's display source) is redrawn alone (dataset.redraws); otherwise it moves what is there; pose() only changes transforms. Renders on demand: the workspace drives pose() from an
// animation frame only while live samples arrive and reduced motion is not requested. Any WebGL failure returns null or calls onFail and the
// workspace stays on the 2D plan with the same selection. An xArm 6 (MuJoCo plant) is drawn from its vendor meshes once they are loaded (D51), as its joint
// chain until then or when they cannot be used; the swap happens in place, without a rebuild or a camera move.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {droppedPlantCups,observedSegments,sceneEntities,type SceneEntity,type TwinFrame,type ViewState} from '../twin/scene';
import {amrFootprint,assetOf} from '../twin/amr';
import {footprintInMap} from '../twin/lidar';
import {placeBody,rosQuat,yawOf} from '../twin/pose3d';
import {ghostsAt} from '../twin/belief';
import {alarmMarks} from '../reports/diagnostics';
import {armFrames,type ArmJointDef} from '../twin/arm/arm-frames';
import {armJointsView,armModelFor,displayJoints} from '../twin/arm/arm-telemetry';
import {armChain,poseArmChain} from './arm-chain';
import {armJoints,cloneArmMeshes,loadArmMeshes,poseArmMeshes,type ArmMeshSet,type MeshFailure} from './arm-mesh';
import armComponent from '../../fixtures/engineering/arm-ref-3d-v1/component.json' with {type:'json'};
import xarmComponent from '../../fixtures/engineering/xarm6-g2-v1/component.json' with {type:'json'};
import xarmPhysics from '../../fixtures/engineering/xarm6-g2-v1/physics.json' with {type:'json'};
import xarmManifest from '../../fixtures/engineering/xarm6-g2-v1/manifest.json' with {type:'json'};
import xarmLayout from '../../fixtures/engineering/xarm6-g2-v1/cell-layout.json' with {type:'json'};
const XARM='xarm6-g2-v1',JOINTS:Record<ReturnType<typeof armModelFor>,ArmJointDef[]>={'arm-ref-3d-v1':armComponent.joints as unknown as ArmJointDef[],[XARM]:armJoints(xarmComponent,xarmPhysics)};
/** The Lab serves the meshes from its own origin (public/, beside the vendor NOTICE), never from the runtime. */
const XARM_BLOBS='/fixtures/xarm6-g2-v1/blobs/';
type Pose7={positionM:[number,number,number];quaternionXyzw:[number,number,number,number]};
/** Transforms only. `bodies`: an AMR's base origin in the ROS map (z up; z 0 for a planar plant) and its ROS orientation. `arms`: the joints shown and the
 * measured gripper opening. `cups`: the cups drawn where the plant reports them (map frame, cup centre). */
export interface TwinPoses {arms:Record<string,{jointsRad:number[];gripperOpeningM:number|null}>;bodies:Record<string,Pose7>;cups?:Record<string,Pose7>}
export interface Twin3d {canvas:HTMLCanvasElement;/** Move into a re-rendered stage and size from it. */attach(host:HTMLElement):void;update(f:TwinFrame,vs:ViewState,displayPoses?:TwinPoses):void;pose(p:TwinPoses):void;
 /** Camera back to the preset's home framing: its arm cell (homeRegion), else the whole floor. */home():void;/** Frame one object, or the whole scene for null or an object not drawn. */fit(entityId:string|null):void;camera(mode:'overview'|'cell'|'amr'):void;dispose():void}
const LIME=0xb4f375,NAVY=0x182a33;
const COLOR:Record<string,number>={footprint:0x9dccff,safety:0xf0b45a,observed:0x5ad1c6};
export interface OverlayShape {layer:'path'|'footprint'|'safety'|'observed';entityId:string;loop:boolean;z:number;points:[number,number][]}
/** The plan overlays of the 3D view, from the same frame data and helpers the 2D plan uses (no data of its own). Pure: what update() draws. */
export function overlayShapes(f:TwinFrame,vs:ViewState):OverlayShape[]{
 const out:OverlayShape[]=[];
 for(const r of f.view?.entities.filter(e=>e.kind==='amr')??[]){
  if(vs.layers.path&&r.path.length)out.push({layer:'path',entityId:r.id,loop:false,z:0.02,points:[[r.pose.x,r.pose.y],...r.path.map(([x,y])=>[x!,y!] as [number,number])]});
  // IR-SIM runs: the compiled footprint on the drive frame (T_map_base x T_base_drive); other runs: the Lab asset footprint
  const model=f.navigation?.robots.find(x=>x.robotId===r.id)?.model,poly=vs.layers.footprint?model?footprintInMap(model,r.pose):f.navigation?null:amrFootprint(assetOf(f.preset.project,f.preset.assets,r.id),r.pose):null;
  if(poly)out.push({layer:'footprint',entityId:r.id,loop:true,z:0.03,points:poly});
  // IR-SIM only, as on the 2D plan: the compiled footprint offset by the policy safety margin, and the observed telemetry path (never joined across a gap)
  if(vs.layers.safety&&model&&f.navigation)out.push({layer:'safety',entityId:r.id,loop:true,z:0.035,points:footprintInMap(model,r.pose,f.navigation.policy.parameters.safetyMarginM)});
  if(vs.layers.observed&&model&&f.navigation)for(const seg of observedSegments(f,r.id))out.push({layer:'observed',entityId:r.id,loop:false,z:0.025,points:seg});
 }
 return out;
}
/** The model revision the run reports (its arm trace, else the run project's arm profile, which the runtime checks against its fixture). */
const runRevision=(f:TwinFrame)=>f.report?.coffee?.armTrace?.modelRevision??f.preset.project.armCollisionProfile?.modelRevision??null;
/** What the scene draws: placed entities (no jobs), and for an arm the joints it shows (observed, else commanded; frozen while stale), the model it runs
 * (the report's arm plant when the report names one, else its samples' provider) and whether that model is drawn from meshes (the xArm, when the Lab's
 * fixture revision is the run's). */
function drawn(f:TwinFrame){
 const plant=f.report?.arm?.armPlant.engine;
 return sceneEntities(f).filter(e=>Number.isFinite(e.x)&&e.kind!=='job').map(e=>{
  if(e.kind!=='arm')return {e,arm:null};
  const s=f.samples?.[e.id],observed=f.world?.record.snapshot.arms?.find(a=>a.armId===e.id),v=s?armJointsView(s,f.nowMs??s.receivedAtMs):null,model=plant?(plant==='mujoco_3d'?XARM:'arm-ref-3d-v1'):armModelFor(s?.providerId??''),run=runRevision(f);
  return {e,arm:{...displayJoints(null,v),...observed?{jointsRad:observed.positionsRad,source:f.world?.quality==='stale'?'unknown' as const:'observed' as const,frozen:f.world?.quality==='stale'}:{},gripperOpeningM:observed?.gripper?.openingM??v?.gripperOpeningM??null,model,mesh:model===XARM&&(f.world?f.world.scene.armCell.arm.modelId===XARM&&f.world.scene.inputs.armModelDigest===xarmManifest.modelRevision&&f.world.scene.armCell.arm.modelRevision===xarmManifest.modelRevision&&f.world.scene.models.armPhysics.sha256==='2c756a02a780b8475fcd0c50062595443f1198c8cced13b0219d362de26c18dd'&&f.world.scene.models.armComponent.sha256==='0e2f40ef5a4569ea3e76879ed078fffd55d514b42c25c60072ebd7d27af3445a':run===null||run===xarmManifest.modelRevision)}};
 });
}
const armBase=(f:TwinFrame)=>f.world?.scene.armCell.arm.baseInMap??f.preset.project.armCollisionProfile?.baseInMap;
/** The cell's supports (the fixture's cell layout, arm-base frame): the nozzle stand and the tray, the boxes the simulated cell holds. */
const SUPPORTS=[['nozzle-stand',xarmLayout.nozzleStand],['tray',xarmLayout.tray]] as const;
type MapBox={min:[number,number,number];max:[number,number,number]};
/** A box of the arm-base frame placed in the map through baseInMap (the axis-aligned box of its turned corners). */
function baseBoxInMap(base:{position:number[];quaternionXyzw:number[]},c:readonly number[],size:readonly number[]):MapBox{
 const q=new THREE.Quaternion(...base.quaternionXyzw as [number,number,number,number]),p=new THREE.Vector3(...base.position as [number,number,number]);
 const pts=[0,1,2,3,4,5,6,7].map(i=>new THREE.Vector3(...[0,1,2].map(k=>c[k]!+(i>>k&1?1:-1)*size[k]!/2) as [number,number,number]).applyQuaternion(q).add(p));
 const b=new THREE.Box3().setFromPoints(pts);return {min:b.min.toArray() as [number,number,number],max:b.max.toArray() as [number,number,number]};
}
/** The arm is drawn as the xArm (meshes or their joint-chain fallback) at its base: its cell's supports and the illustrative mount are drawn with it. Pure. */
export const armCellDrawn=(f:TwinFrame)=>!!armBase(f)&&drawn(f).some(({arm})=>arm?.model===XARM&&!!arm.jointsRad);
/** The home framing of a preset that asks for its arm cell (`view: 'arm_cell'`), as boxes in the map frame (m), derived from the scene, never written into the preset:
 * the arm over its base (0.45 m around it; from 0.1 m below the base to 0.8 m above it, the arm standing up), the cell's two supports (the stand and the tray, placed
 * through baseInMap), and the docked robot at each coffee pickup (0.45 m around it, for its 0.4 m radius; from the floor to 0.6 m). Null for any other preset
 * (home shows the whole floor). Pure. */
export function homeRegion(f:TwinFrame):MapBox[]|null{
 const base=armBase(f),b=base?.position;if(f.preset.view!=='arm_cell'||!base||!b)return null;
 const M=0.45,around=(x:number,y:number,z0:number,z1:number):MapBox=>({min:[x-M,y-M,z0],max:[x+M,y+M,z1]});
 const mobileTop=f.payloadBundle?Math.max(...payloadGeometry(f.payloadBundle.physical).map(shape=>{const g=shape.geometry,r=g.kind==='box'?Math.hypot(...g.sizeM)/2:g.kind==='cylinder'?Math.hypot(g.radiusM,g.lengthM/2):g.kind==='sphere'?g.radiusM:0;return shape.positionM[2]!+r;}))+.15:.6;
 const supports=f.world?f.world.scene.armCell.supports.filter(s=>s.id!==f.world!.scene.supportMap.replacedStaticSupportId).map(s=>baseBoxInMap(base,s.centerM,s.sizeM)):SUPPORTS.map(([,s])=>baseBoxInMap(base,s.centerM,s.sizeM));
 return [around(b[0]!,b[1]!,Math.max(0,b[2]!-.1),b[2]!+.8),...supports,...f.preset.project.world.points.filter(p=>p.kind==='coffee_pickup').map(p=>around(p.x,p.y,0,mobileTop))];
}
/** One mesh load per model per page: the parsed geometry is kept and shared by every drawing of it. A load whose fetch failed is tried again by the next
 * mount of a view (`mount`: the view that asked); a blob whose sha256 differs, or that does not parse, stays unusable for the page. */
interface MeshLoad {set:ArmMeshSet|null;error:string|null;reason:MeshFailure|'render'|null;ms:number|null;mount:number;done:Promise<void>}
const loads=new Map<string,MeshLoad>();let mounts=0;
function meshLoad(mount:number,f:TwinFrame):MeshLoad{
 const cacheKey=f.world?.meshKey??XARM;let l=loads.get(cacheKey);if(l&&!(l.reason==='fetch'&&l.mount!==mount))return l;
 const t0=performance.now(),x:MeshLoad={set:null,error:null,reason:null,ms:null,mount,done:Promise.resolve()};
 x.done=loadArmMeshes(xarmComponent,xarmPhysics,async sha=>{if(f.world){if(!f.world.readMesh)throw Error('REPLAY_MESH_UNAVAILABLE');return f.world.readMesh(sha);}const r=await fetch(`${XARM_BLOBS}${sha}.stl`);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.arrayBuffer();},new THREE.MeshStandardMaterial())
  .then(s=>{x.set=s;},(e:unknown)=>{x.error=e instanceof Error?e.message:String(e);x.reason=(e as {reason?:MeshFailure}).reason??'fetch';}).finally(()=>{x.ms=performance.now()-t0;});
 loads.set(cacheKey,l=x);return l;
}
/** The page's loaded mesh set (the parsed geometry every drawing shares), or null: read by the browser test that checks nothing accumulates on it. */
export const cachedArmMeshes=():ArmMeshSet|null=>loads.get(XARM)?.set??null;
export interface ArmMeshIssue {entityId:string;code:'ARM_MODEL_REVISION_MISMATCH'|'ARM_MESH_UNAVAILABLE';lab?:string;run?:string;detail?:string;/** why the meshes cannot be used */reason?:MeshFailure|'render'}
/** Why an arm that has meshes is drawn as its joint chain instead (D51): the run reports another model revision than the Lab's fixture, or a mesh could not
 * be used. Both are notices: the run goes on. */
export function armMeshIssues(f:TwinFrame):ArmMeshIssue[]{
 if(!armBase(f))return [];
 return drawn(f).flatMap(({e,arm}):ArmMeshIssue[]=>{
  if(!arm?.jointsRad||arm.model!==XARM)return [];
  const run=runRevision(f),l=loads.get(XARM),err=l?.error;
  return !arm.mesh?[{entityId:e.id,code:'ARM_MODEL_REVISION_MISMATCH',lab:xarmManifest.modelRevision,run:run!}]:err?[{entityId:e.id,code:'ARM_MESH_UNAVAILABLE',detail:err,reason:l!.reason??'fetch'}]:[];
 });
}
const heightOf=(e:SceneEntity)=>e.kind==='amr'?0.225:e.kind==='coffee_machine'?1.125:e.kind==='arm'?1.25:e.kind==='cup'?(e.status?.startsWith('robot')?0.52:e.status?.startsWith('customer')?0.8:1.0):1.05;
/** What rebuilds the whole scene: the project and its world, the navigation scene, a layer, the selection. Pure. */
export const sceneKey=(f:TwinFrame,vs:ViewState):string=>{const p=f.preset.project;return JSON.stringify([p.id,p.revision,p.world.width,p.world.height,f.navigation?.sceneDigest??null,f.world?.meshKey??null,mapExtent(f),vs.layers,vs.selected]);};
/** How each drawn object looks (never its pose or joint angles): a changed entry redraws that object alone. Pure. */
export function objectKeys(f:TwinFrame):Map<string,string>{
 const chain=!!armBase(f);
 return new Map(drawn(f).map(({e,arm})=>[e.id,JSON.stringify([e.kind,e.source,!!e.pose3d,!!e.plant,e.payload?.geometry,e.cupGeometry,f.payloadBundle?.physicalSha256,arm&&[arm.source,arm.frozen,chain&&!!arm.jointsRad,arm.model,arm.mesh]])]));
}
/** Changes when the scene or any object's drawing changes; never when only a pose or a joint angle does. Pure. */
export const structureKey=(f:TwinFrame,vs:ViewState):string=>JSON.stringify([sceneKey(f,vs),[...objectKeys(f)]]);
/** The exact poses of a frame (no buffer): what update() shows, and the base the workspace's sample buffer overrides. Pure. */
export function posesOf(f:TwinFrame):TwinPoses{
 const out:Required<TwinPoses>={arms:{},bodies:{},cups:{}},chain=!!armBase(f);
 for(const {e,arm} of drawn(f)){
  if(e.kind==='amr')out.bodies[e.id]=f.world?.record.snapshot.physics?.base.find(b=>b.robotId===e.id)?.poseMap as Pose7??{positionM:[e.x,e.y,e.pose3d?.z??0],quaternionXyzw:rosQuat(e.yawRad??0,e.pose3d?.pitchRad??0,e.pose3d?.rollRad??0)};
  else if(arm?.jointsRad&&chain)out.arms[e.id]={jointsRad:arm.jointsRad,gripperOpeningM:arm.gripperOpeningM};
  else if(e.plant)out.cups[e.id]=e.plant;
 }
 return out;
}
/** Remove and free an object (or every child of a group): geometries and materials are not shared across rebuilds, except the arm meshes' parsed geometry (`userData.shared`), kept for the page. */
const freeOne=(c:THREE.Object3D)=>{c.removeFromParent();c.traverse(o=>{const m=o as THREE.Mesh,mt=m.material as THREE.Material|THREE.Material[]|undefined;if(!m.userData.shared)m.geometry?.dispose();for(const x of Array.isArray(mt)?mt:mt?[mt]:[])x.dispose();});};
const free=(g:THREE.Object3D)=>{for(const c of [...g.children])freeOne(c);};
/** The overlays as drawn: footprint and safety outlines in their entity's own frame (`anchored`: they move with its body, never rebuilt for a pose),
 * the rest in the map. Pure. */
export function anchoredOverlays(f:TwinFrame,vs:ViewState):(OverlayShape&{anchored:boolean})[]{
 const at=new Map((f.view?.entities??[]).filter(r=>[r.pose.x,r.pose.y,r.pose.yawRad].every(Number.isFinite)).map(r=>[r.id,r.pose]));
 return overlayShapes(f,vs).map(sh=>{
  const p=at.get(sh.entityId);if(!p||(sh.layer!=='footprint'&&sh.layer!=='safety'))return {...sh,anchored:false};
  const c=Math.cos(p.yawRad),s=Math.sin(p.yawRad);
  return {...sh,anchored:true,points:sh.points.map(([x,y])=>{const dx=x-p.x,dy=y-p.y;return [c*dx+s*dy,-s*dx+c*dy] as [number,number];})};
 });
}
const r6=(_k:string,v:unknown)=>typeof v==='number'?Math.round(v*1e6)/1e6:v;
/** An arm as drawn: placed at its base (`at`), dressed as its joint chain or its meshes; `q`/`opening` are the last pose, for a swap. */
interface ArmDraw {id:string;at:THREE.Group;joints:ArmJointDef[];look:{wire:boolean;emissive:boolean};wantMesh:boolean;chain?:THREE.Group;mesh?:ArmMeshSet;q:number[];opening:number|null}
/** `onArmMesh`: the arm's drawing changed by itself (meshes ready or failed), so the page can update its problems list. */
export function mountTwin3d(host:HTMLElement,onSelect:(id:string)=>void,onFail:()=>void,onArmMesh:()=>void=()=>{},onManualOrbit:()=>void=()=>{}):Twin3d|null {
 let renderer:THREE.WebGLRenderer;const mount=++mounts;
 try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{return null;}
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const canvas=renderer.domElement;canvas.setAttribute('aria-label',tr('Bản sao 3D. Chọn vật thể từ danh sách.','3Dツイン。物体リストから選択できます。','3D twin view. Use the entity list to select objects.'));canvas.dataset.rebuilds='0';canvas.dataset.redraws='0';canvas.dataset.overlayBuilds='0';
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();queueMicrotask(onFail);});
 host.replaceChildren(canvas);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,0.1,200),controls=new OrbitControls(camera,canvas);
 controls.enableDamping=false;controls.maxPolarAngle=Math.PI*0.48;
 scene.add(new THREE.HemisphereLight(0xc9e8ff,0x24373b,2.6));
 // one directional light casts soft shadows; its shadow camera covers the floor (set on each rebuild)
 const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun,sun.target);
 const world=new THREE.Group(),overlays=new THREE.Group(),beliefs=new THREE.Group(),alarmsG=new THREE.Group();scene.add(world,overlays,beliefs,alarmsG);
 /** Per drawn entity: its object, the height of its centre above the base origin (AMR), and the arm chain to re-pose. */
 const objs=new Map<string,{obj:THREE.Object3D;c:number;arm?:ArmDraw}>();
 let userMoved=false,key='',okeys=new Map<string,string>(),rebuilds=0,redraws=0,lf:TwinFrame|null=null,floor='',okey='',overlayBuilds=0,gone=false;
 /** Per entity: the overlay group that moves with its body, and its path line whose first point is the body. */
 const anchors=new Map<string,THREE.Group>(),heads=new Map<string,THREE.Line>();
 const mat=(color:number,o:{wire?:boolean;emissive?:boolean}={})=>new THREE.MeshStandardMaterial({color,wireframe:!!o.wire,emissive:o.emissive?LIME:0x000000,emissiveIntensity:o.emissive?0.6:0,roughness:0.7});
 /** A dataset attribute is written only when its value changed (pose() runs every animation frame). */
 const put=(k:string,v:string)=>{if(canvas.dataset[k]!==v)canvas.dataset[k]=v;};
 /** For tests and evidence, on demand only (the canvas's `twinFraming()`): the share of the viewport's height the arm takes (its bounding box projected),
  * whether the whole floor is in view, and the camera. */
 const framing=()=>{
  scene.updateMatrixWorld();camera.updateMatrixWorld();
  const ndc=(p:THREE.Vector3)=>p.clone().project(camera),arm=[...objs.values()].find(o=>o.arm)?.arm?.at;let armFrac=0;// the arm's links only (not its cell's supports or mount)
  if(arm){const b=new THREE.Box3().setFromObject(arm);if(!b.isEmpty()){const ys=[0,1,2,3,4,5,6,7].map(i=>ndc(new THREE.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z)).y);armFrac=(Math.min(1,Math.max(...ys))-Math.max(-1,Math.min(...ys)))/2;}}
  const w=lf?.preset.project.world,floorInView=!!w&&[[0,0],[w.width,0],[0,w.height],[w.width,w.height]].every(([x,y])=>{const q=ndc(at(x!,y!));return Math.abs(q.x)<=1&&Math.abs(q.y)<=1;});
  return {armFrac:Number(armFrac.toFixed(3)),floorInView,camera:canvas.dataset.camera??''};
 };
 /** For tests and evidence: what the cell draws, as axis-aligned boxes in the map frame (scene (x, y, z) is map (x, z, -y)). */
 const toMap=(b:THREE.Box3):MapBox=>({min:[b.min.x,-b.max.z,b.min.y],max:[b.max.x,-b.min.z,b.max.y]});
 const drawnCell=()=>{
  scene.updateMatrixWorld();const supports:(MapBox&{id:string})[]=[];let mount:MapBox|null=null;const cups:Record<string,MapBox>={};
  const legs:(MapBox&{id:string})[]=[];
  world.traverse(o=>{if(o.userData.support)supports.push({id:o.userData.support as string,...toMap(new THREE.Box3().setFromObject(o))});if(o.userData.mount)mount=toMap(new THREE.Box3().setFromObject(o));if(o.userData.leg)legs.push({id:o.userData.leg as string,...toMap(new THREE.Box3().setFromObject(o))});});
  for(const [id,o] of objs)if(o.obj.userData.plant)cups[id]=toMap(new THREE.Box3().setFromObject(o.obj));
  return {supports,mount,legs,cups};
 };
 Object.assign(canvas,{twinFraming:framing,twinDrawn:drawnCell});
 let renderCount=0;const render=()=>{const measured=canvas.dataset.measureRender==='1',start=measured?performance.now():0;renderer.render(scene,camera);put('camera',camera.position.toArray().map(v=>v.toFixed(3)).join(','));put('geometries',String(renderer.info.memory.geometries));renderCount++;put('renderCount',String(renderCount));if(measured)canvas.dispatchEvent(new CustomEvent('twin-render',{detail:{atMs:performance.now(),durationMs:performance.now()-start,count:renderCount,drawCalls:renderer.info.render.calls,worldTick:lf?.world?.record.snapshot.tick??null,revision:lf?.world?.sourceRevision??null,quality:lf?.world?.quality??null}}));};
 // size from wherever the canvas lives now: the stage element is replaced on every workspace render
 // a new size re-applies the home framing (it depends on the viewport's shape) unless the user has moved the camera since: a fresh mount frames at its real size
 const resize=()=>{const p=canvas.parentElement,w=p?.clientWidth||640,h=p?.clientHeight||420;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(floor&&!userMoved)home();else render();};
 const ro=new ResizeObserver(resize);ro.observe(host);controls.addEventListener('change',render);
 // the user's own orbit, pan or zoom: from then on the camera is the user's until home is pressed or the floor or preset changes. Only an interaction
 // that moved the camera counts (OrbitControls starts one on any pointer-down or wheel: a plain click to select moves nothing)
 const cameraPose=()=>[...camera.position.toArray(),...controls.target.toArray()].map(v=>v.toFixed(6)).join(',');let atStart='';
 controls.addEventListener('start',()=>{atStart=cameraPose();});controls.addEventListener('end',()=>{if(cameraPose()!==atStart){userMoved=true;onManualOrbit();}});
 const pick=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
  const hit=ray.intersectObjects(world.children,true).find(h=>h.object.userData.entityId);if(hit)onSelect(String(hit.object.userData.axisId??hit.object.userData.entityId));};
 let down:[number,number]=[0,0];
 canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
 canvas.addEventListener('pointerup',e=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])<5)pick(e);});
 const at=(x:number,y:number,z=0)=>new THREE.Vector3(x,z,-y);
 /** Dress an arm as its meshes (a copy sharing the loaded geometry) or as its joint chain, never a mix, posed at its last joints. */
 const dress=(a:ArmDraw,set:ArmMeshSet|null)=>{
  free(a.at);const m=mat(set?0xc5ccd0:NAVY+0x101010,a.look);
  if(set){a.mesh=cloneArmMeshes(set,m);a.chain=undefined;a.at.add(a.mesh.group);poseArmMeshes(a.mesh,armFrames(a.joints,a.q),a.opening);}
  else{a.chain=armChain(armFrames(a.joints,a.q),m);a.mesh=undefined;a.at.add(a.chain);}
  a.at.traverse(o=>{o.userData.entityId=a.id;if((o as THREE.Mesh).isMesh)o.castShadow=o.receiveShadow=true;});
  // R5.4: a link moved by joint Ji picks `<arm>/Ji` (meshes: arm links 1..6, then the gripper links; chain: the sphere at frame i); the base picks the arm
  const tag=(o:THREE.Object3D|undefined,axis:string)=>o?.traverse(x=>{x.userData.axisId=axis;});
  if(a.mesh){const n=a.mesh.group.userData.armLinks as number;a.mesh.links.forEach((l,i)=>{if(i>=1&&i<n)tag(l,`${a.id}/J${i}`);});a.mesh.links.slice(n).forEach(l=>tag(l,`${a.id}/gripper`));}
  else a.chain?.children.slice(1,a.joints.length+1).forEach((c,i)=>{if((c as THREE.Mesh).geometry?.type==='SphereGeometry')tag(c,`${a.id}/J${i+1}`);});
 };
 const arms=()=>[...objs.values()].flatMap(o=>o.arm?[o.arm]:[]);
 /** What the view shows of the arm and the cups, for tests and evidence: the drawing in use, its mesh links, the drive angle, each plant cup's map position. */
 /** Per pose (cheap); the fallback reason only when the drawing changes (a build or a finished load), off the animation path. */
 const fallback=()=>put('armFallback',lf?armMeshIssues(lf).map(i=>i.code).join(' '):'');
 const status=()=>{
  const a=arms()[0],l=loads.get(XARM),plant=[...objs].filter(([,o])=>o.obj.userData.plant);
  const sum=(k:string)=>String([...objs.values()].reduce((n,o)=>n+((o.obj.userData[k] as number|undefined)??0),0));put('armSupports',sum('supports'));put('armIllustrative',sum('illustrative'));put('armModel',a?a.mesh?'mesh':'chain':'');put('armMeshLinks',String(a?.mesh?.links.length??0));put('armMeshMs',l?.ms==null?'':l.ms.toFixed(0));
  put('gripperRad',a?.mesh?(a.mesh.group.userData.driveRad as number).toFixed(4):'');
  put('cups',plant.length?JSON.stringify(Object.fromEntries(plant.map(([id,o])=>[id,[o.obj.position.x,-o.obj.position.z,o.obj.position.y].map(v=>Number(v.toFixed(4)))]))):'{}');
 };
 /** The meshes, or on any throw while dressing them the joint chain for good: the load is marked unusable (ARM_MESH_UNAVAILABLE), never an arm with no drawing. */
 const dressMeshes=(a:ArmDraw,l:MeshLoad)=>{
  try{dress(a,l.set);}catch(e){l.error=`ARM_MESH_UNAVAILABLE:render (${e instanceof Error?e.message:String(e)})`;l.reason='render';l.set=null;dress(a,null);}
 };
 /** Swap every arm waiting for these meshes in place once they are loaded (or report the failure): no rebuild, the camera stays. */
 const waiting=new Set<MeshLoad>();
 const await_=(l:MeshLoad)=>{if(waiting.has(l))return;waiting.add(l);void l.done.then(()=>{waiting.delete(l);if(gone)return;
  for(const a of arms())if(l.set&&a.wantMesh&&!a.mesh)dressMeshes(a,l);
  akey='';if(lf)drawAlarms(lf);
  fallback();status();render();onArmMesh();});};
 /** One object as its frame describes it, added to the world (an arm: its chain or meshes; anything else: its schematic shape). */
 const drawOne=({e,arm}:ReturnType<typeof drawn>[number],f:TwinFrame,vs:ViewState)=>{
  const base=armBase(f);
  const on=e.id===vs.selected;
  // an arm with joint telemetry and a base pose is drawn as its joint chain (what the runtime last reported, never extrapolated); otherwise the single cylinder below
  if(arm?.jointsRad&&base){
   const a:ArmDraw={id:e.id,at:new THREE.Group(),joints:JOINTS[arm.model],look:{wire:arm.source!=='observed'||arm.frozen||!!f.world&&!arm.mesh,emissive:on},wantMesh:arm.mesh,q:arm.jointsRad,opening:arm.gripperOpeningM};
   const [px,py,pz]=base.position as [number,number,number],[qx,qy,qz,qw]=base.quaternionXyzw as [number,number,number,number];
   a.at.quaternion.set(qx,qy,qz,qw);a.at.position.set(px,py,pz);
   const holder=new THREE.Group();holder.rotation.x=-Math.PI/2;holder.add(a.at); // ROS (z up) -> scene (y up): (x, y, z) -> (x, z, -y); the arm sits at the base pose in the ROS map
   world.add(holder);objs.set(e.id,{obj:holder,c:0,arm:a});
   // the xArm's cell: its two supports (assumed geometry of the simulated cell, solid) and a mount from the floor to the base (not simulated: an illustrative wireframe);
   // built with the arm, disposed with it, never picked
   if(arm.model===XARM){
    const cell=new THREE.Group();cell.quaternion.copy(a.at.quaternion);cell.position.copy(a.at.position);holder.add(cell);
    for(const [id,b] of (f.world?f.world.scene.armCell.supports.map(s=>[s.id,s] as const):SUPPORTS)){if(id===f.world?.scene.supportMap.replacedStaticSupportId)continue;const m=new THREE.Mesh(new THREE.BoxGeometry(...b.sizeM as [number,number,number]),mat(0x7d8b8f));m.position.set(...b.centerM as [number,number,number]);m.userData.support=id;cell.add(m);}
    // illustrative, not simulated: the mount under the base and a leg under the nozzle stand, standing vertically in the map from the floor to the point under
    // them; the tray stands for the docked robot's tray (the receiver), so it gets no leg (one would pass through the robot)
    const props=new THREE.Group(),leg=(id:string,top:THREE.Vector3,r:number)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,top.z,12,1,true),mat(0x9fb3b8,{wire:true}));m.rotation.x=Math.PI/2;m.position.set(top.x,top.y,top.z/2);m.userData[id==='mount'?'mount':'leg']=id;props.add(m);};
    leg('mount',new THREE.Vector3(px,py,pz),0.08);
    for(const [id,b] of SUPPORTS)if(id!=='tray')leg(id,new THREE.Vector3(b.centerM[0],b.centerM[1],b.centerM[2]-b.sizeM[2]/2).applyQuaternion(a.at.quaternion).add(a.at.position),0.03);
    holder.add(props);
    for(const g of [cell,props])g.traverse(o=>{o.raycast=()=>{};});holder.userData.supports=SUPPORTS.length-(f.world?1:0);holder.userData.illustrative=props.children.length;
   }
   // the meshes when they are loaded (once per page); the joint chain until then, and for good when they cannot be used
   const l=a.wantMesh?meshLoad(mount,f):null;if(l?.set)dressMeshes(a,l);else dress(a,null);if(l&&!l.set&&!l.error)await_(l);
   return;
  }
  if(e.kind==='amr'&&isMobilePreset(f.preset.id)&&!f.payloadBundle)return;// no generic body presented as admitted mobile geometry
  if(e.kind==='amr'&&f.payloadBundle){
   // All link geometry is canonical base-frame SI; convert each local pose once, then place the group at the measured base.
   const group=new THREE.Group();group.userData.entityId=e.id;
   for(const shape of payloadGeometry(f.payloadBundle.physical)){
    const g=shape.geometry,geo=g.kind==='box'?new THREE.BoxGeometry(g.sizeM[0]!,g.sizeM[2]!,g.sizeM[1]!):g.kind==='cylinder'?new THREE.CylinderGeometry(g.radiusM,g.radiusM,g.lengthM,24):g.kind==='sphere'?new THREE.SphereGeometry(g.radiusM,16,12):null;
    if(!geo)continue;
    const mesh=new THREE.Mesh(geo,mat(shape.linkId.startsWith('tray-')?0x91a8ac:shape.linkId.startsWith('wheel')?0x29373c:0xd3dcd3,{wire:e.source==='unknown',emissive:on}));
    const pl=placeBody(shape.positionM,shape.quaternionXyzw,0);mesh.position.set(...pl.position);mesh.quaternion.set(...pl.quaternion);mesh.userData.entityId=e.id;mesh.userData.linkId=shape.linkId;{const w=/^(wheel-(?:left|right))(?:\/|$)/.exec(shape.linkId);if(w)mesh.userData.axisId=`${e.id}/${w[1]}`;}group.add(mesh);
   }
   world.add(group);objs.set(e.id,{obj:group,c:0});return;
  }
  // a cup the plant reports: its own size (cell layout, assumed) at the plant's pose, set by pose(); any other cup: the schematic cup at its custodian
  const cup=e.cupGeometry??e.payload?.geometry??xarmLayout.cup,geo=e.kind==='amr'?new THREE.CylinderGeometry(0.3,0.3,0.45,24):e.kind==='coffee_machine'?new THREE.BoxGeometry(0.4,0.45,0.3):e.kind==='arm'?new THREE.CylinderGeometry(0.09,0.12,0.7,16):(e.kind==='cup'||e.kind==='payload')?e.plant?new THREE.CylinderGeometry(cup.radiusM,cup.radiusM,cup.heightM,20):new THREE.CylinderGeometry(0.05,0.04,0.12,16):new THREE.BoxGeometry(0.25,0.3,0.25);
  const mesh=new THREE.Mesh(geo,mat(e.kind==='amr'?0xd3dcd3:(e.kind==='cup'||e.kind==='payload')?0xf5f0e6:NAVY+0x101010,{wire:e.source==='unknown'||e.source==='derived',emissive:on}));
  // a 3D plant: the body centre sits above the base origin by its height less the wheel radius (the base origin's height when it stands level)
  const wheel=f.navigation?.robots.find(r=>r.robotId===e.id)?.model.kinematics.wheelRadiusM??0.09;
  mesh.userData.entityId=e.id;mesh.userData.plant=!!e.plant;world.add(mesh);objs.set(e.id,{obj:mesh,c:heightOf(e)-(e.pose3d?wheel:0)});
 };
 const build=(f:TwinFrame,vs:ViewState)=>{
  free(world);objs.clear();akey='';
  const w=f.preset.project.world,bounds=mapExtent(f),cx=(bounds.minM[0]+bounds.maxM[0])/2,cy=(bounds.minM[1]+bounds.maxM[1])/2,m=Math.max(w.width,w.height);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxM[0]-bounds.minM[0],bounds.maxM[1]-bounds.minM[1]),mat(0x101e25));ground.rotation.x=-Math.PI/2;ground.position.copy(at(cx,cy));world.add(ground);
  const grid=new THREE.GridHelper(m,m,0x4a626a,0x2c424b);grid.position.copy(at(cx,cy,0.001));world.add(grid);
  for(const o of w.obstacles){const b=new THREE.Mesh(new THREE.BoxGeometry(o.width,0.9,o.height),mat(0x29414b));b.position.copy(at(o.x+o.width/2,o.y+o.height/2,0.45));world.add(b);}
  for(const o of f.navigation?.world.obstacles??[])world.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(o.verticesM.map(v=>at(v[0]!,v[1]!,0.04))),new THREE.LineBasicMaterial({color:0xf0b45a})));
  // Tables are schematic context, not collision geometry; runtime obstacles and footprint overlays remain the model.
  for(const p of w.points.filter(p=>p.kind==='table')){const table=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,0.08,20),mat(0x43585d));table.position.copy(at(p.x,p.y,0.72));world.add(table);}
  for(const d of drawn(f))drawOne(d,f,vs);
  if(vs.layers.frames)world.add(new THREE.AxesHelper(0.6));
  world.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=o!==ground;o.receiveShadow=true;}});
  sun.position.set(w.width/2+3,8,-w.height/2+4);sun.target.position.set(w.width/2,0,-w.height/2);
  const sc=sun.shadow.camera;sc.left=sc.bottom=-m;sc.right=sc.top=m;sc.near=0.5;sc.far=40;sc.updateProjectionMatrix();
  canvas.dataset.rebuilds=String(++rebuilds);fallback();status();
 };
 /** Rebuilt only when the overlay data changes (a new path, a longer trail, a layer), never for a pose: `canvas.dataset.overlayBuilds` counts it. */
 const drawOverlays=(f:TwinFrame,vs:ViewState)=>{
  const shapes=anchoredOverlays(f,vs),ids=vs.layers.frames?(f.view?.entities??[]).map(r=>r.id):[];
  const k=JSON.stringify([shapes.map(sh=>sh.layer==='path'?{...sh,points:sh.points.slice(1)}:sh),ids],r6);if(k===okey)return;okey=k;
  free(overlays);anchors.clear();heads.clear();
  const anchor=(id:string)=>{let g=anchors.get(id);if(!g){g=new THREE.Group();overlays.add(g);anchors.set(id,g);}return g;};
  for(const sh of shapes){
   const geo=new THREE.BufferGeometry().setFromPoints(sh.points.map(([x,y])=>sh.anchored?new THREE.Vector3(x,sh.z,-y):at(x,y,sh.z)));
   const line=sh.layer==='path'?new THREE.Line(geo,new THREE.LineDashedMaterial({color:LIME,dashSize:0.08,gapSize:0.06})).computeLineDistances():new (sh.loop?THREE.LineLoop:THREE.Line)(geo,new THREE.LineBasicMaterial({color:COLOR[sh.layer]}));
   (sh.anchored?anchor(sh.entityId):overlays).add(line);if(sh.layer==='path')heads.set(sh.entityId,line);
  }
  for(const id of ids){const ax=new THREE.AxesHelper(0.4);ax.position.y=0.5;anchor(id).add(ax);}
  canvas.dataset.overlayBuilds=String(++overlayBuilds);
 };
 /** R4.4: the believed position of each cup as a wireframe cup (the real cup stays solid), a dot where it was observed and the link between them. Drawn only when the report has the stream at the cursor; rebuilt only when that data changes. */
 let bkey='';
 const drawBeliefs=(f:TwinFrame)=>{
  const g=ghostsAt(f,armBase(f)),k=JSON.stringify(g,r6);if(k===bkey)return;bkey=k;free(beliefs);
  if(g.status==='data')for(const i of g.items){
   const cup=f.world?.scene.armCell.props.find(p=>p.propId===i.objectId)??xarmLayout.cup,geo=new THREE.CylinderGeometry(cup.radiusM,cup.radiusM,cup.heightM,20,1,true),ghost=new THREE.Mesh(geo,mat(0x7a3fb0,{wire:true}));
   ghost.position.copy(at(i.beliefMapM[0],i.beliefMapM[1],i.beliefMapM[2]));ghost.userData.belief=i.objectId;
   const dot=new THREE.Mesh(new THREE.SphereGeometry(0.008,10,8),mat(0x122207));dot.position.copy(at(i.truthMapM[0],i.truthMapM[1],i.truthMapM[2]));
   const link=new THREE.Line(new THREE.BufferGeometry().setFromPoints([ghost.position,dot.position]),new THREE.LineBasicMaterial({color:0x7a3fb0}));
   beliefs.add(ghost,dot,link);
  }
  canvas.dataset.beliefs=g.status==='data'?g.items.map(i=>i.objectId).join(' '):'';canvas.dataset.beliefState=g.status;
 };
 /** R5.4: each entity (or its wheel/joint) with an alarm at the cursor gets an outline box and a warning icon above it, never colour alone; not picked, no animation.
  * Rebuilt when the marks or the scene objects change; placed again on every pose. `canvas.dataset.alarmMarks` names what is marked. */
 let akey='',alarmIcon:THREE.CanvasTexture|null=null;
 const icon=()=>{if(alarmIcon)return alarmIcon;const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d')!;g.fillStyle='#d64545';g.strokeStyle='#ffffff';g.lineWidth=4;g.beginPath();g.moveTo(32,4);g.lineTo(61,58);g.lineTo(3,58);g.closePath();g.fill();g.stroke();g.fillStyle='#ffffff';g.font='bold 36px sans-serif';g.textAlign='center';g.fillText('!',32,52);return alarmIcon=new THREE.CanvasTexture(c);};
 const placeAlarms=()=>{for(const c of alarmsG.children){const t=c.userData.alarmOf as THREE.Object3D;if(c instanceof THREE.BoxHelper)c.update();else{const b=new THREE.Box3().setFromObject(t);if(!b.isEmpty())c.position.set((b.min.x+b.max.x)/2,b.max.y+0.12,(b.min.z+b.max.z)/2);}}};
 const drawAlarms=(f:TwinFrame)=>{
  const marks=alarmMarks(f.report??null,f.view?.tick??null),k=JSON.stringify(marks);if(k===akey)return;akey=k;free(alarmsG);const shown:string[]=[];
  for(const m of marks){const o=objs.get(m.entityId)?.obj;if(!o)continue;let target:THREE.Object3D=o;if(m.axisId)o.traverse(x=>{if(x.userData.axisId===m.axisId&&target===o)target=x;});
   const box=new THREE.BoxHelper(target,0xd64545);box.userData.alarmOf=target;const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:icon(),depthTest:false,sizeAttenuation:false}));sp.scale.set(0.045,0.045,1);sp.renderOrder=10;sp.userData.alarmOf=target;alarmsG.add(box,sp);shown.push(target===o?m.entityId:m.axisId!);}
  put('alarmMarks',shown.join(' '));
 };
 /** Transforms only: bodies, the arm chain, the overlays anchored to a body and the first point of its path (moved in place). */
 const pose=(p:TwinPoses)=>{
  for(const [id,b] of Object.entries(p.bodies)){
   const o=objs.get(id),g=anchors.get(id),head=heads.get(id),[x,y]=b.positionM;
   if(o&&!o.arm){const pl=placeBody(b.positionM,b.quaternionXyzw,o.c);o.obj.position.set(...pl.position);o.obj.quaternion.set(...pl.quaternion);}
   if(g){g.position.set(x,0,-y);g.rotation.y=yawOf(b.quaternionXyzw);}
   if(head){
    const pos=head.geometry.getAttribute('position') as THREE.BufferAttribute,dist=head.geometry.getAttribute('lineDistance') as THREE.BufferAttribute|undefined;
    pos.setXYZ(0,x,pos.getY(0),-y);pos.needsUpdate=true;
    // the dashes keep their phase along the rest of the path: shift every later distance by the change of the first segment
    if(dist&&pos.count>1){const d=Math.hypot(pos.getX(1)-x,pos.getZ(1)+y)-dist.getX(1);for(let i=1;i<dist.count;i++)dist.setX(i,dist.getX(i)+d);dist.needsUpdate=true;}
   }
  }
  for(const [id,p0] of Object.entries(p.arms)){const a=objs.get(id)?.arm;if(!a||p0.jointsRad.length!==a.joints.length)continue;
   a.q=p0.jointsRad;a.opening=p0.gripperOpeningM;const fr=armFrames(a.joints,a.q);
   if(a.mesh)poseArmMeshes(a.mesh,fr,a.opening);else if(a.chain)poseArmChain(a.chain,fr);// the fingers follow the measured opening only
  }
  for(const [id,c] of Object.entries(p.cups??{})){const o=objs.get(id);if(o?.obj.userData.plant){const pl=placeBody(c.positionM,c.quaternionXyzw,0);o.obj.position.set(...pl.position);o.obj.quaternion.set(...pl.quaternion);}}
  put('armPoses',JSON.stringify(p.arms));put('payloadCount',String(Object.keys(p.cups??{}).filter(id=>id.startsWith('payload:')).length));put('payloadPoses',JSON.stringify(p.cups??{}));put('bodyPoses',JSON.stringify(p.bodies));put('payloadGeometry',lf?.payloadBundle?.physicalSha256??'');
  placeAlarms();status();render();
 };
 let explicitCamera:'overview'|'cell'|'amr'|null=null;
 const home=()=>{if(!lf)return;const w=lf.preset.project.world,b=mapExtent(lf),cx=(b.minM[0]+b.maxM[0])/2,cy=(b.minM[1]+b.maxM[1])/2,m=Math.max(b.maxM[0]-b.minM[0],b.maxM[1]-b.minM[1]);camera.position.set(cx,m*0.9,-cy+m*0.8);controls.target.set(cx,0,-cy);
  const r=(explicitCamera==='overview'?null:homeRegion(explicitCamera==='cell'?{...lf,preset:{...lf.preset,view:'arm_cell'}}:lf))??(lf.world||isMobilePreset(lf.preset.id)?[{min:[b.minM[0],b.minM[1],0] as [number,number,number],max:[b.maxM[0],b.maxM[1],1.2] as [number,number,number]}]:null);
  if(r){// the same viewing direction, moved in until every corner of the region's boxes just fits (98 % of the viewport)
   const corners=r.flatMap(q=>[0,1,2,3,4,5,6,7].map(i=>at(i&1?q.max[0]:q.min[0],i&2?q.max[1]:q.min[1],i&4?q.max[2]:q.min[2])));
   const box=new THREE.Box3().setFromPoints(corners),c=box.getCenter(new THREE.Vector3()),dir=camera.position.clone().sub(controls.target).normalize();
   const fits=(d:number)=>{camera.position.copy(c).addScaledVector(dir,d);camera.lookAt(c);camera.updateMatrixWorld();return corners.every(p=>{const q=p.clone().project(camera);return Math.abs(q.x)<=0.98&&Math.abs(q.y)<=0.98&&q.z<1;});};
   let lo=0.5,hi=box.getBoundingSphere(new THREE.Sphere()).radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)*2/Math.min(1,camera.aspect);for(let i=0;i<30;i++){const mid=(lo+hi)/2;if(fits(mid))hi=mid;else lo=mid;}
   fits(hi);controls.target.copy(c);
  }
  userMoved=false;controls.update();render();};
 return {canvas,pose,home,
  attach(next){if(canvas.parentElement!==next)next.replaceChildren(canvas);ro.disconnect();ro.observe(next);resize();},
  update(f,vs,displayPoses){
   lf=f;canvas.setAttribute('aria-label',tr('Bản sao 3D. Chọn vật thể từ danh sách.','3Dツイン。物体リストから選択できます。','3D twin view. Use the entity list to select objects.'));put('worldTick',f.world?String(f.world.record.snapshot.tick):'');put('worldQuality',f.world?.quality??(f.world?'valid':''));put('plantCupsDropped',String(droppedPlantCups(f).length));
   const k=sceneKey(f,vs),o=objectKeys(f);
   if(k!==key){key=k;okeys=o;build(f,vs);}
   else{// the scene stands: only an object whose drawing changed is redrawn (a cup entering the plant's report, a source going stale)
    const changed=[...new Set([...okeys.keys(),...o.keys()])].filter(id=>okeys.get(id)!==o.get(id));okeys=o;
    if(changed.length){for(const id of changed){const x=objs.get(id);if(x){freeOne(x.obj);objs.delete(id);}}
     for(const d of drawn(f))if(changed.includes(d.e.id)){drawOne(d,f,vs);objs.get(d.e.id)?.obj.traverse(m=>{if((m as THREE.Mesh).isMesh){m.castShadow=true;m.receiveShadow=true;}});}
     canvas.dataset.redraws=String(redraws+=changed.length);akey='';fallback();status();}
   }
   // the home framing on a new floor or a preset that frames something else (its arm cell)
   const w=f.preset.project.world,size=`${w.width}x${w.height} ${f.preset.view??''}`;if(size!==floor){floor=size;home();}
   // objects without a pose of their own (cups, a cylinder arm, machines) move with the frame
   for(const {e} of drawn(f)){const o=objs.get(e.id);if(o&&e.kind!=='amr'&&!o.arm&&!e.plant)o.obj.position.copy(at(e.x,e.y,heightOf(e)));}
   drawOverlays(f,vs);drawBeliefs(f);drawAlarms(f);pose(displayPoses??posesOf(f));
  },
  camera(mode){explicitCamera=mode;if(!lf)return;if(mode==='overview'){const original=lf;lf={...lf,preset:{...lf.preset,view:undefined}};home();lf=original;}else if(mode==='cell'){const original=lf;lf={...lf,preset:{...lf.preset,view:'arm_cell'}};home();lf=original;}else this.fit(lf.preset.project.entities.find(e=>e.kind==='amr')?.id??null);},
  fit(id){
   const o=id?objs.get(id)?.obj:undefined,box=new THREE.Box3().setFromObject(o??world);if(box.isEmpty())return;
   const s=box.getBoundingSphere(new THREE.Sphere()),d=Math.max(s.radius,0.3)/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2),dir=camera.position.clone().sub(controls.target).normalize();
   if(id?.startsWith('payload:')){dir.y=0.22;dir.normalize();}// see the cup between trays through the existing one-click Fit action
   controls.target.copy(s.center);camera.position.copy(s.center).addScaledVector(dir,d);userMoved=true;controls.update();render();
  },
  // the shared geometry stays parsed in the page cache, but its GPU buffers (and this renderer's dispose listeners on it) go with this view; a later view re-uploads it
  dispose(){gone=true;loads.get(XARM)?.set?.group.traverse(o=>(o as THREE.Mesh).geometry?.dispose());free(world);free(overlays);free(beliefs);free(alarmsG);alarmIcon?.dispose();objs.clear();anchors.clear();heads.clear();sun.dispose();ro.disconnect();controls.dispose();renderer.dispose();canvas.remove();},
 };
}
