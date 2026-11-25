// One selection shared by scene (2D/3D), timeline, queue and inspector. Selecting is a view concern only: it never authorises an action.
let current:string|null=null;
const listeners=new Set<(id:string|null)=>void>();
export const selectedEntity=()=>current;
export function selectEntity(entityId:string|null):void {
 if(entityId===current)return;
 current=entityId;
 for(const l of listeners)l(current);
}
export function onSelection(listener:(id:string|null)=>void):()=>void {listeners.add(listener);return ()=>{listeners.delete(listener);};}
