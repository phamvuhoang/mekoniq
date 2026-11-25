import {validVerification} from './verification';
import type {RunReport} from '../scenarios/controls';
import type {TwinSample} from '../twin/store';
/** Native timestamps keep their provider domain. Only this declared origin maps them to run ticks. */
export function reportClock(report:RunReport){
 const clock=report.manifest.clock,native=clock.native,map=validVerification(report.verification)?report.verification.armTickMap??[]:[];
 if(native&&(native.provider!=='gazebo_nav2'||!/^\d{1,40}$/.test(native.originNs)||!Number.isSafeInteger(native.businessEpochMs)||native.businessEpochMs<0))throw new Error('REPORT_CLOCK_INVALID');
 const s0=report.telemetry?.samples.find(s=>s.observedAt&&s.simTimeNs!==null);
 const epoch=native?.businessEpochMs??(s0?Date.parse(s0.observedAt!)-Number(BigInt(s0.simTimeNs!)/1000000n):report.businessEvents.length?Date.parse(report.businessEvents[0]!.at):0);
 return {eventTick:(at:string)=>Math.round((Date.parse(at)-epoch)/clock.tickMs),sampleTick:(s:TwinSample)=>{
  if(s.simTimeNs===null)return map.find(m=>m.entityId===s.entityId&&m.bootId===s.bootId&&m.seq===s.seq)?.runTick??NaN;
  if(native&&s.providerId!==native.provider)return NaN;
  return Math.floor(Number(BigInt(s.simTimeNs)-(native?BigInt(native.originNs):0n))/(clock.tickMs*1000000));
 }};
}
