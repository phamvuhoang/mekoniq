import {describe,expect,test,vi} from 'vitest';
// @ts-expect-error plain ESM script
import {parseRecorderArgs,LEGACY_ROOT,physicalPlan,listArtifacts,notExecuted,playwrightSpecEnv,physicalArtifacts} from '../../scripts/recorder-options.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evidenceScreenshotPath} from '../support/evidence-screenshot';

const lab='/work/lab',none={exists:()=>false};
describe('recorder options',()=>{
  test('no arguments keep the legacy behaviour and root',()=>{
    expect(parseRecorderArgs([],lab,none)).toEqual({ci:false,suite:'legacy',out:`${lab}/${LEGACY_ROOT}`,explicitOut:false});
    expect(parseRecorderArgs(['--ci'],lab,none).ci).toBe(true);
  });
  test('the physical suite needs an explicit, new root that is not the historical one',()=>{
    const o=parseRecorderArgs(['--suite','physical-robot-lab','--out','docs/implementation/evidence/physical-robot-lab/regression'],lab,none);
    expect(o).toMatchObject({suite:'physical-robot-lab',out:`${lab}/docs/implementation/evidence/physical-robot-lab/regression`,explicitOut:true});
    expect(()=>parseRecorderArgs(['--suite','physical-robot-lab'],lab,none)).toThrow('OUT_REQUIRED_FOR_SUITE');
    expect(()=>parseRecorderArgs(['--suite','physical-robot-lab','--out',LEGACY_ROOT],lab,none)).toThrow('LEGACY_ROOT_FORBIDDEN');
  });
  test('an existing directory is never overwritten or deleted',()=>{
    expect(()=>parseRecorderArgs(['--suite','physical-robot-lab','--out','x'],lab,{exists:()=>true})).toThrow('OUT_EXISTS');
  });
  test('unknown suites, options and a dangling --out are refused',()=>{
    expect(()=>parseRecorderArgs(['--suite','nope'],lab,none)).toThrow('UNKNOWN_SUITE:nope');
    expect(()=>parseRecorderArgs(['--wat'],lab,none)).toThrow('UNKNOWN_ARGUMENT:--wat');
    expect(()=>parseRecorderArgs(['--out'],lab,none)).toThrow('OUT_REQUIRED');
  });
});

