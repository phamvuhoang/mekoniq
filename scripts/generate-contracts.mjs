import { readFile, writeFile, readdir } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
import { fileURLToPath } from 'node:url';

const schemaFile = new URL('../packages/contracts/schemas/wire.schema.json', import.meta.url);
const outputFile = new URL('../packages/contracts/generated/wire.ts', import.meta.url);
const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
const output = await compile(schema, 'WireContract', {
  cwd: fileURLToPath(new URL('../packages/contracts/schemas/', import.meta.url)),
  bannerComment: '/* Generated from schemas/wire.schema.json. Run pnpm contracts:generate; do not edit. */',
  style: { singleQuote: true, semi: true, tabWidth: 2 },
  unknownAny: false,
  unreachableDefinitions: true,
});
// Lab v2 schemas are self-contained; one generated module covers all of them (v1 Lab schemas stay hand-typed in lab-runtime).
const v2Dir = new URL('../packages/contracts/schemas/', import.meta.url);
const v2Files = (await readdir(v2Dir)).filter((n) => /-v2\.schema\.json$|^(asset-revision|coffee-recipe|cell-command|cell-observation|arm-command|arm-observation|lab-transfer-evidence|lab-arm-collision-evidence|lab-run-verification|lab-fault-schedule)\.schema\.json$/.test(n)).sort();
const v2Parts = [];
for (const name of v2Files) {
  const s = JSON.parse(await readFile(new URL(name, v2Dir), 'utf8'));
  // arm-* schemas $ref the cell schemas by file: reuse the declarations already emitted for them instead of declaring CellCommand twice
  v2Parts.push(await compile(s, s.title, { cwd: fileURLToPath(v2Dir), bannerComment: '', ignoreMinAndMaxItems: true, style: { singleQuote: true, semi: true, tabWidth: 2 }, unknownAny: false, unreachableDefinitions: true, declareExternallyReferenced: !name.startsWith('arm-') && name !== 'lab-run-verification.schema.json' && name !== 'lab-project-v2.schema.json' }));
}
const v2Output = '/* Generated from the Lab v2 schemas. Run pnpm contracts:generate; do not edit. */\n' + v2Parts.join('\n');
const v2File = new URL('../packages/contracts/generated/lab-v2.ts', import.meta.url);
// Engineering schemas reference each other by file; fold them into one definitions map so every type is declared exactly once.
// lab-v2 types are imported by name (tsType) instead of re-declared.
const engFiles = { 'engineering-component': 'ComponentRevision', 'engineering-project': 'EngineeringProject', 'engineering-bundle': null, 'engineering-project-archive': 'EngineeringArchive', 'engineering-candidate': 'EngineeringCandidate', 'engineering-calibration': 'CalibrationDataset', 'engineering-evidence': 'EngineeringRunManifest' };
const engRoots = Object.fromEntries(Object.entries(engFiles).filter(([, t]) => t).map(([n, t]) => [`${n}.schema.json`, `#/definitions/${t}`]));
const labTypes = { 'lab-project-v2.schema.json': 'LabProjectV2', 'asset-revision.schema.json': 'AssetRevision', 'coffee-recipe.schema.json': 'CoffeeRecipe' };
const fold = (v) => Array.isArray(v) ? v.map(fold) : v && typeof v === 'object'
  ? (typeof v.$ref === 'string' && !v.$ref.startsWith('#') ? (labTypes[v.$ref] ? { tsType: labTypes[v.$ref] } : { $ref: engRoots[v.$ref] ?? v.$ref.replace(/^[^#]*#/, '#') }) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fold(x)])))
  : v;
const engDefinitions = {};
for (const [name, type] of Object.entries(engFiles)) {
  const root = JSON.parse(await readFile(new URL(`${name}.schema.json`, v2Dir), 'utf8'));
  const definitions = root.definitions ?? {};
  for (const k of ['$schema', '$id', 'title', 'definitions']) delete root[k];
  Object.assign(engDefinitions, fold(definitions));
  if (type) engDefinitions[type] = fold({ title: type, ...root });
}
const engOutput = "/* Generated from the engineering schemas. Run pnpm contracts:generate; do not edit. */\nimport type { LabProjectV2, AssetRevision, CoffeeRecipe } from './lab-v2';\n" + await compile({ title: 'EngineeringContracts', type: 'object', additionalProperties: false, properties: {}, definitions: engDefinitions }, 'EngineeringContracts', { bannerComment: '', style: { singleQuote: true, semi: true, tabWidth: 2 }, unknownAny: false, unreachableDefinitions: true });
const engFile = new URL('../packages/contracts/generated/engineering.ts', import.meta.url);
// Navigation/validation schemas reference each other by file and the engineering schemas by type name (imported, never re-declared).
const navFiles = { 'robot-physical-model-v1': 'RobotPhysicalModelV1', 'navigation-model-2d-v1': 'NavigationModel2DV1', 'navigation-scene-v1': 'NavigationSceneV1', 'model-validation-report-v1': 'ModelValidationReportV1', 'irsim-worker-v1': 'IRSimRequestV1', 'navigation-run-evidence-v1': 'NavigationRunEvidenceV1', 'algorithm-result-v1': 'AlgorithmResultV1', 'sim3d-worker-v1': 'Sim3DRequestV1', 'arm-scene-3d-v1': 'ArmScene3DV1', 'arm-cell-scene-v1': 'ArmCellSceneV1' };
const navRoots = Object.fromEntries(Object.entries(navFiles).map(([n, t]) => [`${n}.schema.json`, `#/definitions/${t}`]));
const foldNav = (v) => Array.isArray(v) ? v.map(foldNav) : v && typeof v === 'object'
  ? (typeof v.$ref === 'string' && !v.$ref.startsWith('#') ? (v.$ref.startsWith('engineering-component.schema.json#/definitions/') ? { tsType: v.$ref.split('/').pop() } : { $ref: navRoots[v.$ref] ?? v.$ref.replace(/^[^#]*#/, '#') }) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, foldNav(x)])))
  : v;
const navDefinitions = {};
for (const [name, type] of Object.entries(navFiles)) {
  const root = JSON.parse(await readFile(new URL(`${name}.schema.json`, v2Dir), 'utf8'));
  const definitions = root.definitions ?? {};
  for (const k of ['$schema', '$id', 'definitions']) delete root[k];
  Object.assign(navDefinitions, foldNav(definitions));
  navDefinitions[type] = foldNav(root);
}
const navOutput = "/* Generated from the navigation/validation schemas. Run pnpm contracts:generate; do not edit. */\nimport type { Digest, EngineeringId, Link, Joint, Pose, Scalar, SensorModel, SourceRef } from './engineering';\n" + await compile({ title: 'Navigation2DContracts', type: 'object', additionalProperties: false, properties: {}, definitions: navDefinitions }, 'Navigation2DContracts', { bannerComment: '', ignoreMinAndMaxItems: true, style: { singleQuote: true, semi: true, tabWidth: 2 }, unknownAny: false, unreachableDefinitions: true });
const navFile = new URL('../packages/contracts/generated/navigation2d.ts', import.meta.url);
if (process.argv.includes('--check')) {
  const actual = await readFile(outputFile, 'utf8').catch(() => '');
  if (actual !== output) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate');
  if ((await readFile(v2File, 'utf8').catch(() => '')) !== v2Output) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate (lab-v2)');
  if ((await readFile(engFile, 'utf8').catch(() => '')) !== engOutput) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate (engineering)');
  if ((await readFile(navFile, 'utf8').catch(() => '')) !== navOutput) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate (navigation2d)');
  console.log('Contract generation matches schema.');
} else {
  await writeFile(outputFile, output);
  await writeFile(v2File, v2Output);
  await writeFile(engFile, engOutput);
  await writeFile(navFile, navOutput);
  console.log('Generated packages/contracts/generated/wire.ts, lab-v2.ts, engineering.ts and navigation2d.ts');
}
