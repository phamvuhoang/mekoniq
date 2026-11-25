import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BROWSER_ARGS} from '../../scripts/measure-cell-production';
// Verbatim from source/scripts/browser-evidence-readback.mjs:11-12 (the reader's required argv). Lab cannot import across repos; keep in sync by hand.
const READER_ARGS=['exec','playwright','test','--config','playwright.b07b.config.ts','mujoco-cell.spec.ts'];
test('producer records the canonical browser argv the reader requires',()=>{expect(BROWSER_ARGS).toEqual(READER_ARGS);});
// The entry guard must compare realpaths: a symlinked launch used to skip the body and exit 0 (evidence producer "succeeding" without running).
test('launching via a symlink still runs the script body (fails fast, never exit 0)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'measure-link-')),link=join(dir,'measure-link.ts');
 try{
  symlinkSync(resolve(import.meta.dirname,'../../scripts/measure-cell-production.ts'),link);
  const r=spawnSync(resolve(import.meta.dirname,'../../../../node_modules/.bin/tsx'),[link,'--duration-ms','1'],{cwd:resolve(import.meta.dirname,'../../../..'),encoding:'utf8',timeout:90000});
  expect(r.stderr).toContain('ACTIVE_CAPTURE_REQUIRES_180000MS');expect(r.status).not.toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
