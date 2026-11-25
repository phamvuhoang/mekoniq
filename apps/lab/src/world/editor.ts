import type {RestaurantWorld,WorldPoint} from '../shared/types';
import {validateWorld} from './validation';
export function updateWorldPoint(world:RestaurantWorld,id:string,changes:Partial<Pick<WorldPoint,'x'|'y'|'name'>>):RestaurantWorld {
  if (!world.points.some(point=>point.id===id)) throw new Error('UNKNOWN_POINT');
  const edited={...world,revision:world.revision+1,points:world.points.map(point=>point.id===id ? {...point,...changes} : {...point}),obstacles:world.obstacles.map(obstacle=>({...obstacle}))};
  const issues=validateWorld(edited);
  if (issues.length) throw new Error(`INVALID_WORLD:${issues.map(issue=>issue.code).join(',')}`);
  return edited;
}
export interface WorldReference {id:string;worldId:string;worldRevision:number;}
/** Any geometry edit makes evidence and map bindings for an earlier revision stale. */
export function invalidateWorldReferences(world:RestaurantWorld,references:readonly WorldReference[]):string[] {
  return references.filter(ref=>ref.worldId===world.id&&ref.worldRevision!==world.revision).map(ref=>ref.id);
}