describe('physical-robot-lab plan',()=>{
  const plan=physicalPlan('/new/root');
  test('browser screenshots go into the new recording, never into the committed brand evidence',()=>{
    expect(plan.browserEnv.LAB_BRAND_EVIDENCE_DIR).toBe('/new/root/brand-ui');
    expect(plan.browserEnv.LAB_EVIDENCE_DIR.startsWith('/new/root/')).toBe(true);
    expect(plan.dirs).toContain(plan.browserEnv.LAB_EVIDENCE_DIR);
    const spec=readFileSync(new URL('../e2e/brand-ui.spec.ts',import.meta.url),'utf8');
    expect(spec).toMatch(/LAB_BRAND_EVIDENCE_DIR/);
    expect(spec).not.toMatch(/evidence\/brand-ui-v1/);          // a plain Playwright run must not rewrite committed evidence
  });
  test('the offline package runs the dedicated BV01 gate with its own result file, besides recovery and the coffee journey',()=>{
    expect(plan.offlineSpecs).toEqual(['twin-recovery.spec.ts','coffee-journey.spec.ts','offline-bv01.spec.ts']);
    expect(plan.offlineFiles).toEqual(['lab-pw-offline-twin-recovery.json','lab-pw-offline-coffee-journey.json','lab-pw-offline-offline-bv01.json']);
  });
  test('every screenshot a run produced is listed with its sha256',()=>{
    const dir=mkdtempSync(join(tmpdir(),'rec-art-'));mkdirSync(join(dir,'sub'));writeFileSync(join(dir,'a.png'),'one');writeFileSync(join(dir,'sub','b.png'),'two');
    const rows=listArtifacts(dir,'screens');
    expect(rows.map((r:{file:string})=>r.file)).toEqual(['screens/a.png','screens/sub/b.png']);
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(listArtifacts(join(dir,'missing'),'x')).toEqual([]);
  });
  test('browser, mock and offline executions retain distinct bytes for repeated screenshot names',()=>{
    const root=mkdtempSync(join(tmpdir(),'rec-isolation-'));
    const executions=['lab-e2e-browser','lab-mock-e2e','lab-offline-e2e'];
    try{
      for(const id of executions){
        const p=physicalPlan(root,id);
        for(const dir of p.dirs)mkdirSync(dir,{recursive:true});
        for(const file of ['F05-missing-cup-desktop-vi.png','F06-compare-desktop-vi.png'])writeFileSync(join(p.browserEnv.LAB_EVIDENCE_DIR,file),id);
      }
      // Read after every execution has written: a shared path would now contain the last execution's bytes.
      for(const id of executions){
        const p=physicalPlan(root,id);
        for(const file of ['F05-missing-cup-desktop-vi.png','F06-compare-desktop-vi.png'])expect(readFileSync(join(p.browserEnv.LAB_EVIDENCE_DIR,file),'utf8')).toBe(id);
      }
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  test('artifact inventory hashes every execution and associates files with their producing command',()=>{
    const root=mkdtempSync(join(tmpdir(),'rec-inventory-'));
    try{
      const executions=['lab-e2e-browser','lab-mock-e2e','lab-offline-e2e'];
      for(const id of executions){
        const p=physicalPlan(root,id);mkdirSync(p.browserEnv.LAB_EVIDENCE_DIR,{recursive:true});
        writeFileSync(join(p.browserEnv.LAB_EVIDENCE_DIR,'F06-compare.png'),'hello');
      }
      const rows=physicalArtifacts(root);
      expect(rows).toEqual([
        {file:'screens/lab-e2e-browser/F06-compare.png',commandId:'lab-e2e-browser',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'},
        {file:'screens/lab-mock-e2e/F06-compare.png',commandId:'lab-mock-e2e',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'},
        {file:'screens/lab-offline-e2e/F06-compare.png',commandId:'lab-offline-e2e',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'},
      ]);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  test('a gate that was skipped or ran nothing is not recorded as passed',()=>{
    expect(notExecuted({expected:1,unexpected:0,skipped:0,flaky:0})).toBeNull();
    expect(notExecuted({expected:0,unexpected:0,skipped:1,flaky:0})).toMatch(/skipped/);
    expect(notExecuted({expected:1,unexpected:0,skipped:1,flaky:0})).toMatch(/skipped/);
    expect(notExecuted({expected:0,unexpected:0,skipped:0,flaky:0})).toMatch(/no test ran/);
    expect(notExecuted(undefined)).toMatch(/no result/);
  });
});

describe('Playwright attachment preservation',()=>{
  test('ordinary successful captures retain their existing temporary paths',()=>{
    expect(evidenceScreenshotPath('/tmp/mekoniq-lab-mobile.png',{})).toBe('/tmp/mekoniq-lab-mobile.png');
    expect(evidenceScreenshotPath('/tmp/mekoniq-lab-source-run.png',{})).toBe('/tmp/mekoniq-lab-source-run.png');
  });
  test('all six successful UI and runtime captures enter the recording inventory with their producing command',()=>{
    const root=mkdtempSync(join(tmpdir(),'rec-success-captures-'));
    const cases=[
      {legacy:'/tmp/mekoniq-lab-mobile.png',commandId:'lab-e2e-browser',file:'playwright/lab-e2e-browser/captures/mekoniq-lab-mobile.png'},
      {legacy:'/tmp/mekoniq-lab-desktop.png',commandId:'lab-e2e-browser',file:'playwright/lab-e2e-browser/captures/mekoniq-lab-desktop.png'},
      {legacy:'/tmp/mekoniq-lab-vi.png',commandId:'lab-e2e-browser',file:'playwright/lab-e2e-browser/captures/mekoniq-lab-vi.png'},
      {legacy:'/tmp/mekoniq-lab-ja.png',commandId:'lab-e2e-browser',file:'playwright/lab-e2e-browser/captures/mekoniq-lab-ja.png'},
      {legacy:'/tmp/mekoniq-lab-en.png',commandId:'lab-e2e-browser',file:'playwright/lab-e2e-browser/captures/mekoniq-lab-en.png'},
      {legacy:'/tmp/mekoniq-lab-source-run.png',commandId:'lab-runtime-e2e',file:'playwright/lab-runtime-e2e/captures/mekoniq-lab-source-run.png'},
    ];
    try{
      for(const c of cases){
        const outputDir=physicalPlan(root,c.commandId).browserEnv.LAB_PW_OUTPUT_DIR;
        vi.stubEnv('LAB_PW_OUTPUT_DIR',outputDir);
        const file=evidenceScreenshotPath(c.legacy);
        expect(file).toBe(join(root,c.file)); // Assert before writing so a regressed route never writes outside the sandbox.
        mkdirSync(join(outputDir,'captures'),{recursive:true});writeFileSync(file,'hello');
      }
      const rows=physicalArtifacts(root);
      expect(rows).toHaveLength(6);
      for(const c of cases)expect(rows).toContainEqual({file:c.file,commandId:c.commandId,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'});
    }finally{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
  });
  test('the recorder output directory reaches Playwright while an ordinary run keeps its default',async()=>{
    try{
      vi.stubEnv('LAB_PW_OUTPUT_DIR','/new/recording/playwright/lab-e2e-browser');vi.resetModules();
      expect((await import('../../playwright.config')).default.outputDir).toBe('/new/recording/playwright/lab-e2e-browser');
      vi.stubEnv('LAB_PW_OUTPUT_DIR',undefined);vi.resetModules();
      expect((await import('../../playwright.config')).default.outputDir).toBeUndefined();
      expect(playwrightSpecEnv({LAB_PW_JSON:'/results/mock.json'},'coffee-journey.spec.ts')).toEqual({LAB_PW_JSON:'/results/mock-coffee-journey.json'});
    }finally{vi.unstubAllEnvs();vi.resetModules();}
  });
  test('cleaning each actual invocation output preserves earlier command and per-spec attachments',async()=>{
    const root=mkdtempSync(join(tmpdir(),'rec-attachments-'));
    const invocations=[
      ['lab-e2e-browser',null],['lab-runtime-e2e',null],
      ['lab-mock-e2e','twin-recovery.spec.ts'],['lab-mock-e2e','coffee-journey.spec.ts'],
      ['lab-offline-e2e','twin-recovery.spec.ts'],['lab-offline-e2e','coffee-journey.spec.ts'],['lab-offline-e2e','offline-bv01.spec.ts'],
    ] as const;
    const saved:{file:string;identity:string}[]=[];
    try{
      for(const [id,spec] of invocations){
        const env=spec?playwrightSpecEnv(physicalPlan(root,id).browserEnv,spec):physicalPlan(root,id).browserEnv;
        vi.stubEnv('LAB_PW_OUTPUT_DIR',env.LAB_PW_OUTPUT_DIR);vi.resetModules();
        const config=(await import('../../playwright.config')).default;
        // Playwright removes outputDir before each process starts. Substitute a sandbox for its package-default test-results directory.
        const outputDir=config.outputDir??join(root,'default-test-results');
        rmSync(outputDir,{recursive:true,force:true});mkdirSync(join(outputDir,'failed-case'),{recursive:true});
        for(const filename of ['test-failed-1.png','trace.zip']){
          const file=join(outputDir,'failed-case',filename),identity=`${id}:${spec??'all'}`;
          writeFileSync(file,identity);saved.push({file,identity});
        }
      }
      for(const {file,identity} of saved)expect(readFileSync(file,'utf8')).toBe(identity);
    }finally{vi.unstubAllEnvs();vi.resetModules();rmSync(root,{recursive:true,force:true});}
  });
  test('manifest inventory retains per-spec failure screenshots and traces with hashes and command association',()=>{
    const root=mkdtempSync(join(tmpdir(),'rec-attachment-inventory-'));
    try{
      for(const dir of ['playwright/lab-e2e-browser/failed-case','playwright/lab-runtime-e2e/failed-case','playwright/lab-mock-e2e/coffee-journey/failed-case','playwright/lab-offline-e2e/twin-recovery/failed-case']){
        mkdirSync(join(root,dir),{recursive:true});
        for(const file of ['test-failed-1.png','trace.zip'])writeFileSync(join(root,dir,file),'hello');
      }
      const rows=physicalArtifacts(root);
      expect(rows).toHaveLength(8);
      expect(rows).toContainEqual({file:'playwright/lab-mock-e2e/coffee-journey/failed-case/test-failed-1.png',commandId:'lab-mock-e2e',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'});
      expect(rows).toContainEqual({file:'playwright/lab-offline-e2e/twin-recovery/failed-case/trace.zip',commandId:'lab-offline-e2e',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'});
      expect(rows.filter((r:{commandId:string})=>r.commandId==='lab-e2e-browser')).toHaveLength(2);
      expect(rows.filter((r:{commandId:string})=>r.commandId==='lab-runtime-e2e')).toHaveLength(2);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
