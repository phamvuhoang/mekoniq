import {convexHull,grow,place,pointDistance,polygonsOverlap,sweptHulls,wrapPi,isConvex} from './geometry';
import type {P,Pose2} from './geometry';
import type {IRSimSnapshotV1,NavigationSceneV1} from './contracts';

/** Controller identity recorded with every run's evidence; bump the version with any change that can move a trajectory. */
export const NAVIGATION_CONTROLLER={id:'grid-diff-v1',version:'1'} as const;
export type DecisionStatus='executing'|'arrived'|'blocked'|'no_path'|'cancelled';
export interface Decision{robotId:string;commandId:string;status:DecisionStatus;reason:string|null}
export interface Velocity{robotId:string;vMps:number;omegaRadps:number}
export interface NavigationController{
 setGoal(input:{robotId:string;commandId:string;target:[number,number,number]}):void;
 cancel(robotId:string,commandId:string):void;
 /** One tick: observations of tick t in, bounded body velocities for every robot out (idle is explicit zero). */
 advance(snapshot:IRSimSnapshotV1,reservations:Readonly<Record<string,string|null>>):{velocities:Velocity[];decisions:Decision[]};
}
const DT=0.02,TURN_TOL=0.01,LEG_TOL=0.02,EPS=1e-9;
type Step={kind:'rotate';yaw:number}|{kind:'translate';to:[number,number]};
type Plan={ok:true;steps:Step[]}|{ok:false;reason:'no_path'|'PLANNER_BUDGET_EXCEEDED'};
/** More unusable beams than this and the scan says nothing reliable about the way ahead. */
const MAX_INVALID_BEAM_FRACTION=0.1;
interface Goal{commandId:string;target:Pose2;startTick:number|null;steps:Step[]|null;stepIndex:number;hold:number;best:number;stagnant:number;lastPlanTick:number;zonesKey:string;waiting:boolean;/** the goal is reachable on the static map alone: a later failure is a reservation to wait for, never no_path */staticOk?:boolean;/** the local route is hidden only by a zone that is not (or no longer) granted */zoneWait?:boolean}

/** Binary min-heap ordered by (f, g, x, y, heading): equal costs break the same way on every run. */
class Heap{
 private a:{f:number;g:number;x:number;y:number;h:number;id:number}[]=[];
 get size(){return this.a.length;}
 private less(p:Heap['a'][number],q:Heap['a'][number]){return p.f-q.f||p.g-q.g||p.x-q.x||p.y-q.y||p.h-q.h;}
 push(n:Heap['a'][number]){const a=this.a;a.push(n);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(this.less(a[i]!,a[p]!)>=0)break;[a[i],a[p]]=[a[p]!,a[i]!];i=p;}}
 pop(){const a=this.a,top=a[0]!,last=a.pop()!;if(a.length){a[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<a.length&&this.less(a[l]!,a[m]!)<0)m=l;if(r<a.length&&this.less(a[r]!,a[m]!)<0)m=r;if(m===i)break;[a[i],a[m]]=[a[m]!,a[i]!];i=m;}}return top;}
}

/**
 * grid-diff-v1: a known-map SE2 lattice planner (8 headings, forward and rotate edges, swept footprint plus margin) with a rotate-translate-rotate follower. The map is known; LiDAR
 * only adds dynamic obstacles. It sends bounded body velocities and never uses an engine goal behavior. Limits are the fixture policy, not a hardware braking certificate.
 */
