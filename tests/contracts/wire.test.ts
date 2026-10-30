import { expect, test } from 'vitest';
import { assertJson, canonicalBytes, hashPayload } from '../../packages/contracts/src/canonical';
import { parseJsonStrict, validateEnvelope, validateJournal, validateMoney, validateSyncBatch } from '../../packages/contracts/src/validate';
import canonicalFixtures from '../fixtures/contracts/canonical.json';
import commandFixture from '../fixtures/contracts/command-v1.json';

const command = () => structuredClone(commandFixture);
test('field order does not change canonical bytes; non JSON values are rejected', () => {
  expect(canonicalBytes({ b: '2', a: '1' })).toEqual(canonicalBytes({ a: '1', b: '2' }));
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), { a: undefined }, { a: NaN }])
    expect(() => canonicalBytes(value as never)).toThrow('INVALID_JSON');
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => canonicalBytes(cyclic as never)).toThrow('INVALID_JSON');
  expect(() => canonicalBytes('\ud800')).toThrow('INVALID_JSON');
});
test('shared RFC8785 golden vectors have exact UTF8 bytes and SHA256 hashes', () => {
  for (const fixture of canonicalFixtures) {
    const input: unknown = fixture.input;
    assertJson(input);
    expect(new TextDecoder().decode(canonicalBytes(input))).toBe(fixture.canonical);
    expect(hashPayload(input)).toBe(fixture.sha256);
  }
});
test('envelope validates known schema, scope, UTC time and payload hash', () => {
  expect(validateEnvelope(command())).toEqual(command());
  for (const changes of [{ schemaVersion: 2 }, { extra: true }, { organizationId: '' },
    { venueId: undefined }, { coordinatorEpoch: 9007199254740992 }, { occurredAt: '2026-10-30T10:00:00+07:00' },
    { payloadHash: '0'.repeat(64) }, { payload: { note: Number.MAX_SAFE_INTEGER + 1 } }])
    expect(() => validateEnvelope({ ...command(), ...changes })).toThrow();
});
test('ingress rejects duplicate keys including escapes and nested duplicates', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}',
    '{"a":1} trailing', '{"a":1,}', '{"a":NaN}']) expect(() => parseJsonStrict(text)).toThrow();
  expect(parseJsonStrict('{"a":[{"a":1},{"a":2}],"text":"a,a:1"}')).toEqual({a:[{a:1},{a:2}],text:'a,a:1'});
  expect(() => parseJsonStrict(' '.repeat(256 * 1024 + 1))).toThrow('PAYLOAD_TOO_LARGE');
  expect(() => parseJsonStrict('{"n":9007199254740993}')).toThrow('INVALID_JSON');
});
test('money is canonical and bounded to thirty decimal digits', () => {
  for (const minor of ['0', '-1', '999999999999999999999999999999'])
    expect(validateMoney({ currency:'VND', minor }).minor).toBe(minor);
  for (const minor of ['-0', '01', '1.0', '+1', '1e2', '1000000000000000000000000000000'])
    expect(() => validateMoney({currency:'VND',minor})).toThrow();
  expect(() => validateMoney({currency:'vnd',minor:'1'})).toThrow();
});
test('sync batch and journal boundaries cannot bypass validation', () => {
  expect(() => validateSyncBatch(Array.from({length:101}, () => ({})))).toThrow('BATCH_TOO_LARGE');
  expect(() => validateSyncBatch([{data:'a'.repeat(1024*1024)}])).toThrow('PAYLOAD_TOO_LARGE');
  expect(() => validateJournal({ ...command(), sequence: 1 })).toThrow();
});
