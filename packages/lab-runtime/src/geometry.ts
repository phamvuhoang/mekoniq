import type {LabProject} from './types';
/** Illustrative service chassis only; this is stationary geometry admission, not a planner or native safety proof. */
export function simulationGeometry(project:LabProject){
 const footprint=project.design.chassis==='service'?{widthM:0.55,lengthM:0.6}:null;
 return {footprint,radiusM:footprint?Math.hypot(footprint.widthM,footprint.lengthM)/2:null,provenance:footprint?'illustrative':'unavailable',stationaryTargetCheck:footprint?'conservative_circle':'point_only_unknown_footprint',nativeVerified:false};
}
export function validateTargetGeometry(project:LabProject):void {
 const {world}=project,ids=new Set<string>();
 for(const object of [...world.points,...world.obstacles]){
  if(ids.has(object.id))throw new Error('INVALID_PROJECT_DUPLICATE_OBJECT_ID');
  ids.add(object.id);
 }
 const radius=simulationGeometry(project).radiusM;
 for(const point of world.points){
  const obstructed=world.obstacles.some(o=>point.x>=o.x&&point.x<=o.x+o.width&&point.y>=o.y&&point.y<=o.y+o.height);
  if(obstructed)throw new Error('INVALID_PROJECT_POINT_IN_OBSTACLE');
  if(radius!==null&&(point.x<radius||point.y<radius||point.x+radius>world.width||point.y+radius>world.height||world.obstacles.some(o=>Math.hypot(point.x-Math.max(o.x,Math.min(point.x,o.x+o.width)),point.y-Math.max(o.y,Math.min(point.y,o.y+o.height)))<=radius)))throw new Error('INVALID_PROJECT_FOOTPRINT_COLLISION');
 }
}
