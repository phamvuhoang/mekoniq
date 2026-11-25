export interface Point {x:number;y:number;}
export interface ViewTransform {scale:number;offsetX:number;offsetY:number;}
function check(point:Point,view:ViewTransform):void {
  if (![point.x,point.y,view.scale,view.offsetX,view.offsetY].every(Number.isFinite) || view.scale<=0) throw new Error('INVALID_VIEW_TRANSFORM');
}
/** World x/y right/up in metres; screen x/y right/down in CSS pixels. */
export function worldToScreen(point:Point,view:ViewTransform):Point {
  check(point,view);
  return {x:view.offsetX+point.x*view.scale,y:view.offsetY-point.y*view.scale};
}
export function screenToWorld(point:Point,view:ViewTransform):Point {
  check(point,view);
  return {x:(point.x-view.offsetX)/view.scale,y:(view.offsetY-point.y)/view.scale};
}
