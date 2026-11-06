// The compiler's golden inputs are produced by the real A03 pipeline, never hand-edited. UPDATE_ENGINEERING_FIXTURES=1 rewrites them.
import { expect, test } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareEngineeringCompileInput, resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
import { engineeringFixture } from '../support/engineering';
import type { EngineeringProject } from '../../packages/lab-runtime/src/engineering/contracts';

const dir = join(__dirname, '..', 'fixtures', 'engineering');
function input(name: string, edit?: (p: EngineeringProject) => void) {
  const f = structuredClone(engineeringFixture(name)); edit?.(f.project);
  const { resolved, problems } = resolveAssembly(f.project, f.components, { models: f.models as never });
  if (!resolved) throw new Error(`fixture ${name} does not resolve: ${problems.map((p) => p.code)}`);
  return prepareEngineeringCompileInput(f.project, resolved, []);
}
const world = (p: EngineeringProject) => p.runtimeProject.world;
const goldens: Record<string, () => unknown> = {
  'compile-radius-100.json': () => input('valid'),
  'compile-radius-075.json': () => input('wheel-r075'),
  'compile-world-variants.json': () => ({
    base: input('valid'),
    obstacle: input('valid', (p) => { world(p).obstacles.push({ id: 'shelf', x: 2.5, y: 1, width: 0.5, height: 0.5 }); }),
    handoff: input('valid', (p) => { world(p).handoffPoints = [{ id: 't1', name: 'Table 1 handoff', kind: 'table', position: [3.5, 2, 0], yawRad: 1.25 }]; }),
    speed: input('valid', (p) => { p.runtimeProject.entities[0]!.speedLimitMps = 0.2; }),
    bigger: input('valid', (p) => { world(p).width = 7; world(p).revision += 1; }),
  }),
};
for (const [file, make] of Object.entries(goldens)) {
  test(`golden compile input ${file} is exactly what the A03 pipeline produces`, async () => {
    const actual = JSON.parse(JSON.stringify(make()));
    if (process.env.UPDATE_ENGINEERING_FIXTURES === '1') { await mkdir(dir, { recursive: true }); await writeFile(join(dir, file), JSON.stringify(actual, null, 1) + '\n'); }
    expect(JSON.parse(await readFile(join(dir, file), 'utf8'))).toEqual(actual);
  });
}
