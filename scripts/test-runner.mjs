import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const [suite, ...raw] = process.argv.slice(2);
const args = raw[0] === '--' ? raw.slice(1) : raw;
const softwareOnly=args.indexOf('--software-only');
if(softwareOnly>=0){if(suite!=='acceptance')throw new Error('SOFTWARE_ONLY_REQUIRES_ACCEPTANCE');args.splice(softwareOnly,1);process.env.MEKONIQ_CONTINUITY_SOFTWARE_ONLY='1';}
const suites = new Set(['unit','contracts','integration','security','acceptance','e2e','adapters','providers','load']);
if (!suites.has(suite) || !existsSync(`tests/${suite}`)) {
  console.error(`PREREQUISITE: suite ${suite} is not implemented`); process.exit(2);
}
if (suite === 'acceptance' && args[0] === 'continuity') args[0] = 'tests/acceptance/continuity-suite.test.ts';
else if (suite === 'acceptance' && ['release-manifest', 'first-shift'].includes(args[0])) args[0] = `tests/acceptance/${args[0]}.test.ts`;
if (suite === 'load') {
  // the load suite MEASURES first (a fresh artifact for this commit), then asserts the budget on that artifact
  const free = args.includes('--free'), measured = spawnSync(process.execPath, ['scripts/run-load.mjs', ...(free ? ['--free'] : [])], { stdio: 'inherit' });
  if (measured.status !== 0) process.exit(measured.status ?? 1);
  args.splice(0, args.length, free ? 'tests/acceptance/supabase-free-capacity.test.ts' : 'tests/acceptance/load-budget.test.ts');
}
const command = suite === 'e2e' ? ['playwright','test'] : ['vitest','run'];
const child = spawnSync('pnpm', ['exec', ...command, ...(args.length ? args : [`tests/${suite}`])], {stdio:'inherit'});
process.exit(child.status ?? 1);
