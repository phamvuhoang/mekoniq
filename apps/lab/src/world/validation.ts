import type {Issue,RestaurantWorld} from '../shared/types';
/** Obstacles are closed axis-aligned rectangles; x/y is the lower-left corner in metres. */
export function validateWorld(world:RestaurantWorld,options:{robotRadiusM?:number}={}):Issue[] {
  const issues:Issue[]=[];
  const radius=options.robotRadiusM??0;
  if (!Number.isFinite(radius)||radius<0) return [{code:'INVALID_FOOTPRINT',field:'robotRadiusM',message:'Footprint radius must be finite nonnegative metres.'}];
  const add=(code:string,field:string,message:string)=>issues.push({code,field,message});
  if (!Number.isFinite(world.width)||!Number.isFinite(world.height)||world.width<=0||world.height<=0) add('INVALID_BOUNDS','world','Positive finite bounds are required.');
  if (world.points.length+world.obstacles.length>200) add('OBJECT_LIMIT','world','At most 200 objects are supported.');
  const ids=new Set<string>();
  for (const object of [...world.points,...world.obstacles]) {
    if (ids.has(object.id)) add('DUPLICATE_ID',object.id,'Object IDs must be unique.');
    ids.add(object.id);
  }
  for (const obstacle of world.obstacles) {
    if (![obstacle.x,obstacle.y,obstacle.width,obstacle.height].every(Number.isFinite)||obstacle.width<=0||obstacle.height<=0) add('INVALID_OBSTACLE',obstacle.id,'Obstacle dimensions must be positive finite metres.');
    else if (obstacle.x<0||obstacle.y<0||obstacle.x+obstacle.width>world.width||obstacle.y+obstacle.height>world.height) add('OUT_OF_BOUNDS',obstacle.id,'Obstacle lies outside world bounds.');
  }
  for (const point of world.points) {
    if (![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>world.width||point.y>world.height) add('OUT_OF_BOUNDS',point.id,'Handoff target lies outside world bounds.');
    if (world.obstacles.some(o=>point.x>=o.x&&point.x<=o.x+o.width&&point.y>=o.y&&point.y<=o.y+o.height)) add('POINT_IN_OBSTACLE',point.id,'Handoff targets must be outside furniture and walls.');
    if (radius>0&&(point.x<radius||point.y<radius||point.x+radius>world.width||point.y+radius>world.height||world.obstacles.some(o=>Math.hypot(point.x-Math.max(o.x,Math.min(point.x,o.x+o.width)),point.y-Math.max(o.y,Math.min(point.y,o.y+o.height)))<=radius))) add('FOOTPRINT_COLLISION',point.id,'Requested circular footprint intersects furniture, walls or world bounds.');
  }
  for (const kind of ['kitchen','parking'] as const) {
    if (!world.points.some(point=>point.kind===kind)) add('MISSING_STATION',kind,`A ${kind} station is required.`);
  }
  return issues;
}
