// mock_kinematic AMR plant: footprint grid planner + bounded constant-speed motion at the fixed tick. No dynamics, no network transport.
import type {RobotCommand} from '../../../../contracts/src/index';
import {hashPayload} from '../../../../contracts/src/canonical';
import type {NativeExecutionState,RobotAdapter,RobotEvent,RobotManifest,TargetBinding,ResolvedTarget} from '../../../../robot-adapters/src/contract';
import {TICK_MS} from '../clock';
export const MOCK_AMR={id:'mock_amr',version:'1',model:'mock_kinematic',dynamics:false} as const;
/** Illustrative model parameters (not measured): speed, grid resolution and how long a hold lasts before replanning. */
export const MOCK_AMR_PARAMS={speedMps:0.5,cellM:0.05,maxCells:600,replanAfterTicks:50,provenance:'illustrative'} as const;
export type Rect={id:string;x:number;y:number;width:number;height:number};
export interface Pose2 {x:number;y:number;yawRad:number}
type GoalState=NativeExecutionState['status'];
interface Goal {commandId:string;hash:string;command:RobotCommand;path:[number,number][];state:GoalState;holdTicks:number}
export interface PlantRobot {id:string;radiusM:number|null;pose:Pose2;bootId:string;seq:number;goals:Goal[];lastCompleted:string|null;moving:boolean;hold:string|null;stale:boolean;distanceM:number;
 speedLimitMps?:number;observationFault?:'reorder-observations'|'delay-observation';delayedObservations?:{at:number|null;event:RobotEvent}[];
 /** Map revision the robot reports now, when a fault changed it away from the configured one. */
 mapRevision?:string}
export interface PlantState {width:number;height:number;obstacles:Rect[];injected:Rect[];robots:PlantRobot[];contacts:number;minSeparationM:number|null;maxConcurrentMovers:number;
 /** Hold transitions (cause of every wait and its end), bounded; older checkpoints lack it. */
 holdLog?:{at:string;robotId:string;hold:string|null}[]}
export type PlantFault='collide'|'reboot'|'duplicate-arrival'|'localization-lost'|'map-changed'|'dock-offset'|'reorder-observations'|'delay-observation';
/** Illustrative docking error injected by `dock-offset` (metres along +x). */
export const DOCK_OFFSET_M=0.2;
const rectDistance=(x:number,y:number,o:Rect)=>Math.hypot(x-Math.max(o.x,Math.min(x,o.x+o.width)),y-Math.max(o.y,Math.min(y,o.y+o.height)));
/** Minimal binary heap keyed by (f, cell index) so ties break deterministically. */
function heap(){const a:[number,number][]=[];const less=(i:number,j:number)=>a[i]![0]<a[j]![0]||a[i]![0]===a[j]![0]&&a[i]![1]<a[j]![1];const swap=(i:number,j:number)=>{[a[i],a[j]]=[a[j]!,a[i]!];};
 return {get size(){return a.length;},push(v:[number,number]){a.push(v);for(let i=a.length-1;i>0;){const p=(i-1)>>1;if(!less(i,p))break;swap(i,p);i=p;}},
  pop(){const top=a[0]!,last=a.pop()!;if(a.length){a[0]=last;for(let i=0;;){const l=2*i+1,r=l+1;let m=i;if(l<a.length&&less(l,m))m=l;if(r<a.length&&less(r,m))m=r;if(m===i)break;swap(i,m);i=m;}}return top;}};}
