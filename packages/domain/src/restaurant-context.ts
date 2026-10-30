import type { CommandEnvelope, Decision, DomainEvent, Handler, JsonObject, JsonValue, Snapshot } from '../../contracts/src/index';
import { hashPayload } from '../../contracts/src/canonical';
import { stateEvent, type ModuleRegistry } from './modules';
import { canonicalMinor } from './shared/money';
import { evaluateFeature } from './policy/evaluate';
import type { FeatureConfig } from './policy/registry';
import {runtimeReadiness} from './policy/readiness';
export class DomainFault extends Error {}
export const fail = (code: string): never => { throw new DomainFault(code); };
export const text = (value: JsonValue | undefined, code = 'INVALID_ID'): string => typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : fail(code);
export const amount = (value: JsonValue | undefined, positive = false): string => {
  const result = text(value, 'INVALID_AMOUNT');
  try { canonicalMinor(result); } catch { return fail('INVALID_AMOUNT'); }
  if (BigInt(result) < 0n || (positive && BigInt(result) === 0n)) return fail('INVALID_AMOUNT');
  return result;
};
export const quantity = (value: JsonValue | undefined): string => typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value) ? value : fail('INVALID_QUANTITY');
export const record = (value: JsonValue | undefined): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : fail('INVALID_OBJECT');
export const records = (value: JsonValue | undefined): JsonObject[] => Array.isArray(value) && value.length > 0 && value.length <= 100 ? value.map(record) : fail('INVALID_ITEMS');
export const all = (snapshots: Snapshot[], kind: string): Snapshot[] => snapshots.filter(s => s.ref.kind === kind);
export const find = (snapshots: Snapshot[], kind: string, id: string): Snapshot | undefined => snapshots.find(s => s.ref.kind === kind && s.ref.id === id);
export const requireState = (snapshots: Snapshot[], kind: string, id: string): Snapshot => find(snapshots, kind, id) ?? fail('NOT_FOUND');
export const stableId = (prefix: string, command: CommandEnvelope, suffix = ''): string => `${prefix}-${hashPayload({operationId:command.operationId,suffix}).slice(0,32)}`;
export const updated = (snapshot: Snapshot, change: JsonObject): JsonObject => ({ ...snapshot.state, ...change, version: snapshot.version + 1 });
export const changed = (type:string,snapshot:Snapshot,change:JsonObject):DomainEvent => stateEvent(type,snapshot.ref.kind,snapshot.ref.id,updated(snapshot,change));
export const created = (type:string,kind:string,id:string,state:JsonObject):DomainEvent => stateEvent(type,kind,id,{...state,version:1});
export function expectVersion(command:CommandEnvelope,snapshot:Snapshot): void {
  const expected=command.expectedVersion ?? command.payload.expectedVersion;
  if(expected === undefined) return fail('VERSION_REQUIRED');
  if(expected !== snapshot.version) return fail('VERSION_CONFLICT');
}
export const done=(events:DomainEvent[],value:JsonObject={}):Decision=>({ok:true,events,value});
export function handle(registry:ModuleRegistry,type:string,handler:Handler):void {
 registry.register(type,(command,snapshots)=>{
   try {
    guardFeature(command,snapshots);
    return handler(command,snapshots);
   }
   catch(error) { if(error instanceof DomainFault) return {ok:false,code:error.message}; throw error; }
 });
}

const commandFeatures:Record<string,{feature:string;intent:'new'|'finish_existing'}>={
 'Catalog.Quote':{feature:'catalog',intent:'new'},
 'Session.Open':{feature:'sessions',intent:'new'},
 'Order.Place':{feature:'pos.order',intent:'new'},
 'Order.Amend':{feature:'pos.order',intent:'new'},
 'Kitchen.Accept':{feature:'kitchen',intent:'finish_existing'},
 'Kitchen.Ready':{feature:'kitchen',intent:'finish_existing'},
 'Fulfillment.Allocate':{feature:'fulfillment',intent:'finish_existing'},
 'Fulfillment.HandOff':{feature:'fulfillment',intent:'finish_existing'},
 'Mission.Create':{feature:'robot.delivery',intent:'new'},
 'Shift.Open':{feature:'cash.shift',intent:'new'},
 'Bill.Prepare':{feature:'billing',intent:'finish_existing'},
 'Payment.RecordCash':{feature:'payment.cash',intent:'finish_existing'},
 'Bill.Close':{feature:'billing',intent:'finish_existing'},
};
function guardFeature(command:CommandEnvelope,snapshots:Snapshot[]):void {
 const mapped=commandFeatures[command.type];
 if(!mapped) return;
 const policy=find(snapshots,'configuration','applied') ?? fail('CONFIGURATION_REQUIRED');
 const features=policy.state.features as unknown as FeatureConfig;
 const feature=command.type==='Mission.Create' ? command.payload.kind==='bus'?'robot.bussing':command.payload.kind==='guide'?'robot.guide':mapped.feature : mapped.feature;
 const result=evaluateFeature({feature,status:features?.[feature]?.status ?? 'disabled',intent:mapped.intent,revision:Number(policy.state.revision),policyRevision:command.policyRevision,features,readiness:runtimeReadiness(snapshots)});
 if(!result.allowed) return fail(result.reason);
}
