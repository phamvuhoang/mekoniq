import {mapExtent,worldEntities,type WorldDrawing} from './world-view';
import {payloadState,payloadMatches,type PayloadBundle,type PayloadState} from './payload';
// renderTwin(snapshot, viewState): a read-only 2D plan of one run (or of the preset before a run). It draws what the runtime reported;
// it never moves anything, decides arrival or authorises an action. The 3D view (viewer/twin3d) consumes the same frame and view state.
import type {RunReport,RunView} from '../scenarios/controls';
import {nameOf,type TwinPreset} from '../scenarios/catalog';
import type {Layers} from './overlays';
import {amrFootprint,assetOf,runtimeResolved} from './amr';
import {cellLayout,cupLocation,jobsOf} from './coffee-cell';
import {esc} from '../ui/icons';
import {tr} from '../i18n';
import {stateLabel} from '../ui/labels';
import type {Held} from './store';
import type {NavigationSceneV1} from '../shared/navigation2d';
import {footprintInMap,scanLayer,type ScanSample} from './lidar';
import {layerProvenance} from './overlays';
import {plantCupPose} from './arm/arm-telemetry';
export interface TwinFrame {world?:WorldDrawing;extent?:{minM:number[];maxM:number[]};preset:TwinPreset;view:RunView|null;report:RunReport|null;seen?:Record<string,number>;/** latest telemetry per entity from the browser store (plan 03: arm joints) */samples?:Record<string,Held>;nowMs?:number;
 /** IR-SIM 2D runs: the run bundle's compiled navigation scene (footprints, sensors, obstacles) and, for imported evidence only, scans with their own-tick poses. */
 payloadBundle?:PayloadBundle|null;navigation?:NavigationSceneV1|null;scans?:{scans:ScanSample[]};
 /** Replay: entities with recorded samples but none drawn at the cursor (before their first one, or in a recorded gap); drawn as without telemetry. */unrecorded?:string[]}
export interface ViewState {view:'2d'|'3d';layers:Layers;selected:string|null}
export interface SceneEntity {cupGeometry?:{radiusM:number;heightM:number};id:string;kind:string;name:string;x:number;y:number;/** AMR only, from a 3D plant: base height, roll and pitch */pose3d?:{z:number;rollRad:number;pitchRad:number};yawRad?:number;source:'observed'|'modeled'|'derived'|'unknown';status?:string;/** world frame held past its freshness while the run is running: the last committed pose, not a live one */stale?:true;
 /** Cup only: its pose in the map as the MuJoCo plant reports it (drawn there instead of at its custodian) */payload?:PayloadState;plant?:{positionM:[number,number,number];quaternionXyzw:[number,number,number,number]}}
/** Plant cup samples older than the plant's newest sample by more than this (sim time) have stopped: the cup left the cell and is drawn by custody again. */
const PLANT_CUP_STOPPED_NS=1e9;
/** Cups the plant currently reports that the run view does not list: not drawn (a cup is never invented), counted so a test can see none is lost. */
export function droppedPlantCups(f:TwinFrame):string[]{
 const listed=new Set((f.view?.coffee?.cups??[]).map(c=>c.cupId));
 return Object.keys(f.samples??{}).filter(id=>!listed.has(id)&&plantCup(f,id)).sort();
}
/** The cup's plant pose while the plant still reports it. */
function plantCup(f:TwinFrame,cupId:string){
 const s=f.samples?.[cupId],p=plantCupPose(s);if(!p||s!.simTimeNs===null)return null;
 const newest=Math.max(...Object.values(f.samples??{}).filter(x=>x.providerId==='mujoco_arm'&&x.simTimeNs!==null).map(x=>Number(x.simTimeNs)));
 return newest-Number(s!.simTimeNs)>PLANT_CUP_STOPPED_NS?null:p;
}
const S=100;
/** Observed path from the lossy telemetry: one polyline per run of consecutive samples; a jump in sim time larger than two sample periods is a gap and is
 * never joined (so no distance is drawn across it). */
