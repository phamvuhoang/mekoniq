// What a drive fault schedule may name, for a run that does not exist yet (health and validate; the runner re-checks against the scene it actually runs). Pure reads of the registered fixtures.
import {DRIVE_EXPERIMENTS,mobileDriveBundle,worldDriveBundle} from './drive-experiments';
export interface DriveFaultContext {axes:string[];lidars:string[]}
export type DriveFaultContextOf=(request:{mode?:string;backendSetId:string;scenarioId?:string;driveExperimentId?:string})=>Promise<DriveFaultContext|null>;
/** The cell names its experiment in the request: nine axes, no LiDAR transform. The mobile set's experiment is in the project (unknown here), so its wheels of the nominal AMR drive stand in and its one LiDAR is the
 * scene's `lidar-2d` of the registered robot `amr-1`; the run's own admission is the authority. */
export const driveFaultContextOf=(workerRoot:string):DriveFaultContextOf=>async r=>{
 if(r.mode!==undefined&&r.mode!=='simulation')return null;
 if(r.backendSetId==='engineering-mujoco-cell-v1'&&r.scenarioId==='MJ-CELL-BV01'&&r.driveExperimentId&&Object.hasOwn(DRIVE_EXPERIMENTS,r.driveExperimentId)){
  const b=await worldDriveBundle(workerRoot,r.driveExperimentId,'arm-1','');return {axes:b.model.axes.map(a=>a.axisId),lidars:[]};
 }
 if(r.backendSetId==='engineering-mujoco-3d-v1'){
  const b=await mobileDriveBundle(workerRoot,'drive-nominal-v1');return {axes:b.model.axes.map(a=>a.axisId),lidars:['amr-1/lidar-2d']};
 }
 return null;
};