export class MockPlant {
 private listeners=new Map<string,Set<(e:RobotEvent)=>void>>();
 constructor(readonly state:PlantState,readonly nowMs:()=>number,private newBootId:()=>string){}
 robot(id:string){const r=this.state.robots.find(x=>x.id===id);if(!r)throw new Error('PLANT_ROBOT_UNKNOWN');return r;}
 /** Signed clearance of a footprint circle at (x,y): walls, static + injected obstacles and (optionally) other robots. Negative = overlap. */
 clearance(x:number,y:number,radius:number,robots?:string):number {
  const s=this.state;let c=Math.min(x,y,s.width-x,s.height-y)-radius;
  for(const o of s.obstacles)c=Math.min(c,rectDistance(x,y,o)-radius);
  for(const o of s.injected)c=Math.min(c,rectDistance(x,y,o)-radius);
  if(robots!==undefined)for(const r of s.robots)if(r.id!==robots)c=Math.min(c,Math.hypot(x-r.pose.x,y-r.pose.y)-radius-(r.radiusM??0));
  return c;
 }
 /** A* over a footprint-inflated grid (8-connected, no corner cutting). Start cell always passable; goal checked at its exact point. */
 plan(r:PlantRobot,gx:number,gy:number,avoidRobots:boolean):[number,number][]|null {
  const rad=r.radiusM??0,{width:W,height:H}=this.state,cell=Math.max(MOCK_AMR_PARAMS.cellM,Math.max(W,H)/MOCK_AMR_PARAMS.maxCells),nx=Math.ceil(W/cell),ny=Math.ceil(H/cell);
  const others=avoidRobots?r.id:undefined;
  if(this.clearance(gx,gy,rad,others)<0)return null;
  const at=(x:number,y:number)=>Math.min(ny-1,Math.max(0,Math.floor(y/cell)))*nx+Math.min(nx-1,Math.max(0,Math.floor(x/cell)));
  const start=at(r.pose.x,r.pose.y),goal=at(gx,gy),memo=new Int8Array(nx*ny);
  const free=(i:number)=>{if(i===start||i===goal)return true;if(!memo[i])memo[i]=this.clearance((i%nx+0.5)*cell,(Math.floor(i/nx)+0.5)*cell,rad,others)>=0?1:2;return memo[i]===1;};
  const g=new Float64Array(nx*ny).fill(Infinity),from=new Int32Array(nx*ny).fill(-1),open=heap();
  const h=(i:number)=>{const dx=Math.abs(i%nx-goal%nx),dy=Math.abs(Math.floor(i/nx)-Math.floor(goal/nx));return Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy);};
  g[start]=0;open.push([h(start),start]);
  while(open.size){
   const [f,i]=open.pop();if(i===goal)break;if(f>g[i]!+h(i)+1e-9)continue;
   const x=i%nx,y=Math.floor(i/nx);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=nx||Y>=ny)continue;
    const j=Y*nx+X;if(!free(j)||dx&&dy&&(!free(y*nx+X)||!free(Y*nx+x)))continue;
    const cost=g[i]!+(dx&&dy?Math.SQRT2:1);if(cost<g[j]!){g[j]=cost;from[j]=i;open.push([cost+h(j),j]);}
   }
  }
  if(goal!==start&&from[goal]===-1)return null;
  const cells:number[]=[];for(let i=goal;i!==start&&i!==-1;i=from[i]!)cells.unshift(i);
  const pts:[number,number][]=cells.slice(0,-1).map(i=>[(i%nx+0.5)*cell,(Math.floor(i/nx)+0.5)*cell]);pts.push([gx,gy]);
  // Drop collinear interior points; the path stays on the same grid lines.
  return pts.filter((p,k)=>{const a=k?pts[k-1]!:[r.pose.x,r.pose.y],b=pts[k+1];return !b||Math.abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))>1e-12;});
 }
 listen(id:string,l:(e:RobotEvent)=>void){const set=this.listeners.get(id)??new Set();set.add(l);this.listeners.set(id,set);return ()=>set.delete(l);}
 emit(r:PlantRobot,type:RobotEvent['type'],goal:Goal,extra:Record<string,string>={}){
  r.seq++;const c=goal.command;
  const e:RobotEvent={type,id:`${r.bootId}-${r.seq}`,commandId:goal.commandId,bootId:r.bootId,sequence:String(r.seq),observedAt:new Date(this.nowMs()).toISOString(),payload:{robotId:c.robotId,missionId:c.missionId,missionRevision:c.missionRevision,controlEpoch:c.controlEpoch,simulated:true,model:MOCK_AMR.model,...extra}};
  if(r.observationFault){const mode=r.observationFault;delete r.observationFault;(r.delayedObservations??=[]).push({at:mode==='reorder-observations'&&type==='accepted'?null:this.nowMs()+2000,event:e});return;}
  this.deliver(r,e);
  // Reordering preserves the original identity/sequence: deliver a later real observation first, then the retained earlier one.
  for(const delayed of r.delayedObservations??[])if(delayed.at===null)this.deliver(r,delayed.event);
  r.delayedObservations=r.delayedObservations?.filter(x=>x.at!==null);
 }
 private deliver(r:PlantRobot,e:RobotEvent){for(const l of this.listeners.get(r.id)??[])l(e);}
 /** One fixed tick for every robot, in entity-id order. Completion comes only from reaching the modeled goal. */
 advance(){
  const s=this.state,known=s.robots.every(r=>r.radiusM!==null);
  let movers=0;const before=new Map(s.robots.map(r=>[r.id,r.hold]));
  for(const r of [...s.robots].sort((a,b)=>a.id<b.id?-1:1)){
   for(const delayed of r.delayedObservations??[])if(delayed.at!==null&&delayed.at<=this.nowMs())this.deliver(r,delayed.event);
   r.delayedObservations=r.delayedObservations?.filter(x=>x.at===null||x.at>this.nowMs());
   r.moving=false;const goal=r.goals.find(g=>g.state==='executing');if(!goal||r.stale)continue;
   const step=Math.min(MOCK_AMR_PARAMS.speedMps,r.speedLimitMps??Infinity,goal.command.limits.speedLimitMps??Infinity)*TICK_MS/1000;
   const rad=r.radiusM??0;
   if(this.clearance(r.pose.x,r.pose.y,rad)<0){s.contacts++;goal.state='failed';r.hold='CONTACT';this.emit(r,'failed',goal,{reason:'CONTACT'});continue;}
   let x=r.pose.x,y=r.pose.y,left=step;const path=goal.path.map(p=>[...p] as [number,number]);
   while(left>0&&path.length){const [px,py]=path[0]!,d=Math.hypot(px-x,py-y);if(d<=left){x=px;y=py;left-=d;path.shift();}else{x+=(px-x)/d*left;y+=(py-y)/d*left;left=0;}}
   if(this.clearance(x,y,rad,r.id)<0){
    r.hold=this.clearance(x,y,rad)<0?'PATH_BLOCKED':'ROBOT_AHEAD';
    if(++goal.holdTicks>=MOCK_AMR_PARAMS.replanAfterTicks){const t=goal.command.target as {x:number;y:number},p=this.plan(r,t.x,t.y,true);goal.holdTicks=0;if(p)goal.path=p;else{goal.state='failed';this.emit(r,'failed',goal,{reason:'NO_PATH'});}}
    continue;
   }
   const d=Math.hypot(x-r.pose.x,y-r.pose.y);if(d>0)r.pose={x,y,yawRad:Math.atan2(y-r.pose.y,x-r.pose.x)};
   r.distanceM+=d;goal.path=path;goal.holdTicks=0;r.hold=null;r.moving=d>0;if(r.moving)movers++;
   if(!path.length){goal.state='completed';r.lastCompleted=goal.commandId;this.emit(r,'completed',goal);}
  }
  // Inter-robot footprint separation, in metres. World clearance is a different quantity used by the planner above.
  // Include stationary robots and holds; with fewer than two robots there is no pair to measure.
  if(known)for(let i=0;i<s.robots.length;i++)for(let j=i+1;j<s.robots.length;j++){
   const a=s.robots[i]!,b=s.robots[j]!,sep=Math.hypot(a.pose.x-b.pose.x,a.pose.y-b.pose.y)-a.radiusM!-b.radiusM!;
   s.minSeparationM=s.minSeparationM===null?sep:Math.min(s.minSeparationM,sep);
  }
  s.maxConcurrentMovers=Math.max(s.maxConcurrentMovers,movers);
  for(const r of s.robots)if(r.hold!==before.get(r.id)){(s.holdLog??=[]).push({at:new Date(this.nowMs()).toISOString(),robotId:r.id,hold:r.hold});if(s.holdLog.length>1000)s.holdLog.shift();}
 }
 fault(id:string,fault:PlantFault){
  const r=this.robot(id);
  if(fault==='reorder-observations'||fault==='delay-observation')r.observationFault=fault;
  else if(fault==='collide')this.state.injected.push({id:`contact-${this.state.injected.length+1}`,x:r.pose.x-0.15,y:r.pose.y-0.15,width:0.3,height:0.3});
  else if(fault==='reboot'){r.bootId=this.newBootId();r.seq=0;for(const g of r.goals)if(g.state==='executing'){g.state='unknown';r.moving=false;this.emit(r,'unknown',g,{reason:'OBSERVER_REBOOT'});}}
  else if(fault==='localization-lost'||fault==='map-changed'){
   // the robot no longer knows where it is on the configured map: last pose is stale, the running goal's outcome is unknown, nothing re-drives it
   if(fault==='map-changed')r.mapRevision=`${r.mapRevision??'configured'}+changed`;
   r.stale=true;r.moving=false;for(const g of r.goals)if(g.state==='executing'){g.state='unknown';this.emit(r,'unknown',g,{reason:fault==='map-changed'?'MAP_CHANGED':'LOCALIZATION_LOST'});}
  }
  else if(fault==='dock-offset')r.pose={...r.pose,x:Math.min(this.state.width,r.pose.x+DOCK_OFFSET_M)};
  else{const g=r.goals.find(x=>x.commandId===r.lastCompleted);if(g)this.emit(r,'completed',g);}
 }
 /** After a runner crash the in-flight goal of this boot is lost: report it unknown under the new boot, never re-drive it. */
 reportLost(id:string,command:RobotCommand){const r=this.robot(id),goal:Goal={commandId:command.commandId,hash:hashPayload(command as never),command,path:[],state:'unknown',holdTicks:0};r.goals.push(goal);this.emit(r,'unknown',goal,{reason:'RECOVERY_UNKNOWN'});}
}
/** RobotAdapter over one plant robot. Simulator profile only (adapter 'simulator', validation 'simulated'); it owns pose and path in the plant. */
export class MockAmrAdapter implements RobotAdapter {
 readonly model=MOCK_AMR.model;
 constructor(private plant:MockPlant,private manifest:RobotManifest){if(manifest.validation!=='simulated'||manifest.adapter!=='simulator')throw new Error('SIMULATION_PROFILE_REQUIRED');}
 private get r(){return this.plant.robot(this.manifest.id);}
 async describe(){return structuredClone(this.manifest);}
 async resolveTarget(t:TargetBinding):Promise<ResolvedTarget>{
  if(t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)throw new Error('MAP_MISMATCH');
  if(!Number.isFinite(t.x)||!Number.isFinite(t.y))throw new Error('INVALID_TARGET');
  return {kind:'ros',mapId:t.mapId,mapRevision:t.mapRevision,frame:t.frame,x:t.x!,y:t.y!,yaw:t.yaw??0};
 }
 async estimateReachability(t:ResolvedTarget){
  if(t.kind!=='ros'||t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)return {reachable:false,reason:'MAP_MISMATCH'};
  if(this.r.stale)return {reachable:false,reason:'LOCALIZATION_LOST'};
  const p=this.plant.plan(this.r,t.x,t.y,false),len=p?p.reduce((a,q,i)=>a+Math.hypot(q[0]-(i?p[i-1]![0]:this.r.pose.x),q[1]-(i?p[i-1]![1]:this.r.pose.y)),0):0;
  return p?{reachable:true,reason:'OK',etaMs:Math.ceil(len/MOCK_AMR_PARAMS.speedMps*1000)}:{reachable:false,reason:'UNREACHABLE'};
 }
 async execute(command:RobotCommand){
  const r=this.r,hash=hashPayload(command as never),old=r.goals.find(g=>g.commandId===command.commandId);
  if(old){if(old.hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return {accepted:old.state!=='failed',nativeGoalId:command.commandId,unknown:old.state==='unknown'};}
  if(Date.parse(command.expiresAt)<=this.plant.nowMs())return {accepted:false,unknown:false,reason:'EXPIRED_COMMAND'};
  const t=command.target as {mapId:string;mapRevision:string;x?:number;y?:number};
  if(t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)return {accepted:false,unknown:false,reason:'MAP_MISMATCH'};
  // the robot reports another map than the command was bound to: refuse with an observation so the source records why (no coordinates from an old map)
  if(r.mapRevision!==undefined&&r.mapRevision!==t.mapRevision){const g:Goal={commandId:command.commandId,hash,command:structuredClone(command),path:[],state:'failed',holdTicks:0};r.goals.push(g);this.plant.emit(r,'rejected',g,{reason:'MAP_MISMATCH'});return {accepted:false,unknown:false,reason:'MAP_MISMATCH'};}
  if(command.robotId!==this.manifest.id)return {accepted:false,unknown:false,reason:'ROBOT_MISMATCH'};
  if(r.stale){const g:Goal={commandId:command.commandId,hash,command:structuredClone(command),path:[],state:'failed',holdTicks:0};r.goals.push(g);this.plant.emit(r,'rejected',g,{reason:'LOCALIZATION_LOST'});return {accepted:false,unknown:false,reason:'LOCALIZATION_LOST'};}
  if(r.goals.some(g=>g.state==='executing'))return {accepted:false,unknown:false,reason:'GOAL_ACTIVE'};
  const path=Number.isFinite(t.x)&&Number.isFinite(t.y)?this.plant.plan(r,t.x!,t.y!,false):null;
  const goal:Goal={commandId:command.commandId,hash,command:structuredClone(command),path:path??[],state:path?'executing':'failed',holdTicks:0};r.goals.push(goal);
  if(!path){this.plant.emit(r,'rejected',goal,{reason:'UNREACHABLE'});return {accepted:false,unknown:false,reason:'UNREACHABLE'};}
  this.plant.emit(r,'accepted',goal);return {accepted:true,nativeGoalId:command.commandId,unknown:false};
 }
 async cancel(commandId:string){
  const r=this.r,g=r.goals.find(x=>x.commandId===commandId);
  if(!g)return {acknowledged:false,unknown:true};
  if(g.state!=='executing')return {acknowledged:false,unknown:g.state==='unknown'};
  g.state='cancelled';r.moving=false;this.plant.emit(r,'cancelled',g);return {acknowledged:true,unknown:false};
 }
 async requestStop(reason:string){
  if(!reason)throw new Error('STOP_REASON_REQUIRED');
  const r=this.r;for(const g of r.goals)if(g.state==='executing'){g.state='unknown';r.moving=false;this.plant.emit(r,'unknown',g,{reason:'STOP_REQUESTED'});}
  return {acknowledged:true,physicalStopConfirmed:false};
 }
 observe(l:(e:RobotEvent)=>void){return this.plant.listen(this.manifest.id,l);}
 async reconcile(commandId:string):Promise<NativeExecutionState>{const g=this.r.goals.find(x=>x.commandId===commandId);return {status:g?.state??'unknown',evidence:{simulated:true,model:MOCK_AMR.model,bootId:this.r.bootId}};}
}
