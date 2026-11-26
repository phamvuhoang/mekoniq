// Arming (BK-D11, spec B1 §6): torque needs the operator to type a four-digit code shown on the bench's own terminal. Not a TTY, or three wrong answers: no torque.
export interface Arming{arm(prompt:string):Promise<boolean>}        // true when the typed code is right
export const ARMING_TRIES=3;
export function ttyArming(io:{isTTY:boolean;question(q:string):Promise<string>;random():number}):Arming{
 return {async arm(prompt){
  if(!io.isTTY)return false;                                         // a pipe or a script cannot arm
  const code=String(Math.floor(io.random()*10000)%10000).padStart(4,'0');
  for(let i=0;i<ARMING_TRIES;i++)if((await io.question(`${prompt}\nTorque: type ${code} to arm (${ARMING_TRIES-i} tries left): `)).trim()===code)return true;
  return false;
 }};
}
