export interface Point {x:number;y:number;}
export interface StabilityInput {masses:readonly {massKg:number;x:number;y:number;z:number}[];supportPolygon:readonly Point[];marginM:number;}
function distanceToSegment(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function estimateStability(input:StabilityInput) {
  const {masses,supportPolygon,marginM}=input;
  if (!masses.length || supportPolygon.length<3 || !Number.isFinite(marginM) || marginM<0 || !masses.every(m=>[m.massKg,m.x,m.y,m.z].every(Number.isFinite)&&m.massKg>0) || !supportPolygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))) return null;
  const doubledArea=supportPolygon.reduce((sum,p,i)=>{const next=supportPolygon[(i+1)%supportPolygon.length];return sum+p.x*next.y-next.x*p.y;},0);
  if (Math.abs(doubledArea)<1e-12) return null;
  const totalMassKg=masses.reduce((n,m)=>n+m.massKg,0);
  const centerOfMass={x:0,y:0,z:0};
  for (const m of masses) {
    centerOfMass.x+=m.massKg*m.x/totalMassKg;
    centerOfMass.y+=m.massKg*m.y/totalMassKg;
    centerOfMass.z+=m.massKg*m.z/totalMassKg;
  }
  let insideSupport=false;
  let supportClearanceM=Infinity;
  for (let i=0,j=supportPolygon.length-1;i<supportPolygon.length;j=i++) {
    const a=supportPolygon[j],b=supportPolygon[i];
    if (a.x===b.x && a.y===b.y) return null;
    supportClearanceM=Math.min(supportClearanceM,distanceToSegment(centerOfMass,a,b));
    if ((a.y>centerOfMass.y)!==(b.y>centerOfMass.y) && centerOfMass.x<(b.x-a.x)*(centerOfMass.y-a.y)/(b.y-a.y)+a.x) insideSupport=!insideSupport;
  }
  if (supportClearanceM<1e-12) insideSupport=true;
  return {modelVersion:'stability-v1',provenance:'illustrative' as const,totalMassKg,centerOfMass,insideSupport,supportClearanceM,status:!insideSupport ? 'outside_support' : supportClearanceM<marginM ? 'margin_insufficient' : 'inside_support_for_model',assumptions:['Static center of mass only','Does not establish tipping, slipping or liquid payload acceptance'],units:{mass:'kg',position:'m'}};
}
