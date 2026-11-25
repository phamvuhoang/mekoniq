// Command-line options of the regression recorder, separate so the rules (a new evidence root must be new; the legacy default is unchanged) can be tested without recording.
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
export const LEGACY_ROOT='docs/implementation/evidence/digital-twin-v2/regression';
export const SUITES=['legacy','physical-robot-lab'];
export const PHYSICAL_BROWSER_RUNS=['lab-e2e-browser','lab-mock-e2e','lab-offline-e2e'];
export function parseRecorderArgs(argv,lab,{exists=existsSync}={}){
 const o={ci:false,suite:'legacy',out:resolve(lab,LEGACY_ROOT),explicitOut:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--ci')o.ci=true;
  else if(a==='--suite'){o.suite=argv[++i];if(!SUITES.includes(o.suite))throw new Error(`UNKNOWN_SUITE:${o.suite}`);}
  else if(a==='--out'){if(!argv[i+1])throw new Error('OUT_REQUIRED');o.out=resolve(lab,argv[++i]);o.explicitOut=true;}
  else throw new Error(`UNKNOWN_ARGUMENT:${a}`);
 }
 // the physical-robot-lab gate never reuses or replaces an evidence directory, and never writes into the historical digital-twin-v2 root
 if(o.suite==='physical-robot-lab'){
  if(!o.explicitOut)throw new Error('OUT_REQUIRED_FOR_SUITE');
  if(o.out===resolve(lab,LEGACY_ROOT))throw new Error('LEGACY_ROOT_FORBIDDEN');
 }
 if(o.explicitOut&&exists(o.out))throw new Error('OUT_EXISTS');
 return o;
}

/** Each browser command has its own screenshot directory inside the fresh recording, even when specs reuse filenames. */
export function physicalPlan(out,commandId='lab-e2e-browser'){
 const brand=`${out}/brand-ui`,screens=`${out}/screens/${commandId}`,offlineSpecs=['twin-recovery.spec.ts','coffee-journey.spec.ts','offline-bv01.spec.ts'];
 return {
  dirs:[brand,screens],
  browserEnv:{LAB_BRAND_EVIDENCE_DIR:brand,LAB_EVIDENCE_DIR:screens,LAB_PW_OUTPUT_DIR:`${out}/playwright/${commandId}`},
  offlineSpecs,
  offlineFiles:offlineSpecs.map(x=>`lab-pw-offline-${x.replace(/\.ts$/,'').replace(/\.spec$/,'')}.json`),
 };
}
/** Every file under root, as `dir/relative` with its sha256 and optional producing command, in a stable order; a missing directory has none. */
export function listArtifacts(root,dir,commandId){
 const walk=rel=>{
  const full=join(root,rel);if(!existsSync(full))return [];
  return readdirSync(full).sort().flatMap(name=>{const r=join(rel,name);return statSync(join(root,r)).isDirectory()?walk(r):[r];});
 };
 return walk('').map(f=>({file:`${dir}/${f}`,sha256:createHash('sha256').update(readFileSync(join(root,f))).digest('hex'),...commandId?{commandId}:{}}));
}
/** Per-spec result naming for launchers that start a separate Playwright process for each spec. */
export function playwrightSpecEnv(env,spec){
 return {...env,...env.LAB_PW_JSON?{LAB_PW_JSON:env.LAB_PW_JSON.replace(/\.json$/,`-${spec.replace(/\.spec\.ts$/,'')}.json`)}:{},
  ...env.LAB_PW_OUTPUT_DIR?{LAB_PW_OUTPUT_DIR:join(env.LAB_PW_OUTPUT_DIR,spec.replace(/\.spec\.ts$/,''))}:{}};
}
export function physicalArtifacts(out){
 return [...listArtifacts(`${out}/brand-ui`,'brand-ui','lab-e2e-browser'),
  ...PHYSICAL_BROWSER_RUNS.flatMap(id=>listArtifacts(physicalPlan(out,id).browserEnv.LAB_EVIDENCE_DIR,`screens/${id}`,id)),
  ...[...PHYSICAL_BROWSER_RUNS,'lab-runtime-e2e'].flatMap(id=>listArtifacts(`${out}/playwright/${id}`,`playwright/${id}`,id))];
}
/** Why a Playwright summary does not count as the gate having run (null when it did): a skipped spec is not a pass. */
export function notExecuted(summary){
 if(!summary)return 'no result recorded';
 if(summary.skipped>0)return `${summary.skipped} test(s) skipped (the environment the gate needs was missing)`;
 if(!(summary.expected>0))return 'no test ran';
 return null;
}
