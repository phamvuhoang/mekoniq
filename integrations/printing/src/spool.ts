import type { JsonObject, Scope, Snapshot } from '../../../packages/contracts/src/index';
import { renderEscPos } from './escpos';
import { printerSupport } from './profile';
import type { Receipt } from './receipt';
export interface PrintEffectStore {
  effects(scope: Scope, type?: string): Promise<JsonObject[]>;
  claimEffect(scope: Scope, id: string): Promise<boolean>;
  completeEffect(scope: Scope, id: string, status: 'confirmed' | 'unknown' | 'failed'): Promise<void>;
  snapshots(scope: Scope): Promise<Snapshot[]>;
}
/** A printer transport (native network/USB socket on the tablet, a fixture in tests). `acknowledged` is true only when the printer itself confirmed the job (e.g. real-time status read-back). */
export interface PrinterTransport { send(bytes: Uint8Array, ctx: { printerId: string; jobId: string; effectId: string; attempt: number }): Promise<{ acknowledged: boolean }> }
/** Thrown by a transport when it knows NO byte left the device (refused connection, unsupported): the only case a job may be marked failed after sending began. */
export class PrinterNotReached extends Error {}
export type PrintOutcome = { id: string; jobId: string; status: 'confirmed' | 'unknown' | 'failed'; code?: string };
/** Outbox status -> printer state shown to staff: pending -> pending, dispatching -> sent (bytes in flight / written, no ack), then unknown | confirmed (failed = nothing was sent). */
export const printState = (effectStatus: string): string => effectStatus === 'dispatching' ? 'sent' : effectStatus;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => { let t: ReturnType<typeof setTimeout>; return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('PRINTER_TIMEOUT')), ms); })]).finally(() => clearTimeout(t)); };
/**
 * Durable spool dispatcher over the effect outbox (same claim -> attempt -> complete pattern as robot effects). Each `printer.send` effect is one attempt:
 * - pending: claim (attempts + 1), render ESC/POS from the stored receipt, send once. Printer ack -> confirmed; written/timed out/any error with no ack -> unknown;
 *   PrinterNotReached or an unusable printer profile (nothing sent) -> failed.
 * - dispatching (claimed, outcome never recorded: crash mid-send) and unknown: NEVER sent again. A mid-send crash becomes unknown; staff decide on a reprint
 *   (Print.ConfirmReprint), which creates a new effect, so the same paper is never produced twice silently.
 * `onOutcome` runs after the outcome is stored (the caller records it on the print job via Print.Observe).
 */
export async function dispatchPrintEffects(store: PrintEffectStore, scope: Scope, transport: PrinterTransport, options: { timeoutMs?: number; onOutcome?: (o: PrintOutcome) => Promise<void> } = {}): Promise<PrintOutcome[]> {
  const out: PrintOutcome[] = [];
  const finish = async (id: string, jobId: string, status: PrintOutcome['status'], code?: string) => { await store.completeEffect(scope, id, status); const o: PrintOutcome = { id, jobId, status, ...(code ? { code } : {}) }; out.push(o); await options.onOutcome?.(o); };
  for (const row of (await store.effects(scope, 'printer.send')).filter(e => ['pending', 'dispatching'].includes(String(e.status)))) {
    const id = String(row.id), payload = row.payload as JsonObject, jobId = String(payload.jobId ?? '');
    if (row.status === 'dispatching') { await finish(id, jobId, 'unknown', 'INTERRUPTED_IN_FLIGHT'); continue; }
    const printer = (await store.snapshots(scope)).find(s => s.ref.kind === 'printer' && s.ref.id === payload.printerId);
    if (!printer || !printerSupport(printer.state).ready) { await finish(id, jobId, 'failed', printer ? printerSupport(printer.state).reason : 'PRINTER_NOT_FOUND'); continue; }
    let bytes: Uint8Array;
    try { bytes = renderEscPos(payload.receipt as unknown as Receipt, { columns: Number(printer.state.columns), ...(payload.reprint ? { reprint: { number: Number(payload.reprintNumber) } } : {}) }); } catch { await finish(id, jobId, 'failed', 'RENDER_FAILED'); continue; }
    if (!await store.claimEffect(scope, id)) continue;
    try {
      const { acknowledged } = await withTimeout(transport.send(bytes, { printerId: String(payload.printerId), jobId, effectId: id, attempt: Number(row.attempts ?? 0) + 1 }), options.timeoutMs ?? 5000);
      await finish(id, jobId, acknowledged ? 'confirmed' : 'unknown', acknowledged ? undefined : 'NO_PRINTER_ACK');
    } catch (error) { await finish(id, jobId, error instanceof PrinterNotReached ? 'failed' : 'unknown', error instanceof PrinterNotReached ? 'NOT_SENT' : error instanceof Error && error.message === 'PRINTER_TIMEOUT' ? 'PRINTER_TIMEOUT' : 'SEND_ERROR'); }
  }
  return out;
}
