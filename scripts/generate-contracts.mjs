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
if (process.argv.includes('--check')) {
  const actual = await readFile(outputFile, 'utf8').catch(() => '');
  if (actual !== output) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate');
  if ((await readFile(v2File, 'utf8').catch(() => '')) !== v2Output) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate (lab-v2)');
  console.log('Contract generation matches schema.');
} else {
  await writeFile(outputFile, output);
  await writeFile(v2File, v2Output);
  console.log('Generated packages/contracts/generated/wire.ts and lab-v2.ts');
}
