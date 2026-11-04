import { VDA_VERSION, validateHeader, type Identity } from './orders';
export type VdaState = Identity & {
  headerId: number; timestamp: string; version: string; orderId: string; orderUpdateId: number; lastNodeId: string; lastNodeSequenceId: number; driving: boolean; paused?: boolean;
  operatingMode: 'AUTOMATIC' | 'SEMIAUTOMATIC' | 'MANUAL' | 'SERVICE' | 'TEACHIN';
  nodeStates: { nodeId: string; sequenceId: number; released: boolean }[]; edgeStates: { edgeId: string; sequenceId: number; released: boolean }[];
  actionStates: { actionId: string; actionType?: string; actionStatus: 'WAITING' | 'INITIALIZING' | 'RUNNING' | 'FINISHED' | 'FAILED'; resultDescription?: string }[];
  errors: { errorType: string; errorLevel: 'WARNING' | 'FATAL'; errorDescription?: string }[];
  batteryState: { batteryCharge: number; charging: boolean }; safetyState: { eStop: 'AUTOACK' | 'MANUAL' | 'REMOTE' | 'NONE'; fieldViolation: boolean };
};
export const stateTopic = (ns: string, id: Identity) => `${ns}/v2/${id.manufacturer}/${id.serialNumber}/state`;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Structural validation of the 2.0.0 state message fields this adapter relies on. */
export function validateState(raw: unknown): string[] {
  if (!isObj(raw)) return ['not an object'];
  const p: string[] = []; validateHeader(raw, p);
  if (typeof raw.orderId !== 'string') p.push('orderId');
  if (!Number.isInteger(raw.orderUpdateId)) p.push('orderUpdateId');
  if (typeof raw.lastNodeId !== 'string' || !Number.isInteger(raw.lastNodeSequenceId)) p.push('lastNode');
  if (typeof raw.driving !== 'boolean') p.push('driving');
  if (!['AUTOMATIC', 'SEMIAUTOMATIC', 'MANUAL', 'SERVICE', 'TEACHIN'].includes(String(raw.operatingMode))) p.push('operatingMode');
  for (const k of ['nodeStates', 'edgeStates', 'actionStates', 'errors']) if (!Array.isArray(raw[k])) p.push(k);
  if (Array.isArray(raw.actionStates)) (raw.actionStates as unknown[]).forEach((a, i) => { if (!isObj(a) || typeof a.actionId !== 'string' || !['WAITING', 'INITIALIZING', 'RUNNING', 'FINISHED', 'FAILED'].includes(String(a.actionStatus))) p.push(`actionStates[${i}]`); });
  if (Array.isArray(raw.errors)) (raw.errors as unknown[]).forEach((e, i) => { if (!isObj(e) || typeof e.errorType !== 'string' || !['WARNING', 'FATAL'].includes(String(e.errorLevel))) p.push(`errors[${i}]`); });
  if (!isObj(raw.batteryState) || typeof raw.batteryState.batteryCharge !== 'number' || typeof raw.batteryState.charging !== 'boolean') p.push('batteryState');
  if (!isObj(raw.safetyState) || !['AUTOACK', 'MANUAL', 'REMOTE', 'NONE'].includes(String(raw.safetyState.eStop)) || typeof raw.safetyState.fieldViolation !== 'boolean') p.push('safetyState');
  return p;
}
/** Plan function: a state counts for an order only if BOTH the order id and the update id are the ones we are waiting for. */
export function currentOrderState(expected: { id: string; update: number }, state: { orderId: string; orderUpdateId: number }): boolean {
  return expected.id === state.orderId && expected.update === state.orderUpdateId;
}
/** Everything has been traversed and the vehicle is standing at the target: the VDA definition of "order finished" (no remaining released nodes/edges, not driving, last node = target). */
export function orderFinished(state: VdaState, targetNodeId: string): boolean {
  return state.nodeStates.length === 0 && state.edgeStates.length === 0 && !state.driving && state.lastNodeId === targetNodeId && !state.actionStates.some(a => a.actionStatus !== 'FINISHED');
}
export { VDA_VERSION };
