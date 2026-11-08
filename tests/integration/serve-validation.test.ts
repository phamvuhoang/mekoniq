// A03 cross-projection smoke: the Serve fixture, compiled by the real native compiler, validated by the real LinkForge worker (G-LF1 evidence input; integrated gates stay open).
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPythonCompiler } from '../../packages/lab-runtime/src/engineering/compiler';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { createLinkForgeValidator, lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { writeFixtureCatalog } from '../support/engineering';
import { navigationFixture } from '../support/navigation2d';

const irPython = resolve('.venv-irsim/bin/python'), simPython = resolve('.venv/bin/python'), lfPython = resolve('.venv-linkforge/bin/python'), workerRoot = resolve('robotics/model-validation');
const ok = (py: string, code: string) => { try { execFileSync(py, ['-c', code], { stdio: 'ignore' }); return true; } catch { return false; } };
const available = existsSync(simPython) && existsSync(lfPython) && existsSync(irPython) && ok(irPython, 'import irsim, yaml, rfc8785') && ok(simPython, 'import rfc8785, jsonschema, referencing, yaml') && ok(lfPython, 'import linkforge.core');
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };

test.skipIf(!available)('the Serve fixture compiles and its robot passes LinkForge shadow validation with the assumptions still visible', async () => {
  const f = structuredClone(navigationFixture('serve').fixture), catalogRoot = await temp('serve-cat-');
  await writeFixtureCatalog(catalogRoot, f);
  const service = createEngineeringService({ directory: await temp('serve-'), catalogRoot, compiler: createPythonCompiler({ python: simPython, simulationRoot: 'robotics/simulation' }),
    compilers: { 'engineering-irsim-2d-v1': createNavigationCompiler({ python: irPython, workerRoot: resolve('robotics/navigation-2d'), descriptionHelperRoot: resolve('robotics/simulation') }) },
    validator: createLinkForgeValidator({ python: lfPython, workerRoot, timeoutMs: 30_000, lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')) }) });
  const receipt = await service.compileEngineeringProject(f.project, 's');
  expect(receipt.problems.filter((p) => p.blocking), JSON.stringify(receipt.problems)).toEqual([]);
  if (receipt.state !== 'compiled') throw new Error('NOT_COMPILED');
  const { report } = await service.validateRobotModel('s', { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest }, 'amr-1');
  const errors = report.issues.filter((i) => i.severity === 'error');
  expect(errors, JSON.stringify(errors)).toEqual([]);
  expect(report).toMatchObject({ execution: 'ran', result: 'pass' });
  expect(report.checks.find((c) => c.id === 'LF-PARITY')!.result).toBe('pass');
  expect(report.assumptions.length).toBeGreaterThan(0);
  expect(report.assumptions.every((a) => a.kind === 'assumed')).toBe(true);
  // Evidence input for G-LF1 (never the gate itself): LINKFORGE_IRSIM_EVIDENCE_OUT=<file> records what this run saw.
  if (process.env.LINKFORGE_IRSIM_EVIDENCE_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.LINKFORGE_IRSIM_EVIDENCE_OUT, JSON.stringify({ schemaVersion: 1, kind: 'a03-serve-linkforge-smoke', gate: 'G-LF1 input only; not tested, not accepted', fixture: 'serve-demo-v1',
      projectDigest: receipt.projectDigest, assemblyDigest: report.assemblyDigest, physicalModelDigest: report.physicalModelDigest, reportDigest: report.reportDigest, execution: report.execution, result: report.result,
      checks: report.checks.map((c) => ({ id: c.id, result: c.result })), issues: report.issues.map((i) => ({ code: i.code, severity: i.severity, entityId: i.entityId })), assumptionCount: report.assumptions.length, engine: report.engine }, null, 2) + '\n');
  }
});