export function createNavigationController(scene:NavigationSceneV1):NavigationController{
 const pol=scene.policy.parameters,margin=pol.safetyMarginM,res=pol.gridResolutionM,H=pol.headingCount,W=scene.world.widthM,Hm=scene.world.heightM;
 const nx=Math.round(W/res)+1,ny=Math.round(Hm/res)+1;
 const statics=[...scene.world.obstacles,...scene.world.boundaries].map(o=>{if(!isConvex(o.verticesM as P[]))throw new Error(`OBSTACLE_NOT_CONVEX ${o.id}`);return o.verticesM as P[];});
 const robots=new Map(scene.robots.map(r=>[r.robotId,{model:r.model,hull:r.model.footprint.verticesM as P[],radius:Math.max(...(r.model.footprint.verticesM as P[]).map(v=>Math.hypot(v[0],v[1])))}]));
 const goals=new Map<string,Goal>(),pending:Decision[]=[];

 // ---- planning ----
 function planner(robotId:string,obstacles:P[][]){
  const {hull,radius}=robots.get(robotId)!,inflated=obstacles.map(o=>{const g=grow(o,margin);return {poly:g,x0:Math.min(...g.map(p=>p[0])),x1:Math.max(...g.map(p=>p[0])),y0:Math.min(...g.map(p=>p[1])),y1:Math.max(...g.map(p=>p[1]))};});
  // the lattice headings are fixed, so their rotated footprints and bounding boxes are computed once
  const shapes=Array.from({length:H},(_,h)=>{const body=place(hull,0,0,h*2*Math.PI/H);return {body,x0:Math.min(...body.map(p=>p[0])),x1:Math.max(...body.map(p=>p[0])),y0:Math.min(...body.map(p=>p[1])),y1:Math.max(...body.map(p=>p[1]))};});
  const hit=(body:P[],x0:number,x1:number,y0:number,y1:number)=>{for(const o of inflated){if(x1<o.x0||x0>o.x1||y1<o.y0||y0>o.y1)continue;if(polygonsOverlap(body,o.poly))return true;}return false;};
  const free=(x:number,y:number,yaw:number)=>{
   const lattice=Math.abs(yaw/(2*Math.PI/H)-Math.round(yaw/(2*Math.PI/H)))<1e-9,h=lattice?((Math.round(yaw/(2*Math.PI/H))%H)+H)%H:-1;
   const shape=h>=0?shapes[h]!:undefined,body=shape?shape.body.map(([a,b])=>[x+a,y+b] as P):place(hull,x,y,yaw);
   const x0=shape?x+shape.x0:x-radius,x1=shape?x+shape.x1:x+radius,y0=shape?y+shape.y0:y-radius,y1=shape?y+shape.y1:y+radius;
   if(x0<0||y0<0||x1>W||y1>Hm)return false; // bounding box inside the world implies every vertex is
   return !hit(body,x0,x1,y0,y1);
  };
  const moveFree=(a:Pose2,b:Pose2)=>sweptHulls(hull,a,b).every(h=>{const xs=h.map(p=>p[0]),ys=h.map(p=>p[1]);return !hit(h,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));})&&b[0]>=0;
  // 2D connectivity of the robot's inscribed disc: if even that cannot get from A to B, nothing of the robot's shape can
  const inscribed=Math.min(...hull.map((p,i)=>{const q=hull[(i+1)%hull.length]!,dx=q[0]-p[0],dy=q[1]-p[1],l=Math.hypot(dx,dy);return l===0?Infinity:Math.abs(p[0]*dy-p[1]*dx)/l;}));
  const discReach=(from:[number,number],to:[number,number])=>{
   const cell=(v:number)=>Math.round(v/res),seen=new Uint8Array(nx*ny),blocked=new Uint8Array(nx*ny);
   for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++){
    const x=ix*res,y=iy*res;
    if(x<inscribed||y<inscribed||x>W-inscribed||y>Hm-inscribed){blocked[iy*nx+ix]=1;continue;}
    for(const o of inflated){if(x+inscribed<o.x0||x-inscribed>o.x1||y+inscribed<o.y0||y-inscribed>o.y1)continue;if(pointDistance([x,y],o.poly)<inscribed){blocked[iy*nx+ix]=1;break;}}
   }
   const goal=cell(to[1])*nx+cell(to[0]),stack=[cell(from[1])*nx+cell(from[0])];
   while(stack.length){const k=stack.pop()!;if(k<0||k>=nx*ny||seen[k]||blocked[k])continue;seen[k]=1;if(k===goal)return true;const ix=k%nx;if(ix>0)stack.push(k-1);if(ix<nx-1)stack.push(k+1);stack.push(k-nx,k+nx);}
   return false;
  };
  return {free,moveFree,discReach};
 }
 /** Every turn in place is swept (including the first turn from the actual yaw and the final one) and the goal pose itself must be free. */
 function verified(steps:Step[],from:Pose2,to:Pose2,moveFree:(a:Pose2,b:Pose2)=>boolean,free:(x:number,y:number,yaw:number)=>boolean):Plan{
  let x=from[0],y=from[1],yaw=from[2];
  for(const st of steps){
   if(st.kind==='rotate'){if(!moveFree([x,y,yaw],[x,y,st.yaw]))return {ok:false,reason:'no_path'};yaw=st.yaw;}
   else{x=st.to[0];y=st.to[1];}
  }
  return free(to[0],to[1],to[2])?{ok:true,steps}:{ok:false,reason:'no_path'};
 }
 function plan(robotId:string,from:Pose2,to:Pose2,obstacles:P[][]):Plan{
  const {free,moveFree,discReach}=planner(robotId,obstacles),cache=new Map<number,boolean>();
  // already within the position tolerance: only the turn to the goal heading is needed (no drive away and back to a lattice cell)
  if(Math.hypot(to[0]-from[0],to[1]-from[1])<=pol.goalPositionToleranceM/2)return verified([{kind:'rotate',yaw:to[2]}],from,to,moveFree,free);
  const key=(ix:number,iy:number,h:number)=>(h*ny+iy)*nx+ix;
  const ok=(ix:number,iy:number,h:number)=>{const k=key(ix,iy,h);let v=cache.get(k);if(v===undefined){v=ix>=0&&iy>=0&&ix<nx&&iy<ny&&free(ix*res,iy*res,h*2*Math.PI/H);cache.set(k,v);}return v;};
  const sx=Math.round(from[0]/res),sy=Math.round(from[1]/res),sh=((Math.round(wrapPi(from[2])/(2*Math.PI/H))%H)+H)%H,gx=Math.round(to[0]/res),gy=Math.round(to[1]/res);
  // continuous endpoints are connected to the lattice by straight, swept-checked legs: the actual pose is never snapped
  const legFree=(a:[number,number],b:[number,number])=>{if(Math.hypot(b[0]-a[0],b[1]-a[1])<EPS)return true;const yaw=Math.atan2(b[1]-a[1],b[0]-a[0]);return free(a[0],a[1],yaw)&&free(b[0],b[1],yaw)&&moveFree([a[0],a[1],yaw],[b[0],b[1],yaw]);};
  if(!ok(sx,sy,sh)&&!free(from[0],from[1],from[2]))return {ok:false,reason:'no_path'};
  if(!discReach([from[0],from[1]],[to[0],to[1]]))return {ok:false,reason:'no_path'};
  const g=new Map<number,number>(),parent=new Map<number,number>(),heap=new Heap(),closed=new Set<number>();
  const hCost=(ix:number,iy:number)=>pol.distanceCostPerM*res*Math.hypot(ix-gx,iy-gy);
  g.set(key(sx,sy,sh),0);heap.push({f:hCost(sx,sy),g:0,x:sx,y:sy,h:sh,id:key(sx,sy,sh)});
  let expanded=0,goalKey=-1;
  const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  while(heap.size){
   const n=heap.pop();
   if(closed.has(n.id))continue;
   closed.add(n.id);
   if(++expanded>pol.maxPlannerStates)return {ok:false,reason:'PLANNER_BUDGET_EXCEEDED'};
   if(n.x===gx&&n.y===gy){
    const t:[number,number]=[to[0],to[1]];
    // the last turn (from this arrival heading to the goal heading) must also be free here; otherwise keep searching for another approach
    const here=Math.hypot(t[0]-n.x*res,t[1]-n.y*res)<EPS;
    if(legFree([n.x*res,n.y*res],t)&&(!here||moveFree([n.x*res,n.y*res,n.h*2*Math.PI/H],[t[0],t[1],to[2]]))){goalKey=n.id;break;}
    continue;
   }
   const relax=(ix:number,iy:number,h:number,cost:number)=>{
    const k=key(ix,iy,h),ng=n.g+cost;
    if(closed.has(k)||(g.get(k)??Infinity)<=ng)return;
    g.set(k,ng);parent.set(k,n.id);heap.push({f:ng+hCost(ix,iy),g:ng,x:ix,y:iy,h,id:k});
   };
   const [dx,dy]=dirs[n.h*(8/H)|0]!,yaw=n.h*2*Math.PI/H;
   if(H===8){
    const tx=n.x+dx,ty=n.y+dy;
    if(ok(tx,ty,n.h)&&moveFree([n.x*res,n.y*res,yaw],[tx*res,ty*res,yaw]))relax(tx,ty,n.h,pol.distanceCostPerM*res*Math.hypot(dx,dy));
   }
   for(const turn of [1,-1]){
    const h2=(n.h+turn+H)%H,yaw2=yaw+turn*2*Math.PI/H;
    if(ok(n.x,n.y,h2)&&moveFree([n.x*res,n.y*res,yaw],[n.x*res,n.y*res,yaw2]))relax(n.x,n.y,h2,pol.rotationCostPerRad*2*Math.PI/H);
   }
  }
  if(goalKey<0)return {ok:false,reason:'no_path'};
  const states:{x:number;y:number;h:number}[]=[];
  for(let k:number|undefined=goalKey;k!==undefined;k=parent.get(k)){const h=Math.floor(k/(ny*nx)),r=k-h*ny*nx;states.push({x:r%nx,y:Math.floor(r/nx),h});}
  states.reverse();
  const steps:Step[]=[];
  const start:[number,number]=[from[0],from[1]],first=states[0]!;
  if(Math.hypot(first.x*res-start[0],first.y*res-start[1])>EPS){
   if(!legFree(start,[first.x*res,first.y*res]))return {ok:false,reason:'no_path'};
   steps.push({kind:'rotate',yaw:Math.atan2(first.y*res-start[1],first.x*res-start[0])},{kind:'translate',to:[first.x*res,first.y*res]});
  }
  for(let i=1;i<states.length;i++){
   const a=states[i-1]!,b=states[i]!;
   if(a.x===b.x&&a.y===b.y){steps.push({kind:'rotate',yaw:b.h*2*Math.PI/H});continue;}
   const prev=steps.at(-1);
   if(prev&&prev.kind==='translate'&&states[i-2]&&states[i-2]!.h===a.h&&a.h===b.h&&(states[i-1]!.x-states[i-2]!.x)*(b.y-a.y)===(states[i-1]!.y-states[i-2]!.y)*(b.x-a.x))prev.to=[b.x*res,b.y*res];
   else steps.push({kind:'translate',to:[b.x*res,b.y*res]});
  }
  const lastCell=states.at(-1)!;
  if(Math.hypot(to[0]-lastCell.x*res,to[1]-lastCell.y*res)>EPS)steps.push({kind:'rotate',yaw:Math.atan2(to[1]-lastCell.y*res,to[0]-lastCell.x*res)},{kind:'translate',to:[to[0],to[1]]});
  steps.push({kind:'rotate',yaw:to[2]});
  return verified(steps,from,to,moveFree,free);
 }

 /** Path still to be driven: remaining leg lengths plus 0.1 m per rad of turning. A detour that first moves away from the goal still makes this fall. */
 function remaining(goal:Goal,pose:Pose2,straight:number){
  if(!goal.steps)return straight;
  let r=0,x=pose[0],y=pose[1],yaw=pose[2];
  for(let i=goal.stepIndex;i<goal.steps.length;i++){const st=goal.steps[i]!;if(st.kind==='rotate'){r+=Math.abs(wrapPi(st.yaw-yaw))*0.1;yaw=st.yaw;}else{r+=Math.hypot(st.to[0]-x,st.to[1]-y);x=st.to[0];y=st.to[1];}}
  return r;
 }

 // ---- following ----
 function follow(robotId:string,goal:Goal,pose:Pose2,vel:[number,number],blocked:boolean){
  const m=robots.get(robotId)!.model,k=m.kinematics,aLin=pol.maxAccelerationMps2,aAng=pol.maxAngularAccelerationRadps2;
  let v=0,w=0;
  // a finished step hands over to the next one within the same tick, so the command is always ramped from the measured velocity, never cut to zero
  while(!blocked&&goal.steps&&goal.stepIndex<goal.steps.length){
   const step=goal.steps[goal.stepIndex]!,final=goal.stepIndex===goal.steps.length-1;
   if(step.kind==='rotate'){
    const err=wrapPi(step.yaw-pose[2]);
    if(Math.abs(err)<=(final?pol.goalYawToleranceRad/2:TURN_TOL)&&Math.abs(vel[1])<=pol.stoppedAngularRadps){goal.stepIndex+=1;continue;}
    w=Math.sign(err)*Math.min(k.maxAngularRadps,Math.sqrt(2*aAng*Math.abs(err)),Math.abs(err)/DT*0.5);
   }else{
    const dx=step.to[0]-pose[0],dy=step.to[1]-pose[1],d=Math.hypot(dx,dy),herr=wrapPi(Math.atan2(dy,dx)-pose[2]);
    if(d<=LEG_TOL){goal.stepIndex+=1;continue;}
    if(Math.abs(herr)>0.3)w=Math.sign(herr)*Math.min(k.maxAngularRadps,Math.sqrt(2*aAng*Math.abs(herr)));
    else{v=Math.min(k.maxLinearMps,Math.sqrt(2*aLin*Math.max(0,d-LEG_TOL/2)),d/DT*0.5);w=Math.max(-k.maxAngularRadps,Math.min(k.maxAngularRadps,2*herr/(DT*10)));}
   }
   break;
  }
  v=Math.max(vel[0]-aLin*DT,Math.min(vel[0]+aLin*DT,v));w=Math.max(vel[1]-aAng*DT,Math.min(vel[1]+aAng*DT,w));
  const left=(v-w*k.wheelSeparationM/2)/k.wheelRadiusM,right=(v+w*k.wheelSeparationM/2)/k.wheelRadiusM,over=Math.max(Math.abs(left)/k.maxWheelRadps.left,Math.abs(right)/k.maxWheelRadps.right,1);
  return {v:v/over,w:w/over};
 }

 return {
  setGoal({robotId,commandId,target}){
   if(!robots.has(robotId))throw new Error(`UNKNOWN_ROBOT ${robotId}`);
   goals.set(robotId,{commandId,target,startTick:null,steps:null,stepIndex:0,hold:0,best:Infinity,stagnant:0,lastPlanTick:-Infinity,zonesKey:'',waiting:false});
  },
  cancel(robotId,commandId){
   const g=goals.get(robotId);
   if(g&&g.commandId===commandId){goals.delete(robotId);pending.push({robotId,commandId,status:'cancelled',reason:null});}
  },
  advance(snapshot,reservations){
   const velocities:Velocity[]=[],decisions:Decision[]=pending.splice(0),tick=snapshot.tick;
   const fleet=new Map(snapshot.robots.map(r=>[r.robotId,r]));
   for(const robotId of [...robots.keys()].sort()){
    const obs=fleet.get(robotId);
    if(!obs){velocities.push({robotId,vMps:0,omegaRadps:0});continue;}
    const pose=obs.poseDriveMap as Pose2,vel=obs.bodyVelocity as [number,number],goal=goals.get(robotId);
    const stop=(reason?:string)=>{velocities.push({robotId,vMps:0,omegaRadps:0});void reason;};
    if(!goal){
     // idle: explicit zero, brought down within the acceleration limit
     const f=follow(robotId,{commandId:'',target:pose,startTick:0,steps:[],stepIndex:0,hold:0,best:0,stagnant:0,lastPlanTick:0,zonesKey:'',waiting:false},pose,vel,false);
     velocities.push({robotId,vMps:f.v,omegaRadps:f.w});continue;
    }
    goal.startTick??=tick;
    const denied=(scene.zones??[]).filter(z=>reservations[z.id]!==robotId),zonesKey=denied.map(z=>z.id).join(',');
    const others=[...fleet.values()].filter(r=>r.robotId!==robotId).map(r=>place(robots.get(r.robotId)!.hull,...(r.poseDriveMap as Pose2)));
    const dyn=dynamicPoints(robotId,obs,pose,statics);
    const zoneObstacles=denied.map(z=>z.polygonM as P[]);
    const needsPlan=(!goal.steps&&!goal.waiting)||zonesKey!==goal.zonesKey||(goal.waiting&&tick-goal.lastPlanTick>=pol.replanEveryTicks);
    if(needsPlan){
     const global=!goal.steps;
     const fixed=[...statics,...zoneObstacles];
     let result:ReturnType<typeof plan>|undefined;
     // reachability is judged on the static map alone; a zone that is merely not granted yet is a wait, not a missing path
     if(global&&!goal.staticOk){const base=plan(robotId,pose,goal.target,statics);if(base.ok)goal.staticOk=true;if(!base.ok||!zoneObstacles.length)result=base;}
     result??=plan(robotId,pose,goal.target,global?fixed:[...fixed,...others,...dyn.map(p=>[[p[0]-0.1,p[1]-0.1],[p[0]+0.1,p[1]-0.1],[p[0]+0.1,p[1]+0.1],[p[0]-0.1,p[1]+0.1]] as P[])]);
     goal.lastPlanTick=tick;goal.zonesKey=zonesKey;
     if(result.ok){goal.steps=result.steps;goal.stepIndex=0;goal.waiting=false;goal.zoneWait=false;goal.best=Infinity;}
     else if(!goal.staticOk||result.reason==='PLANNER_BUDGET_EXCEEDED'){
      goals.delete(robotId);stop();
      decisions.push({robotId,commandId:goal.commandId,status:result.reason==='no_path'?'no_path':'blocked',reason:result.reason==='no_path'?'NO_PATH':result.reason});continue;
     }else{
      goal.waiting=true;  // a path exists on the static map; a reservation or an obstruction hides it: hold still and look again
      // hidden by a zone alone (the same search without the zones finds a way) means the reservation is what is awaited
      goal.zoneWait=!global&&zoneObstacles.length>0&&plan(robotId,pose,goal.target,[...statics,...others,...dyn.map(p=>[[p[0]-0.1,p[1]-0.1],[p[0]+0.1,p[1]-0.1],[p[0]+0.1,p[1]+0.1],[p[0]-0.1,p[1]+0.1]] as P[])]).ok;
     }
    }
    // goal reached? pose and velocity within tolerance for arrivalHoldTicks consecutive ticks
    const dist=Math.hypot(goal.target[0]-pose[0],goal.target[1]-pose[1]),yawErr=Math.abs(wrapPi(goal.target[2]-pose[2]));
    const settled=dist<=pol.goalPositionToleranceM&&yawErr<=pol.goalYawToleranceRad&&Math.abs(vel[0])<=pol.stoppedLinearMps&&Math.abs(vel[1])<=pol.stoppedAngularRadps;
    goal.hold=settled?goal.hold+1:0;
    if(goal.hold>=pol.arrivalHoldTicks){goals.delete(robotId);stop();decisions.push({robotId,commandId:goal.commandId,status:'arrived',reason:null});continue;}
    // sensors: no fresh scan means no clear path; a dynamic point inside the stopping corridor means wait
    let reason:string|null=null,hold=goal.waiting;
    const m=robots.get(robotId)!.model;
    if(m.sensors.length){
     const scans=obs.scans,fresh=scans.length>0&&scans.every(s=>tick-s.tick<=pol.scanFreshnessTicks);
     if(!fresh){hold=true;reason='SENSOR_STALE';}
     // unknown is not free: every expected sensor must report, as itself, and mostly with usable beams ('no_return' is a valid clear view, 'invalid' is not)
     else if(scans.length!==m.sensors.length||scans.some((s,i)=>s.sensorId!==m.sensors[i]!.id||s.states.length===0||s.states.filter(x=>x==='invalid').length/s.states.length>MAX_INVALID_BEAM_FRACTION)){hold=true;reason='SENSOR_INVALID';}
    }
    const next=goal.steps?goal.steps[goal.stepIndex]:undefined;
    if(!hold&&next&&dyn.length){
     const speed=Math.max(Math.abs(vel[0]),0.05),scanAge=obs.scans.length?tick-Math.min(...obs.scans.map(s=>s.tick)):0;
     const stopDist=speed*speed/(2*pol.maxAccelerationMps2)+speed*(scanAge*DT+DT)+margin;
     const heading=next.kind==='translate'?Math.atan2(next.to[1]-pose[1],next.to[0]-pose[0]):pose[2];
     const ahead=convexHull([...place(robots.get(robotId)!.hull,pose[0],pose[1],heading),...place(robots.get(robotId)!.hull,pose[0]+stopDist*Math.cos(heading),pose[1]+stopDist*Math.sin(heading),heading)]);
     // a turn in place sweeps the whole footprint through the yaw change, not just the body as it stands now
     const turnTo=next.kind==='rotate'?next.yaw:Math.abs(wrapPi(heading-pose[2]))>0.3?heading:null;
     const sweptTurn=turnTo!==null&&Math.abs(wrapPi(turnTo-pose[2]))>0.02?sweptHulls(robots.get(robotId)!.hull,pose,[pose[0],pose[1],turnTo]):[];
     if(dyn.some(p=>pointDistance(p,ahead)<=0.05)||dyn.some(p=>sweptTurn.some(h=>pointDistance(p,h)<=margin))){hold=true;reason='DYNAMIC_OBSTACLE';if(!goal.waiting)goal.waiting=true;}
    }
    if(!hold&&m.sensors.length&&invalidAhead(robotId,obs,pose,!next||next.kind==='rotate'||Math.abs(wrapPi(Math.atan2(next.to[1]-pose[1],next.to[0]-pose[0])-pose[2]))>0.3?null:Math.atan2(next.to[1]-pose[1],next.to[0]-pose[0]))){hold=true;reason='SENSOR_INVALID';}
    // progress and deadline
    const metric=remaining(goal,pose,dist);
    // waiting for a reservation (no route exists until the zone is granted) is the domain's timeout to enforce, not lack of progress; the goal deadline still bounds it
    if(!goal.steps||goal.zoneWait)reason??='RESERVATION_PENDING';
    else if(metric<goal.best-0.01){goal.best=metric;goal.stagnant=0;}else goal.stagnant+=1;
    if(goal.stagnant>=pol.noProgressTicks&&goal.hold===0){goals.delete(robotId);stop();decisions.push({robotId,commandId:goal.commandId,status:'blocked',reason:reason??'NO_PROGRESS'});continue;}
    if(tick-goal.startTick>=pol.goalDeadlineTicks){goals.delete(robotId);stop();decisions.push({robotId,commandId:goal.commandId,status:'blocked',reason:'GOAL_DEADLINE'});continue;}
    if(!hold&&goal.waiting)goal.waiting=false;
    const f=follow(robotId,goal,pose,vel,hold||!goal.steps);
    velocities.push({robotId,vMps:f.v,omegaRadps:f.w});
    decisions.push({robotId,commandId:goal.commandId,status:'executing',reason});
   }
   return {velocities,decisions};
  },
 };

 // world-frame direction and kind of every beam of every sensor
 function beams(robotId:string,obs:IRSimSnapshotV1['robots'][number],pose:Pose2,visit:(angle:number,range:number|null,state:string,origin:P,min:number)=>void){
  const model=robots.get(robotId)!.model;
  obs.scans.forEach((scan,i)=>{
   const mount=model.sensors[i];
   if(!mount)return;
   const [ox,oy,oyaw]=mount.poseInDrive,origin:P=[pose[0]+ox*Math.cos(pose[2])-oy*Math.sin(pose[2]),pose[1]+ox*Math.sin(pose[2])+oy*Math.cos(pose[2])],base=pose[2]+oyaw;
   scan.rangesM.forEach((r,b)=>visit(base+scan.angleMinRad+b*scan.angleIncrementRad,r,scan.states[b]!,origin,scan.rangeMinM));
  });
 }
 // LiDAR returns the static map does not explain, in the map frame; 'below_min' is something closer than the minimum range, so it is placed at that range (nearer is the safe side)
 function dynamicPoints(robotId:string,obs:IRSimSnapshotV1['robots'][number],pose:Pose2,solids:P[][]):P[]{
  const out:P[]=[];
  beams(robotId,obs,pose,(a,r,state,[cx,cy],min)=>{
   const range=state==='hit'&&r!==null&&r<=3?r:state==='below_min'?min:null;
   if(range===null)return;
   const p:P=[cx+range*Math.cos(a),cy+range*Math.sin(a)];
   if(!solids.some(s=>pointDistance(p,s)<=0.1))out.push(p);
  });
  return out;
 }
 // beams that say nothing: the way they point is unknown space. Any invalid beam in the half-plane the robot moves into (every direction while it turns) is a hold.
 function invalidAhead(robotId:string,obs:IRSimSnapshotV1['robots'][number],pose:Pose2,heading:number|null):boolean{
  let bad=false;
  beams(robotId,obs,pose,(a,_r,state)=>{if(state==='invalid'&&(heading===null||Math.abs(wrapPi(a-heading))<Math.PI/2))bad=true;});
  return bad;
 }
}
