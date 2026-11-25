// Review6 C: a report the SOURCE produced (a real IR-FD01 run on the real IR-SIM plant, through the sibling source checkout's own code) imports in the Lab
// complete: every hash the Lab recomputes on import (project, world) is the one source wrote, computed the way source computes it. No Lab hashing in the fixture.
import {afterAll,expect,test} from 'vitest';
import {existsSync} from 'node:fs';
import {readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importNavigationEvidence,navigationEvidenceView} from '../../src/reports/navigation2d';
import {reportJson} from '../../src/reports/metrics';
import type {RunReport} from '../../src/scenarios/controls';
(globalThis as Record<string,unknown>).localStorage??={getItem:()=>'en',setItem:()=>{}};
const sourceRoot=resolve(fileURLToPath(new URL('../../../source/',import.meta.url))),venv=join(sourceRoot,'.venv-irsim/bin/python');
// source modules are loaded from the source checkout at run time (not type-checked here: they are source's own code)
const fromSource=(p:string)=>import(/* @vite-ignore */ join(sourceRoot,p)) as Promise<Record<string,(...a:never[])=>Promise<never>>>;
const cleanup:(()=>Promise<unknown>)[]=[];
afterAll(async()=>{for(const f of cleanup.splice(0).reverse())await f().catch(()=>{});});

test.skipIf(!existsSync(venv))('review6 C: a real source IR-SIM report and its evidence import complete through the Lab importer',async()=>{
 const cwd=process.cwd();process.chdir(sourceRoot);// source test support resolves its venv and worker roots from the source checkout
 let report:RunReport,dir:string,project:unknown;
 try{
  const m=await fromSource('tests/support/irsim-mission.ts') as Record<string,never>&{irsimBundle:()=>Promise<{locked:{runtimeProjection:{project:unknown}}}>;openRun:(d:string,b:unknown)=>Promise<{start():Promise<unknown>;report():Promise<RunReport>;close():Promise<void>}>;stepUntil:(r:unknown,f:(v:{run:{status:string}})=>boolean)=>Promise<unknown>;temp:(p:string)=>Promise<string>;removeBundles:()=>Promise<unknown>};
  cleanup.push(m.removeBundles);
  const bundle=await m.irsimBundle();dir=await m.temp('lab-source-report-');cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const run=await m.openRun(dir,bundle);cleanup.push(()=>run.close());
  await run.start();await m.stepUntil(run,v=>v.run.status==='completed');
  report=await run.report();project=bundle.locked.runtimeProjection.project;
  await run.close();
 }finally{process.chdir(cwd);}
 expect(report.navigation2d!.completeness).toEqual({status:'complete',reasons:[]});// the source itself calls it complete
 const files=[new File([reportJson(report)],'report.json'),new File([JSON.stringify(project)],'project.json')];
 for(const list of Object.values(report.navigation2d!.artifacts))for(const a of list)files.push(new File([await readFile(join(dir,'evidence',a.path))],a.path));
 const imported=await importNavigationEvidence(files);
 expect(navigationEvidenceView(imported.report)).toEqual({supported:true,provider:'irsim_2d',complete:true,reasons:[]});
},240_000);
test('review6 C: the shared report fixture carries the hashes the source code computes for its project (not the importer\'s)',async()=>{
 const {SOURCE_HASHES,project}=await import('../support/navigation-report');
 const {worldHash}=await fromSource('packages/lab-runtime/src/v2/assets.ts') as unknown as {worldHash:(w:unknown)=>string};
 const {hashJson}=await fromSource('packages/lab-runtime/src/v2/hash.ts') as unknown as {hashJson:(v:unknown)=>string};
 expect(SOURCE_HASHES).toEqual({project:hashJson(project),world:worldHash(project.world)});
});
