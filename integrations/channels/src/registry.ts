import { catalog, loadEnabledProfiles } from '../../core/src/profile';
import type { Connector } from '../../core/src/connector';
/**
 * Which channel connectors exist. A connector is added here together with its profile, written from that channel's own documentation (see docs/integrations/profile-onboarding.md); until then the
 * channel is simply unregistered and every request for it is PROVIDER_NOT_ENABLED. Today only the emulator profiles resolve, and only in a sandbox runtime.
 */
const runtime = (): 'release' | 'sandbox' => (process.env.INTEGRATION_RUNTIME === 'sandbox' ? 'sandbox' : 'release');
export function channelConnectorFor(provider: string, sandboxFactory: () => Connector): Connector {
  const profile = loadEnabledProfiles(catalog, runtime()).find(p => p.kind === 'channel' && p.id === provider);
  if (!profile) throw new Error('PROVIDER_NOT_ENABLED');
  if (profile.mode === 'simulation') return sandboxFactory();
  throw new Error('PROVIDER_NOT_ENABLED'); // an approved real channel needs its own adapter registered here
}
