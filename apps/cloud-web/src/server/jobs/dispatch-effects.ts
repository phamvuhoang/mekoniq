import {liveEffectAllowed,type EffectAuthority} from '../../../../../packages/sync/src/effect-policy';
export function assertLiveEffectAuthority(authority:EffectAuthority){if(!liveEffectAllowed(authority))throw new Error(authority.durableReceipt==='unknown'?'RECONCILIATION_REQUIRED':'LIVE_EFFECT_FORBIDDEN');}
