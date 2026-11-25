export interface EnergyInput {volts?:number;ampHours?:number;usable?:number;derating?:number;watts?:number;}
export interface EnergyEstimate {usableWh:number;runtimeHours:number;}
const positive=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value) && value>0;
/** Power is measured at the battery: no additional efficiency multiplier. */
export function estimateEnergy(input:EnergyInput):EnergyEstimate|null {
  const {volts,ampHours,usable,derating,watts}=input;
  if (![volts,ampHours,usable,derating,watts].every(positive) || usable!>1 || derating!>1) return null;
  const usableWh=volts!*ampHours!*usable!*derating!;
  const runtimeHours=usableWh/watts!;
  return Number.isFinite(runtimeHours) ? {usableWh,runtimeHours} : null;
}
export interface DutyEnergyInput extends Omit<EnergyInput,'watts'> {phases:readonly {duty:number;watts:number}[];}
export function estimateDutyEnergy(input:DutyEnergyInput) {
  const missingInputs:string[]=[];
  const validPhases=input.phases.length>0 && input.phases.every(p=>Number.isFinite(p.duty)&&p.duty>=0&&p.duty<=1&&positive(p.watts));
  if (!validPhases) missingInputs.push('phase_power');
  if (Math.abs(input.phases.reduce((n,p)=>n+p.duty,0)-1)>1e-9) missingInputs.push('duty_sum');
  const watts=input.phases.reduce((n,p)=>n+p.duty*p.watts,0);
  const estimate=missingInputs.length ? null : estimateEnergy({...input,watts});
  if (!estimate && !missingInputs.length) missingInputs.push('battery_inputs');
  return {modelVersion:'energy-v1',provenance:'illustrative' as const,units:{energy:'Wh',power:'W',runtime:'h'},assumptions:['Power measured at battery','Constant duty cycle; no hardware validation'],watts,estimate,missingInputs};
}
