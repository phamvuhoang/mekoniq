import {expect,test} from 'vitest';
import {BROWSER_ARGS} from '../../scripts/measure-cell-production';
// Verbatim from source/scripts/browser-evidence-readback.mjs:11-12 (the reader's required argv). Lab cannot import across repos; keep in sync by hand.
const READER_ARGS=['exec','playwright','test','--config','playwright.b07b.config.ts','mujoco-cell.spec.ts'];
test('producer records the canonical browser argv the reader requires',()=>{expect(BROWSER_ARGS).toEqual(READER_ARGS);});
