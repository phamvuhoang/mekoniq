import { VDA_VERSION, type Identity } from './orders';
export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'CONNECTIONBROKEN';
export type ConnectionMessage = Identity & { headerId: number; timestamp: string; version: string; connectionState: ConnectionState };
export const connectionTopic = (ns: string, id: Identity) => `${ns}/v2/${id.manufacturer}/${id.serialNumber}/connection`;
export function parseConnection(raw: unknown): ConnectionMessage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.version !== VDA_VERSION || typeof m.manufacturer !== 'string' || typeof m.serialNumber !== 'string' || !['ONLINE', 'OFFLINE', 'CONNECTIONBROKEN'].includes(String(m.connectionState)) || !Number.isInteger(m.headerId) || typeof m.timestamp !== 'string') return undefined;
  return m as unknown as ConnectionMessage;
}
