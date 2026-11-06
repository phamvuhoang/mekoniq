import { profiles, preset } from './presets';
import { featureRegistry, type FeatureConfig } from './registry';
/**
 * Modules that exist end to end in this build (domain commands, permissions, policy gate, UI). A preset may only switch these on: a template that enabled `chain`, `online`,
 * `einvoice`… would show a feature with nothing behind it. When W09/W10 land, add the module here in the same change.
 */
export const IMPLEMENTED_FEATURES: ReadonlySet<string> = new Set([
  'catalog', 'sessions', 'pos.order', 'qr.order', 'kiosk.order', 'robot.order', 'orders', 'kitchen', 'fulfillment', 'robot.delivery', 'robot.bussing', 'fleet', 'discount', 'billing',
  'payment.cash', 'payment.transfer.manual', 'payment.terminal', 'refund', 'cash.shift', 'printing', 'guest.call', 'guest.bill', 'robot.guide',
  'reservations', 'promotion', 'loyalty', 'inventory', 'procurement', 'workforce', 'reporting', 'service.models',
  // W09-T03: external channel orders (ExternalOrder.* commands, gated by this feature). `chain` is organisation-level cloud management, not a per-venue switch, so it stays out of this list.
  'online',
  // Coffee cell module (Coffee.*/Cup.* commands, permissions, this gate); no template enables it, a venue with a configured cell does.
  'beverage',
]);
export const PRESET_NAMES = Object.keys(profiles);
/** What the capability matrix wants for a venue type beyond what the template can enable yet. */
const WANTED_BEYOND: Record<string, string[]> = { chain: ['chain', 'online'] };
export type PresetAcceptance = { name: string; enabled: string[]; unimplemented: string[]; deferred: string[]; needsReadiness: string[]; dependencyErrors: string[]; ok: boolean };
const enabledOf = (f: FeatureConfig) => Object.entries(f).filter(([, v]) => v.status === 'enabled').map(([k]) => k).sort();
/** Is this template safe to offer: dependencies hold and every module it turns on is implemented. `deferred` lists the modules the venue type needs that do not exist yet. */
export function presetAcceptance(name: string): PresetAcceptance {
  let enabled: string[] = [], dependencyErrors: string[] = [];
  try { enabled = enabledOf(preset(name).features); } catch (e) { if ((e as Error).message === 'UNKNOWN_PRESET') throw e; dependencyErrors = (e as Error).message.split(','); }
  const unimplemented = enabled.filter(f => !IMPLEMENTED_FEATURES.has(f)), deferred = (WANTED_BEYOND[name] ?? []).filter(f => !IMPLEMENTED_FEATURES.has(f));
  return { name, enabled, unimplemented, deferred, needsReadiness: enabled.filter(f => featureRegistry[f]?.readiness), dependencyErrors, ok: dependencyErrors.length === 0 && unimplemented.length === 0 };
}
/**
 * What choosing `name` would change for a venue running `current`. It only describes: nothing is applied, modules that do not exist are `blocked` instead of enabled, and
 * a module turned off appears under `drain` (accepted work finishes before it goes — see transitionFeature), never as a deletion.
 */
export function presetMigrationPreview(current: FeatureConfig, name: string) {
  const target = enabledOf(preset(name).features), now = enabledOf(current), acceptance = presetAcceptance(name);
  const enable = target.filter(f => !now.includes(f) && IMPLEMENTED_FEATURES.has(f)), drain = now.filter(f => !target.includes(f));
  return { name, enable, drain, blocked: [...acceptance.unimplemented, ...acceptance.deferred], needsReadiness: enable.filter(f => featureRegistry[f]?.readiness), applied: false as const };
}
