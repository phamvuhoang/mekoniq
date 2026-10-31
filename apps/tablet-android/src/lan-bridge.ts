import { registerPlugin } from '@capacitor/core';
import type { CommandEnvelope, CommandResult, JsonObject } from '../../../packages/contracts/src/index';
import type { NativeJournal } from '../../../packages/sync/src/storage/android';
import type { TabletSession } from '../../tablet-web/src/transport/session';
export const Journal=registerPlugin<NativeJournal>('Journal');
export const Identity=registerPlugin<{
  cloudRequest(input:{requestId?:string;method:'GET'|'POST';path:string;body?:JsonObject}):Promise<{status:number;body:JsonObject}>;
  cancelNetworkRequest(input:{requestId:string}):Promise<{cancelled:boolean}>;
  enroll(input:{accessToken:string}):Promise<{deviceId:string;deviceEpoch:string;provisioned:boolean}>;
  refreshProvisioning(input:{accessToken:string}):Promise<{deviceId:string;deviceEpoch:string;provisioned:boolean}>;
  session():Promise<TabletSession & {isCoordinator:boolean}>;
  installGrant(input:{grant:JsonObject}):Promise<void>;
  publicJwk():Promise<{jwk:JsonObject;hardwareBacked:boolean;certificate:string;certificateFingerprint:string}>;
  deviceEpoch():Promise<{deviceEpoch:string}>;
}>('Identity');
export const Lan=registerPlugin<{
  pairingOffer(input:{endpoint:string;organizationId:string;venueId:string}):Promise<JsonObject>;
  pairWithCoordinator(input:{offer:JsonObject}):Promise<{paired:true}>;
  start():Promise<{started:boolean}>;
  stop():Promise<void>;
  heartbeat(input:{storeWritable:boolean}):Promise<{ready:boolean}>;
  poll():Promise<{requests:{id:string;command:CommandEnvelope;authorization:JsonObject}[]}>;
  complete(input:{id:string;result:CommandResult}):Promise<void>;
  exchangeCheckpoints():Promise<void>;
  flushSettlementObservations():Promise<{accepted:number}>;
  pullSnapshots():Promise<{snapshots:import('../../../packages/contracts/src/index').Snapshot[]}>;
  send(input:{command:CommandEnvelope}):Promise<CommandResult>;
}>('Lan');
