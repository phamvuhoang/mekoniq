// Arming (BK-D11, spec B1 §6): torque needs the operator to type a four-digit code shown on the bench's own terminal. Not a TTY, or three wrong answers: no torque.
// Scope (the ruling in force where the spec has two wordings): one arming per run context (one CLI run), dropped by runCase on any abnormal end.
import {randomInt} from 'node:crypto';
export interface Arming{arm(prompt:string):Promise<boolean>}        // true when the typed code is right
export const ARMING_TRIES=3;
/** `random` (0..1) is for tests only; by default the code is drawn from node:crypto, uniform over 0000..9999. */
export function ttyArming(io:{isTTY:boolean;question(q:string):Promise<string>;random?():number}):Arming{
 return {async arm(prompt){
  if(!io.isTTY)return false;                                         // a pipe or a script cannot arm
  const code=String(io.random?Math.floor(io.random()*10000)%10000:randomInt(10000)).padStart(4,'0');
  for(let i=0;i<ARMING_TRIES;i++)if((await io.question(`${prompt}\nTorque: type ${code} to arm (${ARMING_TRIES-i} tries left): `)).trim()===code)return true;
  return false;
 }};
}
