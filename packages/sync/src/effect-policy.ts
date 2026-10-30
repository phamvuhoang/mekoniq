import type {JournalKind} from '../../contracts/generated/wire';
export function mayEmitLiveEffect(kind:JournalKind){return kind==='intent';}
export type EffectAuthority={kind:JournalKind;scopeMatches:boolean;epochMatches:boolean;policyAllowed:boolean;expiresAtMs:number;nowMs:number;durableReceipt:'none'|'sending'|'confirmed'|'unknown'};
export function liveEffectAllowed(authority:EffectAuthority){return mayEmitLiveEffect(authority.kind)&&authority.scopeMatches&&authority.epochMatches&&authority.policyAllowed&&authority.expiresAtMs>authority.nowMs&&authority.durableReceipt==='none';}
