/** Closed server-owned experiments of MJ-TRAY01 (R4-A 7.4). Like the payload family, a selector creates a new project/bundle/run; nothing is edited live.
 * A variant differs from the one it is compared with in exactly one KNOB. Friction is one knob that moves the cup's own friction and the tray contact together (the engine takes the
 * larger of the two faces); acceleration is one knob that moves the navigation policy and the base controller's limit together (the limit is only an upper bound, never below the policy). */
export const TRAY_ACCELERATION=Object.freeze({
 nominal:Object.freeze({policyMps2:0.5,baseLimitMps2:1}),
 high:Object.freeze({policyMps2:2.5,baseLimitMps2:3}),
});
const nominal={load:'cup-triple',physics:'drive-contact-profile',driveExperimentId:'drive-nominal-v1',accelerationPolicy:'nominal',actor:false} as const;
const low={...nominal,load:'cup-triple-low-friction',physics:'drive-contact-tray-low-v1'} as const;
export interface TrayExperiment{load:'cup-triple'|'cup-triple-low-friction';physics:'drive-contact-profile'|'drive-contact-tray-low-v1';driveExperimentId:string;accelerationPolicy:'nominal'|'high';actor:boolean;comparedWith:string|null}
export const TRAY_EXPERIMENTS:Readonly<Record<'tray-nominal-v1'|'tray-low-friction-v1'|'tray-accel-high-v1'|'tray-torque-limited-v1'|'tray-person-crossing-v1',TrayExperiment>>=Object.freeze({
 'tray-nominal-v1':Object.freeze({...nominal,comparedWith:null}),
 'tray-low-friction-v1':Object.freeze({...low,comparedWith:'tray-nominal-v1'}),
 'tray-accel-high-v1':Object.freeze({...low,accelerationPolicy:'high' as const,comparedWith:'tray-low-friction-v1'}),
 'tray-torque-limited-v1':Object.freeze({...nominal,driveExperimentId:'drive-torque-limited-v1',comparedWith:'tray-nominal-v1'}),
 'tray-person-crossing-v1':Object.freeze({...nominal,actor:true,comparedWith:'tray-nominal-v1'}),
});
export type TrayExperimentId=keyof typeof TRAY_EXPERIMENTS;
export const isTrayExperiment=(id:unknown):id is TrayExperimentId=>typeof id==='string'&&Object.hasOwn(TRAY_EXPERIMENTS,id);
export const trayExperiment=(id:string):TrayExperiment=>{if(!isTrayExperiment(id))throw new Error('MUJOCO_EXPERIMENT_UNREGISTERED');return TRAY_EXPERIMENTS[id];};
const knobs=(e:TrayExperiment)=>({friction:e.load,acceleration:e.accelerationPolicy,drive:e.driveExperimentId,actor:e.actor});
/** The knobs (friction, acceleration, drive, actor) in which two registered variants differ. */
export const trayKnobDifference=(a:string,b:string)=>{const x=knobs(trayExperiment(a)),y=knobs(trayExperiment(b));return (Object.keys(x) as (keyof typeof x)[]).filter(k=>x[k]!==y[k]);};
/** sha256 of fixtures/serve-tray-v1/tray-policy-v1.json: the thresholds a tray run is judged by are the reviewed ones (tests/unit/tray-fixture.test.ts keeps it equal to the file). */
export const TRAY_POLICY_SHA='3131303dd7230d3287a0f7d035dd657323c5f5e2d55fce1a223f4c4527a0a383';
