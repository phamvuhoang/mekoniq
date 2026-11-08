import {convexHull} from '../../engineering/navigation-model';

export type P=[number,number];
export type Pose2=[number,number,number];
export {convexHull};
export const rect=(x:number,y:number,w:number,h:number):P[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
/** A body polygon placed at (x, y, yaw), counter-clockwise preserved. */
export const place=(footprint:readonly P[],x:number,y:number,yaw:number):P[]=>footprint.map(([a,b])=>[x+a*Math.cos(yaw)-b*Math.sin(yaw),y+a*Math.sin(yaw)+b*Math.cos(yaw)]);
export const grow=(r:readonly P[],m:number):P[]=>{const xs=r.map(p=>p[0]),ys=r.map(p=>p[1]),x0=Math.min(...xs)-m,x1=Math.max(...xs)+m,y0=Math.min(...ys)-m,y1=Math.max(...ys)+m;return rect(x0,y0,x1-x0,y1-y0);};
export const isConvex=(poly:readonly P[])=>{
 let sign=0;
 for(let i=0;i<poly.length;i++){
  const a=poly[i]!,b=poly[(i+1)%poly.length]!,c=poly[(i+2)%poly.length]!,z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  if(Math.abs(z)<1e-12)continue;
  if(sign===0)sign=Math.sign(z);else if(Math.sign(z)!==sign)return false;
 }
 return true;
};
/** Separating-axis test for two convex polygons: true when they overlap by more than numerical noise (touching is not overlap). */
export function polygonsOverlap(a:readonly P[],b:readonly P[]):boolean{
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const p=poly[i]!,q=poly[(i+1)%poly.length]!,nx=q[1]-p[1],ny=p[0]-q[0],scale=Math.hypot(nx,ny);
  if(scale===0)continue;
  let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
  for(const [x,y] of a){const d=x*nx+y*ny;a0=Math.min(a0,d);a1=Math.max(a1,d);}
  for(const [x,y] of b){const d=x*nx+y*ny;b0=Math.min(b0,d);b1=Math.max(b1,d);}
  if(Math.min(a1,b1)-Math.max(a0,b0)<=1e-9*scale)return false;
 }
 return true;
}
const segDist=(p:P,q:P,r:P,s:P)=>{
 const cross=(o:P,a:P,b:P)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 if(cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)return 0;
 const pt=(a:P,b:P,c:P)=>{const dx=c[0]-b[0],dy=c[1]-b[1],l=dx*dx+dy*dy,t=l===0?0:Math.max(0,Math.min(1,((a[0]-b[0])*dx+(a[1]-b[1])*dy)/l));return Math.hypot(a[0]-b[0]-t*dx,a[1]-b[1]-t*dy);};
 return Math.min(pt(p,r,s),pt(q,r,s),pt(r,p,q),pt(s,p,q));
};
/** Surface separation of two convex polygons: 0 when they overlap or touch, else the smallest edge-to-edge distance. */
export function polygonDistance(a:readonly P[],b:readonly P[]):number{
 if(polygonsOverlap(a,b))return 0;
 let best=Infinity;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)best=Math.min(best,segDist(a[i]!,a[(i+1)%a.length]!,b[j]!,b[(j+1)%b.length]!));
 return best;
}
export function pointInPolygon(p:P,poly:readonly P[]):boolean{
 let inside=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const [xi,yi]=poly[i]!,[xj,yj]=poly[j]!;
  if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export const pointDistance=(p:P,poly:readonly P[])=>pointInPolygon(p,poly)?0:Math.min(...poly.map((a,i)=>segDist(p,p,a,poly[(i+1)%poly.length]!)));
export const wrapPi=(a:number)=>{const m=(a+Math.PI)%(2*Math.PI);return (m<=0?m+2*Math.PI:m)-Math.PI;};
/**
 * Hulls that cover a body moving linearly from `from` to `to`. Each hull spans two consecutive sampled poses (0.2 rad apart at most). A corner turning between them follows an arc,
 * which bulges outside the chord, so the hull also carries the footprint scaled by 1/cos(half the step) at the middle pose: that is the tangent polygon of every corner arc, so
 * no part of the true swept area lies outside the hull however thin the obstacle.
 */
export function sweptHulls(footprint:readonly P[],from:Pose2,to:Pose2):P[][]{
 const dyaw=wrapPi(to[2]-from[2]),steps=Math.max(1,Math.ceil(Math.abs(dyaw)/0.2)),pose=(t:number):Pose2=>[from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t,from[2]+dyaw*t];
 const out:P[][]=[];
 for(let i=0;i<steps;i++){
  const a=pose(i/steps),b=pose((i+1)/steps),mid=pose((i+0.5)/steps),k=1/Math.cos(Math.abs(dyaw)/steps/2);
  out.push(convexHull([...place(footprint,...a),...place(footprint,...b),...(dyaw===0?[]:place(footprint.map(([x,y]):P=>[x*k,y*k]),...mid))]));
 }
 return out;
}
