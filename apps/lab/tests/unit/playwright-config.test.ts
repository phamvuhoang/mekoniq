// The default Playwright run (lab-e2e-browser, no launcher) must never pick up a spec that needs a real engine and the one-use pairing code of its own launcher.
import {readdirSync,readFileSync} from 'node:fs';
import {expect,test} from 'vitest';

test('every launcher-driven spec family (irsim-*, webots-*, mujoco-*) is ignored by the default config and matched by the launcher config',()=>{
 const base=readFileSync('playwright.config.ts','utf8'),launcher=readFileSync('playwright.irsim.config.ts','utf8');
 const specs=readdirSync('tests/e2e').filter(f=>/^(irsim|webots|mujoco)-.*\.spec\.ts$/.test(f));
 expect(specs.length).toBeGreaterThan(0);
 for(const family of ['irsim','webots','mujoco']){expect(base,family).toContain(`**/${family}-*.spec.ts`);expect(launcher,family).toContain(`${family}-*.spec.ts`);}
});
