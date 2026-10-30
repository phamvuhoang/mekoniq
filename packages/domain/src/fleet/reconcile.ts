import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {canonicalBytes,verifyEs256,type PublicEcJwk} from '../../../contracts/src/index';
import {text,requireState,change,ok,object} from '../continuity/shared';
export function prepareRobotReconciliation(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.robotId),robot=requireState(s,'robot',id),authority=requireState(s,'__scope__','authority');
  const challenge={robotId:id,nonce:c.operationId,commandId:robot.state.commandId??robot.state.nativeGoalId??null,controlEpoch:robot.state.controlEpoch??0,mapId:robot.state.mapId??null,mapRevision:robot.state.mapRevision??null,status:'requested',requestedAtMs:authority.state.nowMs??0};
  return ok([change('RobotReconciliationRequested','robot-recovery',id,challenge)],{challenge});
}
export function reconcileRobot(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.robotId),robot=requireState(s,'robot',id);
  if(!c.payload.proof)throw new Error('NATIVE_EVIDENCE_REQUIRED');
  const proof=object(c.payload.proof),challenge=requireState(s,'robot-recovery',id),authority=requireState(s,'__scope__','authority');
  if(challenge.state.status!=='requested'||proof.organizationId!==c.organizationId||proof.venueId!==c.venueId||proof.robotId!==id||proof.nonce!==challenge.state.nonce||proof.commandId!==challenge.state.commandId||proof.controlEpoch!==robot.state.controlEpoch||proof.mapId!==robot.state.mapId||proof.mapRevision!==robot.state.mapRevision)throw new Error('NATIVE_PROOF_MISMATCH');
  if(!['completed','cancelled','failed','executing','unknown'].includes(String(proof.status)))throw new Error('INVALID_NATIVE_STATE');
  const observedAtMs=Date.parse(String(proof.observedAt)),nowMs=Number(authority.state.nowMs);
  if(!Number.isFinite(observedAtMs)||observedAtMs<Number(challenge.state.requestedAtMs)||nowMs-observedAtMs>5000||observedAtMs-nowMs>1000)throw new Error('NATIVE_PROOF_STALE');
  const unsigned=Object.fromEntries(Object.entries(proof).filter(([key])=>key!=='signature'));
  if(!verifyEs256(canonicalBytes(unsigned),text(proof.signature),object(robot.state.executorPublicJwk) as PublicEcJwk))throw new Error('NATIVE_SIGNATURE_INVALID');
  const held=s.some(x=>x.ref.kind==='mission'&&x.state.robotId===id&&!['completed','cancelled','failed'].includes(String(x.state.status)))||s.some(x=>x.ref.kind==='reservation'&&x.state.robotId===id&&x.state.status!=='released');
  const available=!held&&['completed','cancelled','failed'].includes(String(proof.status));
  return ok([change('RobotReconciled','robot',id,{...robot.state,goalState:proof.status,proof,reconciledBy:c.actorRef,available,availability:available?'idle':robot.state.availability??'needs_attention'}),change('RobotReconciliationCompleted','robot-recovery',id,{...challenge.state,status:proof.status==='unknown'?'needs_attention':'verified',proof})],{requiresAttention:proof.status==='unknown'||held});
}
