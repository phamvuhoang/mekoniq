// THE bound check of a control against the server's tuning envelope (R4-A §5.4): validateControlProfile and the bench both call it. A field the axis' envelope does not list is not accepted (null, or 0 for kd).
import type {AxisControl,AxisEnvelope} from './drive-io';

/** Reason codes, sorted; empty when the control is inside the envelope. A non-finite number is NON_FINITE_NUMBER and is never compared; a negative value never passes, whatever the bound says; the bounds are inclusive. */
export function withinEnvelope(control:AxisControl,envelope:AxisEnvelope):string[]{
 if(control.axisId!==envelope.axisId)return ['ENVELOPE_AXIS_MISSING'];
 const l=control.loop,codes=new Set<string>();
 const fields:[number|null,keyof AxisEnvelope][]=[[l.kp,'kp'],[l.ki,'ki'],[l.kd,'kd'],[l.integralLimit,'integralLimit'],[l.slewLimit,'slewLimit'],[control.accelerationLimit,'accelerationLimit']];
 for(const [x,k] of fields){
  if(typeof x!=='number')continue;
  if(!Number.isFinite(x)){codes.add('NON_FINITE_NUMBER');continue;}
  const b=envelope[k] as {min:number;max:number}|undefined;
  if(x<0||(b?x<b.min||x>b.max:x!==0))codes.add('GAIN_OUT_OF_ENVELOPE');
 }
 return [...codes].sort();
}
