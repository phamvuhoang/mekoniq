import {createHash} from 'node:crypto';
/** Named, versioned PRNG locked in the run manifest. One stream per actor, so drawing for one actor never shifts another's workload. */
export const PRNG={algorithm:'xoshiro128**',seeding:'sha256(seed:actorId)',version:1} as const;
export interface Stream {next():number;int(min:number,max:number):number;}
export function actorStream(seed:number,actorId:string):Stream {
 const h=createHash('sha256').update(`${seed}:${actorId}`).digest();
 let a=h.readUInt32LE(0),b=h.readUInt32LE(4),c=h.readUInt32LE(8),d=h.readUInt32LE(12);
 if(!(a|b|c|d))a=1;
 const rotl=(x:number,k:number)=>(x<<k)|(x>>>(32-k));
 const u32=()=>{const r=Math.imul(rotl(Math.imul(b,5),7),9)>>>0,t=b<<9;c^=a;d^=b;b^=c;a^=d;c^=t;d=rotl(d,11);return r;};
 return {next:()=>u32()/2**32,int(min,max){if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||max<min)throw new Error('INVALID_RANGE');return min+Math.floor(u32()/2**32*(max-min+1));}};
}
