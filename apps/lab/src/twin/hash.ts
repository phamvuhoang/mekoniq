// Synchronous SHA-256 over RFC 8785 canonical JSON, the browser twin of source/.../v2/hash.ts.
// TODO(interim-copy): browser twin of source hashJson; replace with the pinned source artifact. Parity is pinned by the byte-for-byte fixture check in tests/integration/lab-v2-model.test.ts (source) and project-v2-migration.test.ts (lab).
// Synchronous on purpose: IndexedDB transactions must not wait on crypto.subtle between requests.
const primes:number[]=[];for(let n=2;primes.length<64;n++)if(primes.every(p=>n%p))primes.push(n);
const frac=(x:number)=>Math.floor((x-Math.floor(x))*2**32);
const K=primes.map(p=>frac(Math.cbrt(p))),H0=primes.slice(0,8).map(p=>frac(Math.sqrt(p)));
const rr=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
export function sha256Hex(data:Uint8Array):string {
 const l=data.length,n=((l+8)>>6)+1,bytes=new Uint8Array(n*64);
 bytes.set(data);bytes[l]=0x80;
 const dv=new DataView(bytes.buffer);dv.setUint32(n*64-8,Math.floor(l*8/2**32));dv.setUint32(n*64-4,(l*8)>>>0);
 const h=[...H0],w=new Uint32Array(64);
 for(let o=0;o<n*64;o+=64){
  for(let i=0;i<16;i++)w[i]=dv.getUint32(o+i*4);
  for(let i=16;i<64;i++){const a=w[i-15]!,b=w[i-2]!;w[i]=(w[i-16]!+(rr(a,7)^rr(a,18)^(a>>>3))+w[i-7]!+(rr(b,17)^rr(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,k]=h as [number,number,number,number,number,number,number,number];
  for(let i=0;i<64;i++){
   const t1=(k+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+K[i]!+w[i]!)>>>0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
   k=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  [a,b,c,d,e,f,g,k].forEach((v,i)=>{h[i]=(h[i]!+v)>>>0;});
 }
 return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
/** RFC 8785 for the JSON subset the contracts use: sorted keys, ES number text, undefined members dropped. */
export function canonicalJson(v:unknown):string {
 if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('INVALID_JSON: non-finite number');return JSON.stringify(v);}
 if(Array.isArray(v))return `[${v.map(canonicalJson).join(',')}]`;
 if(typeof v==='object')return `{${Object.keys(v as object).sort().filter(k=>(v as Record<string,unknown>)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonicalJson((v as Record<string,unknown>)[k])}`).join(',')}}`;
 throw new Error('INVALID_JSON: unsupported value');
}
export const hashJson=(value:unknown):string=>sha256Hex(new TextEncoder().encode(canonicalJson(value)));
