// Fixed-point decimal for inventory/recipe quantities. Integer units at a declared scale; no binary floats anywhere.
export interface ExactDecimal {readonly units:bigint;readonly scale:number;}
export type Rounding='exact'|'floor'|'half_up';
export class DecimalError extends Error {constructor(readonly code:string,detail?:string){super(detail?`${code}: ${detail}`:code);this.name='DecimalError';}}
const MAX_SCALE=36,P=(n:number)=>10n**BigInt(n);
const scaleOk=(s:number)=>{if(!Number.isInteger(s)||s<0||s>MAX_SCALE)throw new DecimalError('DECIMAL_SCALE_INVALID',String(s));return s;};
/** Parse a plain decimal string at `scale`. Extra non-zero digits are DECIMAL_LOSSY; use rescale to round deliberately. */
export function decimal(text:string,scale:number):ExactDecimal {
 scaleOk(scale);
 if(typeof text!=='string'||!/^-?(\d+|\d*\.\d+)$/.test(text))throw new DecimalError('DECIMAL_INVALID',String(text));
 const neg=text.startsWith('-'),[i='',f='']=text.replace('-','').split('.');
 const kept=f.slice(0,scale).padEnd(scale,'0');
 if(/[1-9]/.test(f.slice(scale)))throw new DecimalError('DECIMAL_LOSSY',text);
 const u=BigInt((i||'0')+kept);
 return {units:neg?-u:u,scale};
}
export function format(d:ExactDecimal):string {
 const neg=d.units<0n,s=(neg?-d.units:d.units).toString().padStart(d.scale+1,'0');
 const body=d.scale?`${s.slice(0,-d.scale)}.${s.slice(-d.scale)}`:s;
 return neg?`-${body}`:body;
}
const same=(a:ExactDecimal,b:ExactDecimal)=>{if(a.scale!==b.scale)throw new DecimalError('SCALE_MISMATCH',`${a.scale} vs ${b.scale}`);};
export const add=(a:ExactDecimal,b:ExactDecimal):ExactDecimal=>{same(a,b);return {units:a.units+b.units,scale:a.scale};};
export const subtract=(a:ExactDecimal,b:ExactDecimal):ExactDecimal=>{same(a,b);return {units:a.units-b.units,scale:a.scale};};
export const abs=(a:ExactDecimal):ExactDecimal=>({units:a.units<0n?-a.units:a.units,scale:a.scale});
export const compare=(a:ExactDecimal,b:ExactDecimal):-1|0|1=>{same(a,b);return a.units<b.units?-1:a.units>b.units?1:0;};
export const isZero=(a:ExactDecimal)=>a.units===0n;
export function sum(items:readonly ExactDecimal[]):ExactDecimal {
 if(!items.length)throw new DecimalError('DECIMAL_EMPTY_SUM');
 return items.reduce(add);
}
function divide(units:bigint,by:bigint,mode:Rounding):bigint {
 const q=units/by,r=units%by;
 if(r===0n)return q;
 if(mode==='exact')throw new DecimalError('DECIMAL_LOSSY','digits would be dropped');
 const floor=r<0n?q-1n:q; // BigInt division truncates toward zero
 if(mode==='floor')return floor;
 const twice=(r<0n?-r:r)*2n; // half_up: ties round away from zero
 return twice>=by?(units<0n?q-1n:q+1n):q;
}
/** Change scale explicitly. Narrowing needs a rounding mode; 'exact' refuses to drop non-zero digits. */
export function rescale(d:ExactDecimal,scale:number,mode:Rounding='exact'):ExactDecimal {
 scaleOk(scale);
 return {units:scale>=d.scale?d.units*P(scale-d.scale):divide(d.units,P(d.scale-scale),mode),scale};
}
/** value * 10^exp expressed at `scale` (e.g. ml -> m3 is exp -6). */
export function convertPow10(d:ExactDecimal,exp:number,scale:number,mode:Rounding='exact'):ExactDecimal {
 scaleOk(scale);if(!Number.isInteger(exp))throw new DecimalError('DECIMAL_SCALE_INVALID',`exp ${exp}`);
 const shift=scale-d.scale+exp;
 return {units:shift>=0?d.units*P(shift):divide(d.units,P(-shift),mode),scale};
}
