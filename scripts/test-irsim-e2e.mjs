// pnpm test:irsim-e2e [-- spec ...] — end to end through the pinned source runtime with the REAL IR-SIM worker and LinkForge, via the real lab:irsim
// launcher: fresh temp journal, the launcher's one-use pairing code handed to Playwright, then Ctrl-C. A missing Python/venv/worker or an unavailable
// provider makes the launcher exit before ready, and this script FAILS (exit 1); it never skips and never falls back to mock.
// --provider webots / --provider mujoco: the same through lab:webots (real Webots R2025a) or lab:mujoco (real MuJoCo worker); leftovers of that provider fail the run.
// UI/runtime ports are the launcher's 4175/4176 (the only origins the source runtime accepts browser traffic from; never 1880/1884), passed explicitly.
// Failure attachments go to LAB_PW_OUTPUT_DIR, default a fresh <tmp>/mekoniq-e2e-output/<spec>-<time> per spec (outside test-results/, which the next run would wipe); the path is printed.
// Screenshots (candidate evidence only, not backend evidence) go to LAB_IRSIM_SCREENSHOTS (default test-results/irsim-evidence, git-ignored).
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pairingOutput} from './launcher-output.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// spec files go to Playwright; every other argument (e.g. --irsim-python <path>) goes to the launcher
const args=process.argv.slice(2).filter(a=>a!=='--'),specs=args.filter(a=>a.endsWith('.spec.ts')),launcherArgs=args.filter(a=>!a.endsWith('.spec.ts'));
const named=launcherArgs.includes('--provider')?launcherArgs[launcherArgs.indexOf('--provider')+1]:'irsim',provider=['webots','mujoco'].includes(named)?named:'irsim';
const NAME={irsim:['IRSIM','lab:irsim (real IR-SIM worker)','irsim-journey.spec.ts'],webots:['WEBOTS','lab:webots (real Webots R2025a)','webots-journey.spec.ts'],mujoco:['MUJOCO','lab:mujoco (real MuJoCo worker)','mujoco-coffee.spec.ts']}[provider];
// processes the launcher's runtime may have left: the IR-SIM worker, the Webots executable and its controller scripts (anchored at the start of the command line), or the MuJoCo worker
const LEFTOVER=provider==='webots'?'^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller)\\.py|webots_worker':provider==='mujoco'?'mujoco_worker':'irsim_worker';
const workers=()=>{try{return execFileSync('pgrep',['-f',LEFTOVER],{encoding:'utf8'}).trim().split('\n').filter(Boolean);}catch{return [];}};
const {CI:_ci,...env}=process.env;// Playwright must reuse the launcher's UI, not start its own
env.LAB_IRSIM_SCREENSHOTS=resolve(process.env.LAB_IRSIM_SCREENSHOTS??join(root,'test-results/irsim-evidence'));await mkdir(env.LAB_IRSIM_SCREENSHOTS,{recursive:true});
if(specs.length>1){console.error(`ONE_SPEC_PER_LAUNCHER: the launcher's pairing code is one-use, so only the first of ${specs.join(', ')} could pair; run them one at a time.`);process.exit(2);}
const work=await mkdtemp(join(tmpdir(),'mekoniq-irsim-e2e-')),before=new Set(workers());
let launcher,runner;
const stop=()=>{runner?.kill('SIGTERM');launcher?.kill('SIGINT');};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 launcher=spawn(process.execPath,[join(root,'scripts/start-irsim.mjs'),'--ui-port','4175','--runtime-port','4176','--data-dir',join(work,'runs'),...launcherArgs],{cwd:root,stdio:['ignore','pipe','inherit'],env});
 const exited=new Promise(r=>launcher.once('exit',c=>r(c??1)));
 const redacted=pairingOutput(c=>process.stdout.write(c));launcher.stdout.once('end',()=>redacted.end());
 const token=await new Promise((ok,fail)=>{let out='';launcher.stdout.on('data',c=>{out+=c;redacted.write(c);const m=/one-use pairing code \(expires in 5 minutes\): (\S+)[\s\S]*Ready in/.exec(out);if(m)ok(m[1]);});void exited.then(c=>fail(new Error(`${NAME[0]}_PREREQUISITE_FAILED: the ${NAME[1].split(' ')[0]} launcher exited before ready (${c}); see its message above. Not skipped.`)));});
 const list=specs.length?specs:[NAME[2]];
 env.LAB_PW_OUTPUT_DIR=resolve(process.env.LAB_PW_OUTPUT_DIR??join(tmpdir(),'mekoniq-e2e-output',`${list[0].replace(/\.spec\.ts$/,'')}-${new Date().toISOString().replace(/[:.]/g,'-')}`));
 console.log(`Running ${list.join(', ')} through pnpm ${NAME[1]} with a fresh journal; failure attachments in ${env.LAB_PW_OUTPUT_DIR}.`);
 runner=spawn('pnpm',['exec','playwright','test','--config','playwright.irsim.config.ts',...list],{cwd:root,stdio:'inherit',env:{...env,LAB_TEST_PAIRING_TOKEN:token}});
 const code=await new Promise((ok,fail)=>{runner.once('error',fail);runner.once('exit',c=>ok(c??1));});
 runner=undefined;launcher.kill('SIGINT');const stopped=await exited;launcher=undefined;
 const left=workers().filter(p=>!before.has(p));
 if(left.length){console.error(`${NAME[0]}_WORKER_LEFT_RUNNING: ${left.join(', ')}`);process.exitCode=1;}
 if(stopped!==0){console.error(`Launcher did not stop cleanly: ${stopped}`);process.exitCode=1;}
 if(code)process.exitCode=code;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
 stop();
 await rm(work,{recursive:true,force:true});
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
