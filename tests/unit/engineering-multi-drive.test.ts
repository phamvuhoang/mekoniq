import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
import { validateResolvedAssembly } from '../../packages/lab-runtime/src/engineering/contracts';
import { engineeringFixture } from '../support/engineering';

const frozen = JSON.parse(readFileSync(new URL('../fixtures/engineering/legacy-assembly-digests.json', import.meta.url), 'utf8')).digests as Record<string, string>;
const resolve = (name: string, options: { driveBindingsVersion?: 1 } = {}) => {
  const f = engineeringFixture(name);
  return resolveAssembly(f.project, f.components, { models: f.models as never, ...options });
};
const codes = (r: { problems: { code: string }[] }) => r.problems.map((p) => p.code);

test('two AMRs keep one drive binding each and the singleton is null', () => {
  const r = resolve('two-amr', { driveBindingsVersion: 1 });
  expect(r.problems).toEqual([]);
  const resolved = r.resolved!;
  expect(resolved.models.drive).toBeNull();
  expect(resolved.models.driveBindingsVersion).toBe(1);
  expect(Object.keys(resolved.models.drivesByEntity!)).toEqual(['amr-1', 'amr-2']);
  expect(resolved.models.drivesByEntity!['amr-1']!.leftJointId).toBe('r1-wheel-left/axle');
  expect(resolved.models.drivesByEntity!['amr-2']!.rightJointId).toBe('r2-wheel-right/axle');
  expect(resolved.models.drivesByEntity!['amr-2']!.model.parameters.drive).not.toEqual(resolved.models.drivesByEntity!['amr-1']!.model.parameters.drive);
  const radius = (e: string) => (resolved.models.drivesByEntity![e]!.model.parameters.drive as { wheelRadiusM: { value: number } }).wheelRadiusM.value;
  const separation = (e: string) => (resolved.models.drivesByEntity![e]!.model.parameters.drive as { wheelSeparationM: { value: number } }).wheelSeparationM.value;
  expect([radius('amr-1'), radius('amr-2'), separation('amr-1'), separation('amr-2')]).toEqual([0.075, 0.1, 0.36, 0.42]);
  expect(validateResolvedAssembly(resolved).problems).toEqual([]);
});

test('the new requestedProfile selects driveBindingsVersion 1 without the option', () => {
  const r = resolve('two-amr');
  expect(r.resolved!.models.driveBindingsVersion).toBe(1);
});

test('legacy resolutions keep their frozen digest and gain no new fields', () => {
  for (const [name, digest] of Object.entries(frozen)) {
    const resolved = resolve(name).resolved!;
    expect(resolved.assemblyDigest, name).toBe(digest);
    expect(Object.keys(resolved.models).sort(), name).toEqual(['arm', 'drive', 'process', 'sensor']);
  }
});

test('one AMR with the option: singleton still set and equals its map entry', () => {
  const resolved = resolve('valid', { driveBindingsVersion: 1 }).resolved!;
  expect(resolved.models.drive).not.toBeNull();
  expect(resolved.models.drivesByEntity).toEqual({ 'amr-1': resolved.models.drive });
});

test('the version and the map are only valid together', () => {
  const resolved = JSON.parse(JSON.stringify(resolve('two-amr').resolved!));
  delete resolved.models.driveBindingsVersion;
  expect(validateResolvedAssembly(resolved).ok).toBe(false);
});

test('more than one sensor model per instance is refused under the new profile, not overwritten', () => {
  expect(codes(resolve('two-lidars', { driveBindingsVersion: 1 }))).toContain('MULTIPLE_SENSOR_MODELS_UNSUPPORTED');
  expect(codes(resolve('two-lidars'))).not.toContain('MULTIPLE_SENSOR_MODELS_UNSUPPORTED'); // legacy path is untouched
});
