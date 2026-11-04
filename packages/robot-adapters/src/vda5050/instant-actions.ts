import { VDA_VERSION, type Identity, type VdaAction } from './orders';
export type InstantActionsMessage = Identity & { headerId: number; timestamp: string; version: string; instantActions: VdaAction[] };
export const instantActionsTopic = (ns: string, id: Identity) => `${ns}/v2/${id.manufacturer}/${id.serialNumber}/instantActions`;
/** Request actions: cancelOrder (drop the current order), startPause (a soft pause — NOT a safety stop), stateRequest. None of these is an emergency stop, and none claims one. */
export function instantAction(i: Identity & { headerId: number; now: Date; actionType: 'cancelOrder' | 'startPause' | 'stopPause' | 'stateRequest'; actionId: string }): InstantActionsMessage {
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(i.actionId)) throw new Error('INVALID_IDENTIFIER');
  return { headerId: i.headerId, timestamp: i.now.toISOString(), version: VDA_VERSION, manufacturer: i.manufacturer, serialNumber: i.serialNumber, instantActions: [{ actionType: i.actionType, actionId: i.actionId, blockingType: i.actionType === 'cancelOrder' || i.actionType === 'startPause' ? 'HARD' : 'NONE' }] };
}
export function validateInstantActions(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['not an object'];
  const m = raw as Record<string, unknown>, p: string[] = [];
  if (m.version !== VDA_VERSION) p.push('version');
  if (!Array.isArray(m.instantActions) || !m.instantActions.length) p.push('instantActions');
  else (m.instantActions as Record<string, unknown>[]).forEach((a, i) => { if (typeof a?.actionType !== 'string' || typeof a?.actionId !== 'string' || !['NONE', 'SOFT', 'HARD'].includes(String(a?.blockingType))) p.push(`instantActions[${i}]`); });
  return p;
}
