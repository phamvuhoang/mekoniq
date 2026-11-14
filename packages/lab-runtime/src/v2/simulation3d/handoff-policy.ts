/** Pure, fail-closed observation policies. Callers supply independently measured samples. */
export interface HandoffIdentity {robotId:string;trayId:string;commandId?:string;controlEpoch?:number}
export interface DockSample extends HandoffIdentity {tick:number;xyErrorM:number;yawErrorRad:number;vMps:number;omegaRadps:number;valid:boolean}
export interface DockPolicy extends HandoffIdentity {maxXyM:number;maxYawRad:number;maxVMps:number;maxOmegaRadps:number;holdTicks:number;expectedTick?:number}
export interface ReceiptSample extends DockSample {cupId:string;propId:string;supportId:string|null;relativeSpeedMps:number;insideSupportMargin:boolean;held:boolean}
export interface ReceiptPolicy extends DockPolicy {cupId:string;propId:string;supportId:string;maxRelativeMps:number}
export interface HandoffReadiness {ready:boolean;reasonCodes:string[]}
const finiteNonnegative=(v:number)=>Number.isFinite(v)&&v>=0;
function policyValid(p:DockPolicy){return !!p.robotId&&!!p.trayId&&Number.isSafeInteger(p.holdTicks)&&p.holdTicks>=1&&p.holdTicks<=30000&&[p.maxXyM,p.maxYawRad,p.maxVMps,p.maxOmegaRadps].every(finiteNonnegative)&&(p.expectedTick===undefined||Number.isSafeInteger(p.expectedTick)&&p.expectedTick>=0)&&(p.controlEpoch===undefined||Number.isSafeInteger(p.controlEpoch)&&p.controlEpoch>=1);}
function dockReasons(s:DockSample,p:DockPolicy):string[]{
 const codes:string[]=[];
 if(!s.valid||!Number.isSafeInteger(s.tick)||s.tick<0||![s.xyErrorM,s.yawErrorRad,s.vMps,s.omegaRadps].every(Number.isFinite)||s.xyErrorM<0)codes.push('SAMPLE_INVALID');
 if(s.robotId!==p.robotId||s.trayId!==p.trayId||p.commandId!==undefined&&s.commandId!==p.commandId||p.controlEpoch!==undefined&&s.controlEpoch!==p.controlEpoch)codes.push('IDENTITY_MISMATCH');
 if(s.xyErrorM>p.maxXyM||Math.abs(s.yawErrorRad)>p.maxYawRad)codes.push('DOCK_OUT_OF_TOLERANCE');
 if(Math.abs(s.vMps)>p.maxVMps||Math.abs(s.omegaRadps)>p.maxOmegaRadps)codes.push('DOCK_MOVING');
 return codes;
}
function window<T extends DockSample>(samples:readonly T[],p:DockPolicy,reasons:(s:T)=>string[]):HandoffReadiness {
 if(!policyValid(p))return {ready:false,reasonCodes:['POLICY_INVALID']};
 const last=samples.at(-1);if(!last)return {ready:false,reasonCodes:['WINDOW_INCOMPLETE']};
 if(p.expectedTick!==undefined&&last.tick!==p.expectedTick)return {ready:false,reasonCodes:['SAMPLE_STALE_OR_FUTURE']};
 const recent=samples.slice(-p.holdTicks),codes:string[]=[];
 if(recent.length<p.holdTicks)codes.push('WINDOW_INCOMPLETE');
 for(let i=0;i<recent.length;i++){const s=recent[i]!;codes.push(...reasons(s));if(i&&s.tick!==recent[i-1]!.tick+1)codes.push('SAMPLE_SEQUENCE_INVALID');}
 return {ready:codes.length===0,reasonCodes:[...new Set(codes)]};
}
export function evaluateDockWindow(samples:readonly DockSample[],policy:DockPolicy):HandoffReadiness {return window(samples,policy,s=>dockReasons(s,policy));}
/** `supportId` here must be actual current contact, never the load coordinate reference. */
export function evaluateTrayReceipt(samples:readonly ReceiptSample[],policy:ReceiptPolicy):HandoffReadiness {
 if(!policy.supportId||!policy.cupId||!policy.propId||!finiteNonnegative(policy.maxRelativeMps))return {ready:false,reasonCodes:['POLICY_INVALID']};
 return window(samples,policy,s=>{const codes=dockReasons(s,policy);
  if(s.cupId!==policy.cupId||s.propId!==policy.propId)codes.push('IDENTITY_MISMATCH');
  if(s.supportId!==policy.supportId||s.insideSupportMargin!==true)codes.push('RECEIVER_SUPPORT_INVALID');
  if(s.held!==false)codes.push('GIVER_STILL_HOLDING');
  if(!finiteNonnegative(s.relativeSpeedMps)||s.relativeSpeedMps>policy.maxRelativeMps)codes.push('RECEIVER_MOVING');
  return codes;
 });
}
