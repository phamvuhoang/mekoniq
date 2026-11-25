export interface DriveInput {
  massKg:number;accelerationMps2:number;rollingResistance:number;slopeRadians:number;
  wheelRadiusM:number;drivenWheels:number;gearRatio:number;gearEfficiency:number;
  continuousMotorTorqueNm?:number;peakMotorTorqueNm?:number;
}
const finite=(...values:number[])=>values.every(Number.isFinite);
export function estimateDrive(input:DriveInput) {
  const {massKg,accelerationMps2,rollingResistance,slopeRadians,wheelRadiusM,drivenWheels,gearRatio,gearEfficiency}=input;
  if (!finite(massKg,accelerationMps2,rollingResistance,slopeRadians,wheelRadiusM,drivenWheels,gearRatio,gearEfficiency) || massKg<=0 || accelerationMps2<0 || rollingResistance<0 || wheelRadiusM<=0 || !Number.isInteger(drivenWheels) || drivenWheels<=0 || gearRatio<=0 || gearEfficiency<=0 || gearEfficiency>1 || Math.abs(slopeRadians)>=Math.PI/2) return null;
  const forceN=massKg*accelerationMps2+rollingResistance*massKg*9.81*Math.cos(slopeRadians)+massKg*9.81*Math.sin(slopeRadians);
  const wheelTorqueNm=Math.abs(forceN)*wheelRadiusM/drivenWheels;
  const motorTorqueNm=wheelTorqueNm/(gearRatio*gearEfficiency);
  const continuous=input.continuousMotorTorqueNm;
  const continuousTorqueStatus=continuous===undefined || !Number.isFinite(continuous) || continuous<0 ? 'missing' : continuous>=motorTorqueNm ? 'sufficient_for_model' : 'insufficient';
  return {modelVersion:'drive-v1',provenance:'illustrative' as const,forceN,wheelTorqueNm,motorTorqueNm,continuousTorqueStatus,units:{force:'N',torque:'N·m'},assumptions:['Quasi-static wheel traction model','Peak torque does not establish continuous capability','No traction, thermal or hardware acceptance claim']};
}
export function differentialDrive(input:{leftMps:number;rightMps:number;trackM:number;widthM:number;lengthM:number}) {
  const {leftMps,rightMps,trackM,widthM,lengthM}=input;
  if (!finite(leftMps,rightMps,trackM,widthM,lengthM) || Math.min(trackM,widthM,lengthM)<=0) return null;
  const linearMps=(rightMps+leftMps)/2;
  const angularRadPerSec=(rightMps-leftMps)/trackM;
  return {linearMps,angularRadPerSec,turnRadiusM:angularRadPerSec===0 ? null : Math.abs(linearMps/angularRadPerSec),sweptRadiusM:Math.hypot(widthM,lengthM)/2};
}
export function stoppingDistance(input:{speedMps:number;reactionSeconds:number;decelerationMps2:number}):number|null {
  const {speedMps,reactionSeconds,decelerationMps2}=input;
  if (!finite(speedMps,reactionSeconds,decelerationMps2) || speedMps<0 || reactionSeconds<0 || decelerationMps2<=0) return null;
  return speedMps*reactionSeconds+speedMps*speedMps/(2*decelerationMps2);
}
