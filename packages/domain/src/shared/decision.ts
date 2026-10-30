export type { Decision, DomainEvent } from '../../../contracts/src/index';
import type { Decision, DomainEvent, JsonObject } from '../../../contracts/src/index';
export const reject = (code: string, details?: JsonObject): Decision => details ? { ok: false, code, details } : { ok: false, code };
export const accept = (events: DomainEvent[], value: JsonObject = {}): Decision => ({ ok: true, events, value });
