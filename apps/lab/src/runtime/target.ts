// Where the twin's runtime is (D52): this page's own /lab/v2 (cookie session, the launchers' default), a runtime on this machine reached from another
// origin, or one behind an HTTPS URL; both of the latter use a bearer session (D53). Pure apart from storage, and storage failing only loses memory.
import {TwinRuntimeError} from '../scenarios/controls';
export interface RuntimeTarget {base:string;kind:'same_origin'|'loopback'|'remote'}
const LOOPBACK=['127.0.0.1','localhost','[::1]'],ADDRESS_KEY='mekoniq-lab-runtime',SAME:RuntimeTarget={base:'/lab/v2',kind:'same_origin'};
/** By the parsed literal (the URL parser has already normalised IPv4 forms such as 127.1 or 0x7f.1 and compressed IPv6): IPv4 0.0.0.0 and 127.0.0.0/8,
 * IPv6 :: and ::1, and their IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d) forms; the names localhost and *.localhost. A DNS name that only starts with 127. is a host like any other. */
function hostClass(host:string):'unspecified'|'loopback'|'other'{
 const h=host.replace(/\.$/,''),v4=/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h),ip4=(hi:number,lo:number)=>hi===0&&lo===0?'unspecified':hi>>8===127?'loopback':'other';
 if(v4)return ip4(Number(v4[1])*256+Number(v4[2]),Number(v4[3])*256+Number(v4[4]));
 if(h==='[::]')return 'unspecified';if(h==='[::1]')return 'loopback';
 const mapped=/^\[::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(h);if(mapped)return ip4(parseInt(mapped[1]!,16),parseInt(mapped[2]!,16));
 return h==='localhost'||h.endsWith('.localhost')?'loopback':'other';
}
/** null or empty: this page's runtime. http only for 127.0.0.1, localhost and [::1]; anything else must be https. Origin only (or its /lab/v2). */
export function parseTarget(input:string|null,pageOrigin:string):RuntimeTarget{
 const s=input?.trim();if(!s)return {...SAME};
 const bad=()=>new TwinRuntimeError('INVALID_RUNTIME_URL',[],0);
 let u:URL;try{u=new URL(s);}catch{throw bad();}
 const loopback=LOOPBACK.includes(u.hostname),c=hostClass(u.hostname);
 // never the unspecified address; a local runtime only by http://127.0.0.1, http://localhost or http://[::1] (an https "remote" that is this machine is refused)
 if(c==='unspecified'||u.protocol==='https:'&&c==='loopback')throw bad();
 if(!(u.protocol==='https:'||u.protocol==='http:'&&loopback)||u.username||u.password||u.search||u.hash||!['/','/lab/v2','/lab/v2/'].includes(u.pathname))throw bad();
 return u.origin===pageOrigin?{...SAME}:{base:`${u.origin}/lab/v2`,kind:loopback?'loopback':'remote'};
}
/** The saved address, or this page's runtime when none is saved, it is invalid, or storage is unavailable. */
export function loadTarget(pageOrigin:string):RuntimeTarget{try{return parseTarget(localStorage.getItem(ADDRESS_KEY),pageOrigin);}catch{return {...SAME};}}
export function saveTarget(input:string|null):void{try{if(input?.trim())localStorage.setItem(ADDRESS_KEY,input.trim());else localStorage.removeItem(ADDRESS_KEY);}catch{/* the address lives for this page only */}}
/** What the user would type for this target ('' for this page's runtime). */
export const targetAddress=(t:RuntimeTarget)=>t.kind==='same_origin'?'':t.base.replace(/\/lab\/v2$/,'');
/** The bearer lives in sessionStorage (this tab, never localStorage, a URL or a log), keyed by the runtime it belongs to. */
const tokenKey=(t:RuntimeTarget)=>`mekoniq-lab-session:${t.base}`;
export function loadToken(t:RuntimeTarget):string{try{return sessionStorage.getItem(tokenKey(t))??'';}catch{return '';}}
export function saveToken(t:RuntimeTarget,token:string):void{try{if(token)sessionStorage.setItem(tokenKey(t),token);else sessionStorage.removeItem(tokenKey(t));}catch{/* memory only */}}
/** same_origin: the cookie; other targets: the bearer and no credentials, and (D56) the loopback address space so the browser can ask for local network access. */
export function requestInit(t:RuntimeTarget,token:string):RequestInit{
 if(t.kind==='same_origin')return {credentials:'same-origin'};
 return {credentials:'omit',headers:token?{Authorization:`Bearer ${token}`}:{},...t.kind==='loopback'?{targetAddressSpace:'loopback'}:{}} as RequestInit;
}
/** Trang không phải loopback chỉ được gửi request tới runtime sau một thao tác của người dùng. A loopback page probes only its own origin by itself. */
export const mayAutoProbe=(t:RuntimeTarget,pageHost:string):boolean=>t.kind==='same_origin'&&loopbackPage(pageHost);
/** A page served from this machine's loopback (a launcher's UI): its own origin may have a runtime; a page from the web has none. */
export const loopbackPage=(pageHost:string):boolean=>LOOPBACK.includes(pageHost);
