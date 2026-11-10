// pid-v1: discrete PID with a filtered derivative on the measurement, output saturation and integral clamping. Pure and deterministic: no clock, no randomness.
// Step order is part of the contract; the Python oracle (robotics/algorithm/algorithm_checks/pid.py) is written from the same specification.
export interface PidConfig {kp:number;ki:number;kd:number;dtS:number;derivativeFilterHz:number;outMin:number;outMax:number}
export interface PidState {integral:number;dFiltered:number;prevMeasurement:number|null}
export const pidInit=():PidState=>({integral:0,dFiltered:0,prevMeasurement:null});
const ok=Number.isFinite;
export function pidStep(c:PidConfig,s:PidState,setpoint:number,measurement:number):{u:number;state:PidState;saturated:boolean}{
 if(![c.kp,c.ki,c.kd].every(ok)||!(c.dtS>0)||!ok(c.dtS)||!(c.derivativeFilterHz>0)||!ok(c.derivativeFilterHz)||!ok(c.outMin)||!ok(c.outMax)||!(c.outMin<c.outMax))throw new Error('PID_CONFIG_INVALID');
 if(!ok(setpoint)||!ok(measurement))throw new Error('PID_INPUT_INVALID');
 const e=setpoint-measurement,alpha=c.dtS/(c.dtS+1/(2*Math.PI*c.derivativeFilterHz));
 const raw=s.prevMeasurement===null?0:-(measurement-s.prevMeasurement)/c.dtS;
 const dFiltered=s.dFiltered+alpha*(raw-s.dFiltered),candidate=s.integral+c.ki*e*c.dtS,unsaturated=c.kp*e+candidate+c.kd*dFiltered;
 const u=Math.min(c.outMax,Math.max(c.outMin,unsaturated)),saturated=u!==unsaturated;
 // clamp: keep the old integral while the output is saturated in the direction the error is pushing
 const integral=saturated&&Math.sign(e)===Math.sign(unsaturated-u)?s.integral:candidate;
 return {u,state:{integral,dFiltered,prevMeasurement:measurement},saturated};
}
