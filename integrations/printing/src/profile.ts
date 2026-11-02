import type { JsonObject } from '../../../packages/contracts/src/index';
export type PrinterSupport = { ready: boolean; reason: string };
/**
 * Whether an installed printer profile (snapshot kind `printer`) may take jobs. Readiness comes only from this installed state:
 * - network: ready once the profile is installed with a fixture (spool/protocol) or venue_approved (physical test passed, W11) validation;
 * - usb: needs venue_approved (a physical USB print was verified on the target tablet), otherwise unsupported;
 * - bluetooth and anything else: unsupported (no verified Android transport).
 * `fixture` validation only proves the spool and ESC/POS bytes; it never claims a physical print.
 */
export function printerSupport(p: JsonObject): PrinterSupport {
  const no = (reason: string): PrinterSupport => ({ ready: false, reason });
  if (p.status !== 'installed') return no('PRINTER_NOT_INSTALLED');
  if (typeof p.model !== 'string' || !p.model || typeof p.profile !== 'string' || !p.profile) return no('PRINTER_PROFILE_INCOMPLETE');
  const columns = Number(p.columns);
  if (!Number.isInteger(columns) || columns < 24 || columns > 64) return no('PRINTER_PROFILE_INCOMPLETE');
  if (!['fixture', 'venue_approved'].includes(String(p.validation))) return no('PRINTER_UNVALIDATED');
  if (p.transport === 'network') return { ready: true, reason: 'OK' };
  if (p.transport === 'usb') return p.validation === 'venue_approved' ? { ready: true, reason: 'OK' } : no('USB_UNVERIFIED');
  if (p.transport === 'bluetooth') return no('BLUETOOTH_UNSUPPORTED');
  return no('TRANSPORT_UNSUPPORTED');
}
