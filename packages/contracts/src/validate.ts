import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import wireSchema from '../schemas/wire.schema.json';
import { assertJson, hashPayload } from './canonical';
import type { CommandEnvelope, JournalEntry, Money, SyncAck, CommitBatch, RobotCommand, JsonValue, SignedOfflineGrant, OwnershipGrant, AssetManifest, SettlementGrant, GrantReturnProof, SignedAuthorityProvision, SignedPairingGrant } from '../generated/wire';

export const COMMAND_BYTE_LIMIT = 256 * 1024;
export const SYNC_BYTE_LIMIT = 1024 * 1024;
export const SYNC_ENTRY_LIMIT = 100;
const encoder = new TextEncoder();
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(wireSchema);

function check<T>(type: string, value: unknown, limit = COMMAND_BYTE_LIMIT): T {
  assertJson(value);
  if (encoder.encode(JSON.stringify(value)).byteLength > limit) throw new Error('PAYLOAD_TOO_LARGE');
  const validate = ajv.getSchema(`mekoniq.wire.v1#/definitions/${type}`);
  if (!validate || !validate(value)) throw new Error(`INVALID_${type.toUpperCase()}: ${ajv.errorsText(validate?.errors)}`);
  return value as T;
}

export function validateEnvelope(value: unknown): CommandEnvelope {
  const envelope = check<CommandEnvelope>('CommandEnvelope', value);
  if (envelope.payloadHash !== hashPayload(envelope.payload)) throw new Error('PAYLOAD_HASH_MISMATCH');
  return envelope;
}
export function validateJournal(value: unknown): JournalEntry {
  const entry = check<JournalEntry>('JournalEntry', value,SYNC_BYTE_LIMIT);
  if (entry.payloadHash !== hashPayload(entry.payload)) throw new Error('PAYLOAD_HASH_MISMATCH');
  return entry;
}
export function validateMoney(value: unknown): Money { return check<Money>('Money', value); }
export function validateSyncAck(value: unknown): SyncAck { return check<SyncAck>('SyncAck', value, SYNC_BYTE_LIMIT); }
export function validateCommitBatch(value: unknown): CommitBatch {
  const batch = check<CommitBatch>('CommitBatch', value, SYNC_BYTE_LIMIT);
  validateEnvelope(batch.command);
  if (batch.result.operationId !== batch.command.operationId) throw new Error('INVALID_COMMIT_RESULT');
  return batch;
}
export function validateRobotCommand(value: unknown): RobotCommand {
  const command = check<RobotCommand>('RobotCommand', value);
  if (Date.parse(command.expiresAt) <= Date.parse(command.issuedAt)) throw new Error('INVALID_COMMAND_EXPIRY');
  return command;
}
export function validateSyncBatch(value: unknown): JournalEntry[] {
  if (!Array.isArray(value)) throw new Error('INVALID_SYNC_BATCH');
  if (value.length > SYNC_ENTRY_LIMIT) throw new Error('BATCH_TOO_LARGE');
  if (encoder.encode(JSON.stringify(value)).byteLength > SYNC_BYTE_LIMIT) throw new Error('PAYLOAD_TOO_LARGE');
  return value.map(validateJournal);
}

/** JSON ingress parser rejects duplicate decoded keys before JSON.parse can discard them. */
export function parseJsonStrict(text: string, maxBytes = COMMAND_BYTE_LIMIT): JsonValue {
  if (encoder.encode(text).byteLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  let index = 0;
  const whitespace = () => { while (/[ \t\n\r]/.test(text[index] ?? '') && index < text.length) index++; };
  const fail = (): never => { throw new Error('INVALID_JSON'); };
  const readString = (): string => {
    if (text[index] !== '"') return fail();
    const start = index++;
    while (index < text.length) {
      const character = text[index++];
      if (character === '\\') index++;
      else if (character === '"') return JSON.parse(text.slice(start, index)) as string;
    }
    return fail();
  };
  const scan = (depth: number): void => {
    if (depth > 100) return fail();
    whitespace();
    if (text[index] === '{') {
      index++; whitespace(); const keys = new Set<string>();
      if (text[index] === '}') { index++; return; }
      while (index < text.length) {
        whitespace(); const key = readString();
        if (keys.has(key)) throw new Error('DUPLICATE_JSON_KEY');
        keys.add(key); whitespace();
        if (text[index++] !== ':') return fail();
        scan(depth + 1); whitespace();
        if (text[index] === '}') { index++; return; }
        if (text[index++] !== ',') return fail();
      }
      return fail();
    }
    if (text[index] === '[') {
      index++; whitespace();
      if (text[index] === ']') { index++; return; }
      while (index < text.length) {
        scan(depth + 1); whitespace();
        if (text[index] === ']') { index++; return; }
        if (text[index++] !== ',') return fail();
      }
      return fail();
    }
    if (text[index] === '"') { readString(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(index));
    if (!match) return fail();
    index += match[0].length;
  };
  scan(0); whitespace();
  if (index !== text.length) return fail();
  const value: unknown = JSON.parse(text);
  assertJson(value);
  return value;
}

export function validateOfflineGrant(value:unknown):SignedOfflineGrant {
 const grant=check<SignedOfflineGrant>('SignedOfflineGrant',value);
 if(Date.parse(grant.payload.expiresAt)<=Date.parse(grant.payload.issuedAt)||Date.parse(grant.payload.expiresAt)-Date.parse(grant.payload.issuedAt)>86400000)throw new Error('INVALID_GRANT_EXPIRY');
 return grant;
}
export function validateOwnershipGrant(value:unknown):OwnershipGrant {return check<OwnershipGrant>('OwnershipGrant',value);}
export function validateAssetManifest(value:unknown):AssetManifest {return check<AssetManifest>('AssetManifest',value);}

export function validateSettlementGrant(value:unknown):SettlementGrant {return check<SettlementGrant>('SettlementGrant',value);}
export function validateGrantReturn(value:unknown):GrantReturnProof {return check<GrantReturnProof>('GrantReturnProof',value);}

export function validateAuthorityProvision(value:unknown):SignedAuthorityProvision {return check<SignedAuthorityProvision>('SignedAuthorityProvision',value);}
export function validatePairingGrant(value:unknown):SignedPairingGrant {return check<SignedPairingGrant>('SignedPairingGrant',value);}
