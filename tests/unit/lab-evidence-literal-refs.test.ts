import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
test('source-only acceptance resolves every literal source reference including expanded ARM05 and SYS03 titles',()=>{
 const acceptance=readFileSync('tests/acceptance/lab-v2-mock.acceptance.test.ts','utf8');
 const refs=[...acceptance.matchAll(/\bsrc\((['"])(.*?)\1\s*,\s*(['"])(.*?)\3\)/g)].map(m=>({file:m[2]!,title:m[4]!}));
 expect(refs.filter(r=>r.file==='lab-v2-arm-faults.test.ts')).toHaveLength(3);
 expect(refs.filter(r=>r.file==='lab-v2-software-gaps.test.ts'&&/^(reorder|delay)-observations?/.test(r.title))).toHaveLength(2);
 expect(refs.length).toBeGreaterThan(20);
 const missing=refs.filter(r=>!readFileSync(`tests/integration/${r.file}`,'utf8').includes(r.title));
 expect(missing).toEqual([]);
});
