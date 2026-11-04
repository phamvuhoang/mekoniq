import type { JsonObject, RobotCommand } from '../../../contracts/src/index';
/** The ONE protocol version this build speaks. A different version (including 3.x) needs its own pinned schema and profile; nothing here is "close enough". */
export const VDA_VERSION = '2.0.0';
export type Identity = { manufacturer: string; serialNumber: string };
export type VdaAction = { actionType: string; actionId: string; blockingType: 'NONE' | 'SOFT' | 'HARD'; actionDescription?: string; actionParameters?: { key: string; value: string | number | boolean }[] };
export type VdaNode = { nodeId: string; sequenceId: number; released: boolean; nodePosition?: { x: number; y: number; theta?: number; mapId: string }; actions: VdaAction[] };
export type VdaEdge = { edgeId: string; sequenceId: number; released: boolean; startNodeId: string; endNodeId: string; maxSpeed?: number; actions: VdaAction[] };
export type VdaOrder = Identity & { headerId: number; timestamp: string; version: string; orderId: string; orderUpdateId: number; nodes: VdaNode[]; edges: VdaEdge[] };
export const orderTopic = (ns: string, id: Identity) => `${ns}/v2/${id.manufacturer}/${id.serialNumber}/order`;
const SAFE = /^[A-Za-z0-9_.:-]{1,64}$/;
/**
 * One stop = one VDA order (or an update of the mission's order). Node sequence ids are even, edge sequence ids odd, the first node is the node the vehicle is at now (VDA requires an update
 * to start where the vehicle is). `orderId` is the mission, `orderUpdateId` the mission revision — monotonic by construction, so a state for an older update can never complete a newer one.
 * The command's speed limit becomes the edge's maxSpeed; its target must name a node (`locationRef`), never a guessed coordinate.
 */
export function buildOrder(i: Identity & { headerId: number; now: Date; command: RobotCommand; currentNodeId: string; currentSequenceId: number }): { order: VdaOrder; targetNodeId: string } {
  const target = i.command.target as JsonObject, targetNodeId = String(target.locationRef ?? '');
  if (!SAFE.test(targetNodeId)) throw new Error('TARGET_NODE_REQUIRED');
  if (!SAFE.test(i.command.missionId) || !SAFE.test(i.currentNodeId)) throw new Error('INVALID_IDENTIFIER');
  if (!Number.isInteger(i.command.missionRevision) || i.command.missionRevision < 0) throw new Error('INVALID_ORDER_UPDATE');
  const start = i.currentSequenceId, speed = i.command.limits.speedLimitMps;
  const order: VdaOrder = { headerId: i.headerId, timestamp: i.now.toISOString(), version: VDA_VERSION, manufacturer: i.manufacturer, serialNumber: i.serialNumber, orderId: i.command.missionId, orderUpdateId: i.command.missionRevision,
    nodes: [{ nodeId: i.currentNodeId, sequenceId: start, released: true, actions: [] }, { nodeId: targetNodeId, sequenceId: start + 2, released: true, actions: [] }],
    edges: [{ edgeId: `e-${i.currentNodeId}-${targetNodeId}-${i.command.missionRevision}`.slice(0, 64), sequenceId: start + 1, released: true, startNodeId: i.currentNodeId, endNodeId: targetNodeId, ...(speed !== undefined ? { maxSpeed: speed } : {}), actions: [] }] };
  return { order, targetNodeId };
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const header = (m: Record<string, unknown>, problems: string[]) => {
  if (!Number.isInteger(m.headerId) || (m.headerId as number) < 0) problems.push('headerId');
  if (typeof m.timestamp !== 'string' || !Number.isFinite(Date.parse(m.timestamp))) problems.push('timestamp');
  if (m.version !== VDA_VERSION) problems.push('version');
  if (typeof m.manufacturer !== 'string' || !m.manufacturer || typeof m.serialNumber !== 'string' || !m.serialNumber) problems.push('identity');
};
/** Structural validation of the 2.0.0 order message (required fields, enums, sequence parity, graph consistency). Returns problems; empty = valid. */
export function validateOrder(raw: unknown): string[] {
  if (!isObj(raw)) return ['not an object'];
  const p: string[] = []; header(raw, p);
  if (typeof raw.orderId !== 'string' || !raw.orderId) p.push('orderId');
  if (!Number.isInteger(raw.orderUpdateId) || (raw.orderUpdateId as number) < 0) p.push('orderUpdateId');
  if (!Array.isArray(raw.nodes) || !raw.nodes.length || !Array.isArray(raw.edges)) return [...p, 'nodes/edges'];
  const ids = new Set<string>();
  raw.nodes.forEach((n, i) => {
    if (!isObj(n) || typeof n.nodeId !== 'string' || !Number.isInteger(n.sequenceId) || typeof n.released !== 'boolean' || !Array.isArray(n.actions)) return void p.push(`nodes[${i}]`);
    if ((n.sequenceId as number) % 2 !== 0) p.push(`nodes[${i}].sequenceId must be even`);
    ids.add(n.nodeId);
    (n.actions as unknown[]).forEach(a => { if (!isObj(a) || typeof a.actionType !== 'string' || typeof a.actionId !== 'string' || !['NONE', 'SOFT', 'HARD'].includes(String(a.blockingType))) p.push(`nodes[${i}].action`); });
  });
  raw.edges.forEach((e, i) => {
    if (!isObj(e) || typeof e.edgeId !== 'string' || !Number.isInteger(e.sequenceId) || typeof e.released !== 'boolean' || typeof e.startNodeId !== 'string' || typeof e.endNodeId !== 'string' || !Array.isArray(e.actions)) return void p.push(`edges[${i}]`);
    if ((e.sequenceId as number) % 2 !== 1) p.push(`edges[${i}].sequenceId must be odd`);
    if (!ids.has(e.startNodeId as string) || !ids.has(e.endNodeId as string)) p.push(`edges[${i}] references an unknown node`);
  });
  if (raw.edges.length !== raw.nodes.length - 1) p.push('edges must connect the nodes');
  return p;
}
export { header as validateHeader };
