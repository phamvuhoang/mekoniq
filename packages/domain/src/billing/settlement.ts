import { canonicalMinor } from '../shared/money';
export function dueMinor(total:string,applied:string,refunded:string):string {
 return canonicalMinor(String(BigInt(total)-BigInt(applied)+BigInt(refunded)));
}
