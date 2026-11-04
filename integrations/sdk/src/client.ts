/**
 * MEKONIQ automation client. Generated-by-hand mirror of the three automation endpoints (see docs/integrations/developer-guide.md); a drift test in
 * tests/contract/automation-scopes.test.ts keeps it aligned with the routes. It sends only allowlisted commands, always with a caller-chosen operationId,
 * and treats pending/unknown as "ask again with the SAME operationId" — never as a reason to send a new command.
 */
export type CommandStatus = 'pending' | 'accepted' | 'rejected' | 'unknown';
export type CommandResult = { operationId: string; status: CommandStatus; ack?: string; code?: string; type?: string; duplicate?: boolean; value?: Record<string, unknown> };
export type EventRecord = { id: string; version: number; state: Record<string, unknown> };
export type EventPage = { kind: string; records: EventRecord[]; next: string | null; appliedAt: string | null };
export type ClientOptions = { baseUrl: string; token: string; fetch?: typeof fetch };
export class MekoniqError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
export function createClient(options: ClientOptions) {
  const f = options.fetch ?? fetch, base = options.baseUrl.replace(/\/$/, '');
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(base + path, { method, headers: { Authorization: `Bearer ${options.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw new MekoniqError(String(data.code ?? 'REQUEST_FAILED'), res.status);
    return data as T;
  }
  const venue = (venueId: string) => `/v1/automation/venues/${encodeURIComponent(venueId)}`;
  return {
    /** Idempotent by `operationId`: the same id again returns the same command. Choose it from the thing that triggered you (e.g. `delivery-<allocation group>`), never random per attempt. */
    submitCommand: (input: { venueId: string; operationId: string; type: string; payload: Record<string, unknown> }) =>
      call<CommandResult>('POST', `${venue(input.venueId)}/commands`, { type: input.type, operationId: input.operationId, payload: input.payload }),
    getCommandResult: (venueId: string, operationId: string) => call<CommandResult>('GET', `${venue(venueId)}/commands/${encodeURIComponent(operationId)}`),
    listEvents: (venueId: string, kind: string, after = '') => call<EventPage>('GET', `${venue(venueId)}/events?kind=${encodeURIComponent(kind)}${after ? `&after=${encodeURIComponent(after)}` : ''}`),
  };
}
export type Client = ReturnType<typeof createClient>;
/**
 * Submit, then follow the SAME operationId until the venue answers (or attempts run out). pending/unknown are returned as they are — the caller keeps the operationId and asks again later;
 * a new operationId would be a new command.
 */
export async function submitAndResolve(client: Client, input: Parameters<Client['submitCommand']>[0], options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<CommandResult> {
  let result = await client.submitCommand(input);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  for (let i = 0; i < (options.attempts ?? 5) && (result.status === 'pending' || result.status === 'unknown'); i++) {
    await sleep(options.delayMs ?? 1000);
    result = await client.getCommandResult(input.venueId, input.operationId);
  }
  return result;
}
/** Explicit capability check before asking for a delivery: a robot with trays whose map is the venue's current one. Anything else means "leave it to staff", not "try anyway". */
export function deliveryCapableRobots(robots: EventRecord[], currentMapRevision: string): EventRecord[] {
  return robots.filter(r => Number(r.state.trays) >= 1 && r.state.mapRevision === currentMapRevision && r.state.status !== 'offline' && r.state.driver !== undefined);
}
/** Allocation groups (one per session) that are reserved and not yet on a mission: what a "fulfillment ready" subscription turns into one delivery. */
export function readyDeliveries(allocations: EventRecord[]): { groupId: string; allocationIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const a of allocations) if (a.state.status === 'reserved' && !a.state.missionId) groups.set(String(a.state.sessionId), [...(groups.get(String(a.state.sessionId)) ?? []), a.id]);
  return [...groups].map(([groupId, allocationIds]) => ({ groupId, allocationIds: allocationIds.sort() }));
}
/** The command for one ready delivery. operationId and missionId derive from the group, so a replayed event produces the same mission, once. */
export const deliveryCommand = (venueId: string, group: { groupId: string; allocationIds: string[] }) => ({
  venueId, operationId: `delivery-${group.groupId}`, type: 'Mission.Create',
  payload: { missionId: `delivery-${group.groupId}`, kind: 'delivery', allocationIds: group.allocationIds },
});
