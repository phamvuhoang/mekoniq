// D58: the live 3D view plays the received telemetry samples by sim time through a fixed delay, interpolating between two received samples and
// never past the newest (the twin's "no extrapolation" rule). Pure: no DOM, no three.js. One buffer per entity; the caller clears it on a change
// of display source, an epoch reset or a telemetry gap.
const MAX_RATE=64e6;// sim ns per wall ms (64x)
/** Samples further apart than this in sim time have a hole between them: the view holds the older one instead of interpolating across. */
const HOLE_NS=1e9;
/** Plays received samples back by sim time with a fixed delay. Never returns a value outside the interval between the oldest and newest held sample. */
export class SampleBuffer<T> {
 private s:{sim:number;wall:number;v:T}[]=[];private rate=0;private shown=-Infinity;
 constructor(private lerp:(a:T,b:T,u:number)=>T,private delayMs=150,private cap=64){}
 /** Samples not newer in sim time than the newest held one are ignored. */
 push(simNs:bigint,wallMs:number,value:T):void{
  const sim=Number(simNs),n=this.s.at(-1);if(n&&sim<=n.sim)return;
  if(n)this.rate=Math.min(MAX_RATE,Math.max(0,wallMs>n.wall?(sim-n.sim)/(wallMs-n.wall):MAX_RATE));
  this.s.push({sim,wall:wallMs,v:value});if(this.s.length>this.cap)this.s.shift();
 }
 at(wallMs:number):T|null{
  const s=this.s,n=s.at(-1);if(!n)return null;
  // the shown sim time never runs backwards (a burst saturates the rate estimate and would rewind the view into the backlog)
  const t=Math.min(n.sim,Math.max(s[0]!.sim,this.shown,n.sim-this.delayMs*this.rate+(wallMs-n.wall)*this.rate));this.shown=t;
  let i=s.length-1;while(i>0&&s[i-1]!.sim>t)i--;
  const b=s[i]!,a=s[i-1];
  if(!a||b.sim<=t)return b.v;
  return b.sim-a.sim>HOLE_NS?a.v:this.lerp(a.v,b.v,(t-a.sim)/(b.sim-a.sim));
 }
 clear():void{this.s=[];this.rate=0;this.shown=-Infinity;}
}
export const lerpJoints=(a:readonly number[],b:readonly number[],u:number):number[]=>a.length!==b.length?[...b]:a.map((x,i)=>x+(b[i]!-x)*u);
const arc=(a:number,b:number,u:number)=>{const d=Math.atan2(Math.sin(b-a),Math.cos(b-a));return a+d*u;};
/** A pose [x, y, z, qx, qy, qz, qw]: the position along the line, the orientation by normalised lerp on the shorter way (display, not a slerp). */
export const lerpPlace=(a:readonly number[],b:readonly number[],u:number):number[]=>{
 const s=a[3]!*b[3]!+a[4]!*b[4]!+a[5]!*b[5]!+a[6]!*b[6]!<0?-1:1,q=[3,4,5,6].map(i=>a[i]!+(s*b[i]!-a[i]!)*u),n=Math.hypot(...q)||1;
 return [...[0,1,2].map(i=>a[i]!+(b[i]!-a[i]!)*u),...q.map(x=>x/n)];
};
/** A base pose [x, y, yaw, z?, roll?, pitch?]: the angles turn along the shorter arc. */
export const lerpPose=(a:readonly number[],b:readonly number[],u:number):number[]=>a.length!==b.length?[...b]:a.map((x,i)=>i===2||i>3?arc(x,b[i]!,u):x+(b[i]!-x)*u);
