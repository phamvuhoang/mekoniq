import { canonicalize } from 'json-canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { JsonValue } from '../generated/wire';

/** Reject values that JSON.stringify silently changes or cannot represent safely. */
export function assertJson(value: unknown, parents = new Set<object>(), depth = 0): asserts value is JsonValue {
  if (depth > 100) throw new Error('INVALID_JSON: nesting limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    for (const character of value) {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) throw new Error('INVALID_JSON: lone Unicode surrogate');
    }
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
    throw new Error('INVALID_JSON: non-finite or unsafe integer number');
  }
  if (typeof value !== 'object') throw new Error('INVALID_JSON: unsupported value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error('INVALID_JSON: non-plain object');
  if (parents.has(value)) throw new Error('INVALID_JSON: cyclic object');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('INVALID_JSON: symbol key');
  parents.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('INVALID_JSON: sparse or extended array');
    for (const entry of value) assertJson(entry, parents, depth + 1);
  } else {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new Error('INVALID_JSON: accessor or hidden property');
      assertJson(key, parents, depth + 1);
      assertJson(descriptor.value, parents, depth + 1);
    }
  }
  parents.delete(value);
}

/** RFC 8785 JCS bytes; signatures must be outside the payload supplied here. */
export function canonicalBytes(value: JsonValue): Uint8Array {
  assertJson(value);
  return new TextEncoder().encode(canonicalize(value));
}

/** Portable synchronous SHA-256; identical in browser, Node and native golden vectors. */
export function hashPayload(value: JsonValue): string {
  return bytesToHex(sha256(canonicalBytes(value)));
}
