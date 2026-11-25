// pnpm test:mock-e2e — end to end through the pinned source runtime via the real launcher: for each spec, start `start-mock.mjs` with a fresh temp
// journal, hand Playwright the one-use pairing code from the launcher's terminal output (no manual entry), then Ctrl-C the launcher.
// Default: FD01 food (twin-recovery.spec.ts) and BV01 coffee (coffee-journey.spec.ts). Usage: node scripts/test-mock-e2e.mjs [--evidence] [spec ...]
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pairingOutput} from './launcher-output.mjs';
import {playwrightSpecEnv} from './recorder-options.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
/** Launcher options a spec needs beyond the defaults: remote-origin.spec.ts opens the Lab on another origin and reaches the runtime with a bearer. */
const ui=process.env.LAB_TEST_UI_PORT??'4175',runtime=process.env.LAB_TEST_RUNTIME_PORT??'4176',extra=process.env.LAB_TEST_EXTRA_PORT??'4177';
const LAUNCHER_ARGS={'remote-origin.spec.ts':['--allow-origin',`http://localhost:${extra}`,'--extra-ui-port',extra]};
const args=process.argv.slice(2),specs=args.filter(a=>!a.startsWith('--'));
const {CI:_ci,...env}=process.env;// Playwright must reuse the launcher's UI, not start its own
env.LAB_PW_BASE_URL=`http://127.0.0.1:${ui}`;
if(args.includes('--evidence')){env.LAB_EVIDENCE_DIR=join(root,'docs/implementation/evidence/digital-twin-v2');await mkdir(env.LAB_EVIDENCE_DIR,{recursive:true});}
const work=await mkdtemp(join(tmpdir(),'mekoniq-mock-e2e-'));
let launcher,runner;
const stop=()=>{runner?.kill('SIGTERM');launcher?.kill('SIGINT');};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 for(const spec of specs.length?specs:['twin-recovery.spec.ts','coffee-journey.spec.ts']){
  const offline=process.env.LAB_TEST_OFFLINE_ROOT;
  launcher=spawn(offline?join(offline,'bin/node'):process.execPath,[offline?join(offline,'start.mjs'):join(root,'scripts/start-mock.mjs'),'--ui-port',ui,'--runtime-port',runtime,'--data-dir',join(work,`runs-${spec}`),...LAUNCHER_ARGS[spec]??[]],{cwd:root,stdio:['ignore','pipe','inherit'],env});
  const exited=new Promise(r=>launcher.once('exit',c=>r(c??1)));
  const redacted=pairingOutput(c=>process.stdout.write(c));launcher.stdout.once('end',()=>redacted.end());
  const token=await new Promise((ok,fail)=>{let out='';launcher.stdout.on('data',c=>{out+=c;redacted.write(c);const m=/one-use pairing code \(expires in 5 minutes\): (\S+)[\s\S]*Ready in/.exec(out);if(m)ok(m[1]);});void exited.then(c=>fail(new Error(`Launcher exited before ready: ${c}`)));});
  console.log(`Running ${spec} through pnpm lab:mock with a fresh journal.`);
  // one JSON result per spec when LAB_PW_JSON is set, so a later spec does not overwrite an earlier one
  runner=spawn('pnpm',['exec','playwright','test',spec],{cwd:root,stdio:'inherit',env:{...playwrightSpecEnv(env,spec),LAB_TEST_PAIRING_TOKEN:token}});
  const code=await new Promise((ok,fail)=>{runner.once('error',fail);runner.once('exit',c=>ok(c??1));});
  runner=undefined;launcher.kill('SIGINT');const stopped=await exited;launcher=undefined;
  if(stopped!==0){console.error(`Launcher did not stop cleanly: ${stopped}`);process.exitCode=1;break;}
  if(code){process.exitCode=code;break;}
 }
}finally{
 stop();
 await rm(work,{recursive:true,force:true});
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
