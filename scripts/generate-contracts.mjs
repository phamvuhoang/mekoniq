import { readFile, writeFile } from 'node:fs/promises';
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
if (process.argv.includes('--check')) {
  const actual = await readFile(outputFile, 'utf8').catch(() => '');
  if (actual !== output) throw new Error('GENERATED_CONTRACT_DRIFT: run pnpm contracts:generate');
  console.log('Contract generation matches schema.');
} else {
  await writeFile(outputFile, output);
  console.log('Generated packages/contracts/generated/wire.ts');
}