export function observedSegments(f:TwinFrame,entityId:string):[number,number][][]{
 const t=f.report?.telemetry,period=t&&t.rateHz>0?1e9/t.rateHz:NaN,out:[number,number][][]=[];let last:bigint|null=null;
 for(const s of (t?.samples??[]).filter(x=>x.entityId===entityId&&x.quality==='valid'&&x.simTimeNs!==null&&typeof x.observed?.xM==='number').sort((a,b)=>BigInt(a.seq)<BigInt(b.seq)?-1:1)){
  const now=BigInt(s.simTimeNs!);
  if(last===null||!Number.isFinite(period)||Number(now-last)>2*period)out.push([]);
  out[out.length-1]!.push([s.observed!.xM as number,s.observed!.yM as number]);last=now;
 }
 return out.filter(x=>x.length>1);
}
/** Everything selectable, with where it is drawn. Shared by the 2D plan, the 3D view and the entity list so selection means the same thing. */
export function sceneEntities(f:TwinFrame):SceneEntity[] {
 if(f.world)return worldEntities(f.world);
 if(f.preset.id==='mujoco-cell')return [];
 const p=f.preset.project,l=cellLayout(p),v=f.view,out:SceneEntity[]=[];
 const parking=p.world.points.filter(x=>x.kind==='parking').sort((a,b)=>a.id<b.id?-1:1);
 p.entities.filter(e=>e.kind==='amr').forEach((e,i)=>{
  const o=v?.entities.find(r=>r.kind==='amr'&&r.id===e.id),park=parking[i];
  if(o)out.push({id:e.id,kind:'amr',name:nameOf(f.preset,e.id),x:o.pose.x,y:o.pose.y,yawRad:o.pose.yawRad,...o.pose.z!==undefined?{pose3d:{z:o.pose.z,rollRad:o.pose.rollRad!,pitchRad:o.pose.pitchRad!}}:{},source:o.quality==='valid'?'observed':'unknown',status:o.moving?'moving':o.hold??'stopped'});
  else if(park)out.push({id:e.id,kind:'amr',name:nameOf(f.preset,e.id),x:park.x,y:park.y,source:'modeled',status:'planned'});
 });
 if(l)for(const e of p.entities){
  const at=e.kind==='coffee_machine'?l.machine:e.kind==='arm'?l.arm:e.kind==='cup_station'?l.cups:null;
  if(at)out.push({id:e.id,kind:e.kind,name:nameOf(f.preset,e.id),x:at.x,y:at.y,source:'derived'});
 }
 if(v&&l)jobsOf(v).forEach((j,i)=>out.push({id:j.jobId,kind:'job',name:j.jobId,x:l.machine.x-0.3+i*0.3,y:l.machine.y+0.42,source:'observed',status:j.status}));
 // a cup the plant reports is drawn where the plant has it; any other by its custodian (one entry per cup either way)
 if(v)for(const c of v.coffee?.cups??[]){const q=plantCup(f,c.cupId),at=q?{x:q.positionM[0],y:q.positionM[1]}:cupLocation(c,p,v);out.push({id:c.cupId,kind:'cup',name:c.cupId,x:at?.x??NaN,y:at?.y??NaN,source:at?'observed':'unknown',status:`${c.ownerKind}:${c.ownerId}`,...q?{plant:q}:{}});}
 // Free simulation payloads are observed entities, independent of the coffee ledger.
 for(const s of Object.values(f.samples??{})){const q=payloadState(s);if(!q||f.unrecorded?.includes(s.entityId)||!f.payloadBundle||!payloadMatches(q,f.payloadBundle))continue;
 out.push({id:s.entityId,kind:'payload',name:q.propId,x:q.positionM[0],y:q.positionM[1],source:s.quality==='valid'?'observed':'unknown',status:s.quality==='valid'?tr('Tải tự do · mô phỏng','自由荷物 · シミュレーション','Free load · simulation'):tr('Tư thế đã ghi · đóng băng','記録姿勢 · 固定','Recorded pose · frozen'),plant:q,payload:q});}
 return out;
}
const kindLabel=(k:string)=>({amr:'AMR',arm:tr('Cánh tay','アーム','Arm'),coffee_machine:tr('Máy pha','コーヒーマシン','Coffee machine'),cup_station:tr('Trạm cốc','カップ置場','Cup station'),payload:tr('Tải mô phỏng','模擬荷物','Simulation load'),job:tr('Công việc','ジョブ','Job'),cup:tr('Cốc','カップ','Cup')})[k]??k;
export {kindLabel};
export function renderTwin(f:TwinFrame,vs:ViewState):string {
 const p=f.preset.project,w=p.world,v=f.view,extent=mapExtent(f),X=(x:number)=>x*S,Y=(y:number)=>(extent.maxM[1]-y)*S,pt=(x:number,y:number)=>`${X(x).toFixed(1)},${Y(y).toFixed(1)}`;
 const ents=sceneEntities(f),sel=vs.selected,L=vs.layers;
 const grid=Array.from({length:Math.floor(w.width)+1},(_,n)=>`<text x="${X(n)}" y="-8" text-anchor="middle" class="tw-axis">${n} m</text>`).join('');
 const obstacles=w.obstacles.map(o=>`<rect class="tw-obstacle" x="${X(o.x)}" y="${Y(o.y+o.height)}" width="${o.width*S}" height="${o.height*S}" rx="4"><title>${esc(o.id)} · ${tr('mô hình','モデル','modeled')}</title></rect>${L.contacts?`<rect class="tw-clearance" x="${X(o.x)-8}" y="${Y(o.y+o.height)-8}" width="${o.width*S+16}" height="${o.height*S+16}" rx="10"/>`:''}`).join('');
 const points=w.points.map(q=>`<g class="tw-point" transform="translate(${pt(q.x,q.y)})"><circle r="5"/><text y="20" text-anchor="middle">${esc(nameOf(f.preset,q.id))}</text></g>`).join('');
 let overlay='';const nav=f.navigation;
 if(nav){
  // compiled obstacles are what the plant collides with; table points stay icons, so a decorative table is never mistaken for geometry
  overlay+=nav.world.obstacles.map(o=>`<polygon class="tw-compiled-obstacle" points="${o.verticesM.map(v=>pt(v[0]!,v[1]!)).join(' ')}"><title>${esc(o.id)} · ${tr('vật cản đã compile','コンパイル済み障害物','compiled obstacle')}</title></polygon>`).join('');
  for(const e of ents.filter(x=>x.kind==='amr')){
   const model=nav.robots.find(r=>r.robotId===e.id)?.model,pose=v?.entities.find(r=>r.kind==='amr'&&r.id===e.id)?.pose??{x:e.x,y:e.y,yawRad:0};
   if(!model){overlay+=`<text class="tw-unknown-label" x="${X(e.x)}" y="${Y(e.y)-36}" text-anchor="middle">? ${tr('không có mô hình compile','コンパイル済みモデルなし','no compiled model')}</text>`;continue;}
   if(L.footprint)overlay+=`<polygon class="tw-footprint" data-layer="footprint" points="${footprintInMap(model,pose).map(([x,y])=>pt(x,y)).join(' ')}"><title>${esc(layerProvenance('footprint'))}</title></polygon>`;
   if(L.safety)overlay+=`<polygon class="tw-safety" data-layer="safety" points="${footprintInMap(model,pose,nav.policy.parameters.safetyMarginM).map(([x,y])=>pt(x,y)).join(' ')}"><title>${esc(layerProvenance('safety'))}</title></polygon>`;
   if(L.observed)for(const seg of observedSegments(f,e.id))overlay+=`<polyline class="tw-observed" data-layer="observed" points="${seg.map(([x,y])=>pt(x,y)).join(' ')}"><title>${esc(layerProvenance('observed'))}</title></polyline>`;
  }
  if(L.scan){const s=scanLayer(f.scans);overlay+=s.available?s.scans.map(x=>x.hitPointsM.map(([px,py])=>`<circle class="tw-scan" data-layer="scan" cx="${X(px).toFixed(1)}" cy="${Y(py).toFixed(1)}" r="2"/>`).join('')).join(''):`<text class="tw-unknown-label" data-testid="scan-unavailable" x="${X(w.width)-6}" y="${Y(w.height)+18}" text-anchor="end">LiDAR: ${esc(s.reason!)}</text>`;}
  if(L.path)overlay+=`<text class="tw-unknown-label" x="6" y="${Y(w.height)+18}">${esc(layerProvenance('path'))}</text>`;
 }
 if(L.footprint&&!nav)for(const e of ents){
  if(e.kind!=='amr')continue;
  const pose=v?.entities.find(r=>r.kind==='amr'&&r.id===e.id)?.pose??{x:e.x,y:e.y,yawRad:0},poly=amrFootprint(assetOf(p,f.preset.assets,e.id),pose),resolved=runtimeResolved(f.report,p,e.id);
  overlay+=poly?`<polygon class="tw-footprint ${resolved===false?'unknown':''}" points="${poly.map(([x,y])=>pt(x,y)).join(' ')}"><title>${resolved===false?tr('Footprint của Lab; runtime chạy mô hình điểm (chưa rõ)','Labの形状。ランタイムは点モデル(不明)','Lab footprint; the runtime ran a point model (unknown)'):tr('Footprint mô hình','モデル形状','Modeled footprint')}</title></polygon>${resolved===false?`<text class="tw-unknown-label" x="${X(pose.x)}" y="${Y(pose.y)-34}" text-anchor="middle">? ${tr('hình học runtime','実行時形状','runtime geometry')}</text>`:''}`
   :`<circle class="tw-footprint unknown" cx="${X(pose.x)}" cy="${Y(pose.y)}" r="30"/><text class="tw-unknown-label" x="${X(pose.x)}" y="${Y(pose.y)-36}" text-anchor="middle">? footprint</text>`;
 }
 if(L.path&&v)for(const r of v.entities)if(r.path.length)overlay+=`<polyline class="tw-path" points="${[[r.pose.x,r.pose.y],...r.path].map(([x,y])=>pt(x!,y!)).join(' ')}"><title>${tr('Đường đi đã lệnh','指令経路','Commanded path')}</title></polyline><circle class="tw-goal" cx="${X(r.path[r.path.length-1]![0])}" cy="${Y(r.path[r.path.length-1]![1])}" r="7"/>`;
 if(L.contacts){const c=f.report?.metrics.collision,n=f.report?.metrics.navigation;if(nav&&n)overlay+=`<text class="tw-contacts" x="${X(w.width)-6}" y="${Y(0)-28}" text-anchor="end">${tr('Đợt va chạm / vùng an toàn','衝突/安全エンベロープ','Collision / safety episodes')}: ${esc(n.collisionEpisodes??'?')} / ${esc(n.safetyEnvelopeEpisodes??'?')}</text>`;overlay+=`<text class="tw-contacts" x="${X(w.width)-6}" y="${Y(0)-8}" text-anchor="end">${tr('Tiếp xúc','接触','Contacts')}: ${!c?'—':c.available?esc(c.contacts):`? (${esc(c.reason??'unknown')})`}</text>`;}
 if(L.frames){
  const axes=(x:number,y:number,yaw:number,label:string)=>{const c=Math.cos(yaw),s=Math.sin(yaw);return `<g class="tw-frame"><line x1="${X(x)}" y1="${Y(y)}" x2="${X(x+0.35*c)}" y2="${Y(y+0.35*s)}" class="x"/><line x1="${X(x)}" y1="${Y(y)}" x2="${X(x-0.35*s)}" y2="${Y(y+0.35*c)}" class="y"/><text x="${X(x+0.4*c)}" y="${Y(y+0.4*s)}">x</text><text x="${X(x-0.4*s)}" y="${Y(y+0.4*c)}">y</text><text x="${X(x)+6}" y="${Y(y)+16}" class="tw-frame-name">${esc(label)}</text></g>`;};
  overlay+=axes(0,0,0,'map');
  for(const r of v?.entities??[])overlay+=axes(r.pose.x,r.pose.y,r.pose.yawRad,`${r.id}/base_link`);
  for(const h of w.handoffPoints??[])overlay+=h.yawRad===null?`<text class="tw-unknown-label" x="${X(h.position[0]!)}" y="${Y(h.position[1]!)+30}">${esc(h.id)} · yaw ?</text>`:axes(h.position[0]!,h.position[1]!,h.yawRad,h.id);
 }
 const marks=ents.filter(e=>Number.isFinite(e.x)).map(e=>{
  const on=e.id===sel,label=`${kindLabel(e.kind)} ${e.name}${e.status?` · ${stateLabel(e.status)}`:''}`;
  const shape=e.kind==='amr'?`<circle r="17" class="tw-amr ${e.source}"/><path d="m-6 5 6-12 6 12" class="tw-amr-nose"/>`
   :e.kind==='coffee_machine'?`<rect x="-22" y="-16" width="44" height="32" rx="5" class="tw-cell ${e.source}"/><text y="4" text-anchor="middle" class="tw-glyph" aria-hidden="true">CM</text>`
   :e.kind==='arm'?`<circle r="14" class="tw-cell ${e.source}"/>`
   :e.kind==='cup_station'?`<rect x="-12" y="-12" width="24" height="24" rx="4" class="tw-cell ${e.source}"/>`
   :(e.kind==='cup'||e.kind==='payload')?`<circle r="8" class="tw-cup ${e.source}"/>`
   :`<rect x="-13" y="-9" width="26" height="18" rx="4" class="tw-job ${e.status==='needs_attention'?'attention':''}"/><text y="4" text-anchor="middle" class="tw-glyph" aria-hidden="true">${e.status==='needs_attention'?'!':esc(e.id.split('-').pop()!)}</text>`;
  const rot=e.kind==='amr'?` rotate(${-((v?.entities.find(r=>r.kind==='amr'&&r.id===e.id)?.pose.yawRad??0)*180/Math.PI-90)})`:'';
  return `<g id="tw-entity-${esc(e.id)}" class="tw-entity ${on?'selected':''}" data-action="twin-pick" data-value="${esc(e.id)}" data-entity="${esc(e.id)}" data-selected="${on}" data-source="${e.source}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(label)}" transform="translate(${pt(e.x,e.y)})">${on?'<circle r="27" class="tw-ring"/>':''}<g transform="${rot.trim()||'rotate(0)'}">${shape}</g>${e.kind==='cup'||e.kind==='job'?'':`<text y="${e.kind==='amr'?-26:e.kind==='cup_station'?-18:30}" text-anchor="${e.kind==='cup_station'?'end':'middle'}" class="tw-name">${esc(e.name)}</text>`}<title>${esc(label)}</title></g>`;
 }).join('');
 return `<svg class="twin-plan" viewBox="${extent.minM[0]*S-30} -30 ${(extent.maxM[0]-extent.minM[0])*S+60} ${(extent.maxM[1]-extent.minM[1])*S+60}" role="group" aria-label="${esc(tr(`Mặt bằng twin ${w.width} × ${w.height} m`,`ツイン平面図 ${w.width} × ${w.height} m`,`Twin plan ${w.width} × ${w.height} m`))}"><rect class="tw-floor" x="${extent.minM[0]*S}" width="${(extent.maxM[0]-extent.minM[0])*S}" height="${(extent.maxM[1]-extent.minM[1])*S}"/>${grid}${obstacles}${points}${overlay}${marks}</svg>`;
}
