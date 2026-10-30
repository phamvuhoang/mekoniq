import {createLab} from './lab';
import {registerContinuityModules} from '../../packages/domain/src/continuity/module';
export async function createContinuityLab() {
  const lab=await createLab(registerContinuityModules);
  lab.addAuthorization((actor,type)=>['manager','owner'].includes(actor)||['Continuity.CaptureTicket','Continuity.RecordPaymentObservation','SettlementGrant.Use','SettlementGrant.Return'].includes(type));
  return lab;
}
