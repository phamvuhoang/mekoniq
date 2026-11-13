#!/usr/bin/env node
// Records one simulation-extension qualification candidate (plan 01 W09 Release 1; plan 2026-11-10-webots-arm X08 Release 1.1) into a fresh directory: the algorithm oracles (ALG01-03/05, PID01-03), the Webots campaign
// through scripts/lab-irsim.mjs --provider webots, every verification suite of scripts/sim-extension-qualification.mjs (source vitest/pytest, Lab vitest, the Lab Webots browser
// journeys with screenshots), the license inventory check and a Webots step-time measurement, with the source/Lab identity stamped before and after. It builds on a recorded
// LinkForge + IR-SIM record of the SAME source commit and the Lab's mock regression manifest. Writes <out>/qualification.json (sim-extension-qualification/1): an evidence INPUT
// for review: `accepted` is always false, a gate is `tested` at most, and tests/acceptance/sim-extension.acceptance.test.ts refuses anything inconsistent.
//   node scripts/record-sim-extension.mjs --release r1 --out DIR --candidate-id ID --irsim-record DIR --mock-regression DIR [--lab DIR|none] [--skip-suites]
//        [--webots-home DIR] [--webots-python PATH]
//   node scripts/record-sim-extension.mjs --release r1.1 --out DIR --candidate-id ID --r1-record DIR --mock-regression DIR [--lab DIR|none] [--skip-suites] [--webots-home DIR] [--webots-python PATH]
// R1.1 (D32) records the Webots arm suites and REG02: the R1 record (and the IR-SIM record and mock regression it was built on, taken from its own directory) must be of the SAME commit.
//   node scripts/record-sim-extension.mjs --release r2a --out DIR --candidate-id ID --r11-record DIR --mock-regression DIR [--lab DIR|none] [--skip-suites] [--webots-home DIR] [--webots-python PATH]
//        [--blocked G-MA1,G-MA2,G-RT2,G-INT4 --blocked-reason TEXT] [--plan]
// R2a (D71) records the MuJoCo arm, web runtime and twin UI suites and REG03: the R1.1 record (and the R1, IR-SIM and mock records it carries) must be of the SAME source commit and
// the SAME Lab commit as this recording, and the mock regression given must be the one it carries. Before anything is written it builds the runtime image for this machine's
// architecture from this commit (deploy/lab-runtime/build.sh, which refuses a dirty tree; nothing is pushed, no cloud command runs) for the container suite (RT05), and removes that
// image when the recording ends, on every exit path. --blocked is refused unless the M00 spike note concludes failure and every gate named is of part A (D70). G-CLOUD1 is always
// blocked_external (no deployment has been ordered). Every release: a pre-flight refuses a missing Docker (when the container suite is planned), a missing Python environment and, on
// macOS, a locked screen when a step starts the Webots application, before any suite runs. --plan prints the steps and the pre-flight results and exits.
// Refuses an existing --out, a dirty source tree, a Lab whose pin is not this source commit/closure, bytecode under a tool root, and an --irsim-record of another commit.
// A record that exits 1 or 2 is never edited by hand: fix the cause and record the next candidate. Exit 0 complete (not_run only where declared), 1 a suite or the campaign failed or
// the record is inconsistent, 2 prerequisite/usage (not_run), 130/143 on a signal.
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {arch,homedir,hostname,platform,release,tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {closureIdentity,ownOutput,treeState} from './lab-irsim.mjs';
import {bytecodeUnder,summarizeResult as summarize} from './irsim-qualification.mjs';
import {SPIKE_NOTE,SUITES,SUITES_R11,checkBlocked,checkLabCommits,preflight,screenLockedFromIoreg,checkIrsimRecord,checkR1Record,checkR11Record,checkQualification,qualify,qualifyR11,qualifyR2a,tableR2a} from './sim-extension-qualification.mjs';
import {PORTABLE_TOOL_PATHS} from './native-sim/tool-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=(code,m)=>{console.error(`${code}: ${m}`);process.exit(code==='NOT_RUN'?2:1);};
const raw=process.argv.slice(2),own={release:undefined,out:undefined,candidateId:undefined,irsimRecord:undefined,r1Record:undefined,r11Record:undefined,mock:undefined,lab:undefined,skipSuites:false,plan:false,webotsHome:undefined,webotsPython:undefined,blocked:undefined,blockedReason:undefined};
const VALUE={'--release':'release','--out':'out','--candidate-id':'candidateId','--irsim-record':'irsimRecord','--r1-record':'r1Record','--r11-record':'r11Record','--mock-regression':'mock','--lab':'lab','--webots-home':'webotsHome','--webots-python':'webotsPython','--blocked':'blocked','--blocked-reason':'blockedReason'};
for(let i=0;i<raw.length;i++){const a=raw[i];if(a==='--skip-suites')own.skipSuites=true;else if(a==='--plan')own.plan=true;else if(VALUE[a]){const v=raw[++i];if(v===undefined||v.startsWith('--'))fail('NOT_RUN',`MISSING_VALUE:${a}`);own[VALUE[a]]=v;}else fail('NOT_RUN',`UNKNOWN_OPTION:${a}`);}
if(!['r1','r1.1','r2a'].includes(own.release))fail('NOT_RUN',`MISSING_OPTION:--release r1|r1.1|r2a${own.release?` (got ${own.release})`:''}`);
const R11=own.release==='r1.1',R2A=own.release==='r2a';
if(own.irsimRecord&&own.release!=='r1')fail('NOT_RUN','UNKNOWN_OPTION:--irsim-record (R1.1 and R2a take the IR-SIM record from the record they build on)');
if(own.r1Record&&!R11)fail('NOT_RUN','UNKNOWN_OPTION:--r1-record (only Release 1.1)');
for(const [k,f] of [['r11Record','--r11-record'],['blocked','--blocked'],['blockedReason','--blocked-reason']])if(own[k]!==undefined&&!R2A)fail('NOT_RUN',`UNKNOWN_OPTION:${f} (only Release R2a)`);
// --blocked (D70): part A gates only, with a reason, and only when the M00 spike note concludes failure; checked before anything else is read or written
const blocked=R2A&&(own.blocked!==undefined||own.blockedReason!==undefined)?{gates:(own.blocked??'').split(',').filter(Boolean),reason:own.blockedReason??''}:null;
if(blocked){const p=checkBlocked(blocked,existsSync(join(root,SPIKE_NOTE))?readFileSync(join(root,SPIKE_NOTE),'utf8'):'');if(p.length)fail('NOT_RUN',p.join('; '));}
const table=R2A?tableR2a(blocked?.gates??[],blocked?.reason):null,SUITES_RUN=R2A?table.suites:R11?SUITES_R11:SUITES;
for(const [k,f] of [['out','--out'],[R2A?'r11Record':R11?'r1Record':'irsimRecord',R2A?'--r11-record':R11?'--r1-record':'--irsim-record'],['mock','--mock-regression']])if(!own[k])fail('NOT_RUN',`MISSING_OPTION:${f}`);
const out=resolve(own.out),r11Dir=R2A?resolve(own.r11Record):null,r1Dir=R11?resolve(own.r1Record):null,irsimDir=R2A?r11Dir:R11?r1Dir:resolve(own.irsimRecord),mockDir=resolve(own.mock);
const labDir=own.lab==='none'?null:own.lab?resolve(own.lab):existsSync(join(root,'../lab/config/source-runtime.lock.json'))?resolve(root,'../lab'):null;
const imageTag=`mekoniq-lab-runtime:record-${process.pid}`,imagePlatform=`linux/${arch()==='x64'?'amd64':arch()}`;
/** How a suite of the table is run: the same for the plan and the recording. */
const suiteRun=(s,cwd,abs,env={})=>s.kind==='vitest'?{cmd:process.execPath,args:[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...s.files,'--reporter=json',`--outputFile=${abs}`,'--reporter=default'],env}
 :s.kind==='pytest'?{cmd:join(root,s.python),args:['-m','pytest',...s.files,'-q',`--junitxml=${abs}`],env}:{cmd:process.execPath,args:s.command.map(a=>a.endsWith('.mjs')?join(cwd,a):a),env};
const PLANNED=own.skipSuites?[]:SUITES_RUN;
const probes={docker:()=>spawnSync('docker',['info'],{stdio:'ignore',timeout:30_000}).status===0,exists:(p)=>existsSync(join(root,p)),platform:platform(),
 screenLocked:()=>screenLockedFromIoreg(spawnSync('ioreg',['-n','Root','-d1','-a'],{encoding:'utf8',timeout:10_000}).stdout)};
const checks=()=>preflight({release:own.release,suites:PLANNED},probes);
if(own.plan){
 const line=(id,cwd,cmd,args)=>console.log(`${id}\t${cwd}\t${[cmd,...args].join(' ')}`);
 for(const c of checks())console.log(`preflight\t${c.id}\t${c.ok?'ok':c.code}\t${c.message}`);
 console.log(`# record-sim-extension --release ${own.release}: the steps it would run, in order (id, working directory, command); nothing is run`);
 if(!R11&&!R2A){line('algorithm',root,process.execPath,['scripts/lab-algorithm.mjs','run','--out','<scratch>']);line('campaign',root,process.execPath,['scripts/lab-irsim.mjs','run','--provider','webots','--campaign','r1-qualification','--out',join(out,'campaign'),'…']);}
 if(R2A&&SUITES_RUN.some(s=>s.image))line('rt-image',root,'sh',['deploy/lab-runtime/build.sh',imageTag,'--platform',imagePlatform,'(before the record directory exists; the image is removed when the recording ends, on every exit path)']);
 for(const s of SUITES_RUN){const cwd=s.repo==='lab'?labDir??'<no Lab: not run>':root,r=suiteRun(s,cwd,join(out,`suites/${s.id}.${s.kind==='pytest'?'xml':'json'}`));line(s.id,cwd,r.cmd,r.args);}
 line('licenses',root,process.execPath,['scripts/portable-licenses.mjs','--check']);if(!R11&&!R2A)line('performance',root,process.execPath,['scripts/measure-webots.mjs','…']);
 if(blocked)console.log(`# blocked: ${blocked.gates.join(',')} (${blocked.reason})`);
 process.exit(0);
}
if(existsSync(out))fail('NOT_RUN',`OUT_EXISTS: ${out} (a record is written once, into a new directory)`);
const candidateId=own.candidateId??out.replace(/\/+$/,'').split('/').pop();
const ownPaths=ownOutput(out),sha=(b)=>createHash('sha256').update(b).digest('hex');
const webotsHome=resolve(own.webotsHome??process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app'),webotsExe=join(webotsHome,'Contents/MacOS/webots'),webotsPython=resolve(own.webotsPython??join(root,'.venv-webots/bin/python'));
const lockOf=(p)=>existsSync(join(root,p))?sha(readFileSync(join(root,p))):null;
const webotsIdentity=()=>{if(!existsSync(webotsExe))return null;try{return {version:execFileSync(webotsExe,['--version'],{encoding:'utf8',timeout:30000}).trim().split('\n').pop(),executableSha256:sha(readFileSync(webotsExe))};}catch{return null;}};
const {tsImport}=await import('tsx/esm/api'),{loadOracleProfile}=await tsImport('../packages/lab-runtime/src/v2/algorithm/checker.ts',import.meta.url);
const identity=()=>{const tree=treeState(root,ownPaths);
 return {sourceCommit:tree.head,dirty:tree.dirty,dirtyReasons:tree.reasons.slice(0,50),toolClosures:closureIdentity(),node:process.version,os:`${platform()} ${release()}`,arch:arch(),lockSha256:lockOf('robotics/navigation-2d/requirements.lock'),
  locks:{algorithm:lockOf('robotics/algorithm/requirements.lock'),simulation3d:lockOf('robotics/simulation-3d/requirements.lock'),irsim:lockOf('robotics/navigation-2d/requirements.lock'),linkforge:lockOf('robotics/model-validation/requirements.lock'),mujoco:lockOf('robotics/simulation-mujoco/requirements.lock')},
  webots:webotsIdentity(),oracleProfileDigest:loadOracleProfile().digest,at:new Date().toISOString()};};
const before=identity();
if(before.dirty)fail('NOT_RUN',`SOURCE_DIRTY: commit the source before recording evidence (${before.dirtyReasons.slice(0,5).join('; ')})`);
if(!before.webots)fail('NOT_RUN',`WEBOTS_NOT_INSTALLED: no Webots R2025a at ${webotsHome}`);
// the recorded inputs this record builds on: the LinkForge + IR-SIM record and the Lab's mock regression, both of THIS source commit
const readJson=(p,what)=>{try{return JSON.parse(readFileSync(p,'utf8'));}catch{return fail('NOT_RUN',`${what}: cannot read ${p}`);}};
const mockDoc=readJson(join(mockDir,'manifest.json'),'MOCK_REGRESSION_MISSING');
// R1: the IR-SIM record is the input. R1.1: the R1 record is, and the IR-SIM record is the one it carries (irsim-record.json, byte for byte what R1 checked).
// R2a: the R1.1 record is, and the R1, IR-SIM and mock records are the ones it carries (r1-record.json, irsim-record.json, and the mock regression byte for byte)
const r11Doc=R2A?readJson(join(r11Dir,'qualification.json'),'R11_RECORD_MISSING'):null;
const carried=(dir,doc,ref,what)=>{const f=join(dir,doc[ref]?.file??'-');if(!existsSync(f)||sha(readFileSync(f))!==doc[ref]?.sha256)fail('NOT_RUN',`${what}: the record directory ${dir} has no ${doc[ref]?.file??ref} matching what its record names`);};
if(R2A){const p=checkR11Record(r11Doc,before.sourceCommit);if(p.length)fail('NOT_RUN',`${p.join('; ')} (record release r1.1 for this commit first)`);
 carried(r11Dir,r11Doc,'r1Record','R1_RECORD_MISSING');carried(r11Dir,r11Doc,'irsimRecord','IRSIM_RECORD_MISSING');
 if(sha(readFileSync(join(mockDir,'manifest.json')))!==r11Doc.mockRegression?.sha256)fail('NOT_RUN','MOCK_REGRESSION_NOT_THE_R11_ONE: --mock-regression is not the regression the R1.1 record carries');}
const r1Doc=R11?readJson(join(r1Dir,'qualification.json'),'R1_RECORD_MISSING'):R2A?readJson(join(r11Dir,r11Doc.r1Record.file),'R1_RECORD_MISSING'):null;
if(R11||R2A){const p=checkR1Record(r1Doc,before.sourceCommit);if(p.length)fail('NOT_RUN',`${p.join('; ')} (record release r1 for this commit first)`);}
if(R11)carried(r1Dir,r1Doc,'irsimRecord','IRSIM_RECORD_MISSING');
const irsimDoc=R11?readJson(join(r1Dir,r1Doc.irsimRecord.file),'IRSIM_RECORD_MISSING'):R2A?readJson(join(r11Dir,r11Doc.irsimRecord.file),'IRSIM_RECORD_MISSING'):readJson(join(irsimDir,'qualification.json'),'IRSIM_RECORD_MISSING');

const irsimProblems=checkIrsimRecord(irsimDoc,before.sourceCommit);if(irsimProblems.length)fail('NOT_RUN',`${irsimProblems.join('; ')} (record linkforge-irsim for this commit first)`);
if(mockDoc.schema!=='lab-v2-regression/1'||mockDoc.identity?.start?.source?.commit!==before.sourceCommit)fail('NOT_RUN',`MOCK_REGRESSION_COMMIT: the Lab regression is of ${mockDoc.identity?.start?.source?.commit??'no commit'}, this source is ${before.sourceCommit}`);
if(own.lab&&own.lab!=='none'&&!existsSync(join(labDir,'config/source-runtime.lock.json')))fail('NOT_RUN',`LAB_NOT_FOUND: ${own.lab}`);
const labInfo=()=>{if(!labDir)return null;const git=(...a)=>spawnSync('git',a,{cwd:labDir,encoding:'utf8'}).stdout.trim(),pin=JSON.parse(readFileSync(join(labDir,'config/source-runtime.lock.json'),'utf8'));
 return {path:labDir,commit:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=all').length>0,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}};};
const labBefore=labInfo(),notRunEarly=[];
if(labBefore){
 const bytecode=bytecodeUnder(root,PORTABLE_TOOL_PATHS);if(bytecode.length)fail('NOT_RUN',`PORTABLE_BYTECODE: ${bytecode.slice(0,5).join(', ')}${bytecode.length>5?` (+${bytecode.length-5})`:''} — the Lab launchers refuse a closure with bytecode; remove it yourself (find <root> -name __pycache__ -prune -exec rm -rf {} +)`);
 if(labBefore.dirty)fail('NOT_RUN','LAB_DIRTY: commit the Lab before recording evidence');
 if(labBefore.pin.sourceCommit!==before.sourceCommit)fail('NOT_RUN',`LAB_PIN_MISMATCH: the Lab pins ${labBefore.pin.sourceCommit}, this source is ${before.sourceCommit} (export, import and pin first)`);
 if(labBefore.pin.portableToolsDigest!==before.toolClosures.portable)fail('NOT_RUN',`LAB_PORTABLE_DIGEST_MISMATCH: Lab ${labBefore.pin.portableToolsDigest}, tree ${before.toolClosures.portable}`);
}
// R2a: every input is of this Lab commit too (the Lab adds UI commits under an unchanged pin)
if(R2A){if(!labBefore)fail('NOT_RUN','LAB_NOT_FOUND: release r2a records the Lab and binds its inputs to the Lab commit');
 const p=checkLabCommits({r11:r11Doc,r1:r1Doc,irsim:irsimDoc,mock:mockDoc},labBefore.commit);if(p.length)fail('NOT_RUN',`${p.join('; ')} (record the chain at this Lab commit)`);}
// pre-flight (every release): what would fail the recording later is refused now
{const bad=checks().filter(c=>!c.ok);if(bad.length)fail('NOT_RUN',bad.map(c=>`${c.code}: ${c.message}`).join('; '));}
// R2a, RT05: the runtime image of THIS commit for this machine's architecture, built before the record directory exists (build.sh refuses any untracked file). Never pushed.
let image=null,imageBuild=null,trapped=false;
if(R2A&&!own.skipSuites&&SUITES_RUN.some(s=>s.image)){
 // the image is this recording's own: removed when the process exits, whatever the path (process.exit, a signal handled below, an uncaught error)
 process.on('exit',()=>{spawnSync('docker',['image','rm','-f',imageTag],{stdio:'ignore',timeout:60_000});});
 // a signal before the recorder's own handlers exist (during the build) exits through 'exit' too, instead of the default termination that skips it
 for(const [sig,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.on(sig,()=>{if(!trapped)process.exit(code);});
 {const startedAt=new Date().toISOString(),b=spawnSync('sh',[join(root,'deploy/lab-runtime/build.sh'),imageTag,'--platform',imagePlatform],{cwd:root,encoding:'utf8',timeout:1_800_000,env:{...process.env,PATH:`${dirname(process.execPath)}:${process.env.PATH}`}});
  const label=spawnSync('docker',['image','inspect','--format','{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.Os}}/{{.Architecture}}',imageTag],{encoding:'utf8'}),[id,revision,plat]=(label.stdout??'').trim().split(' ');
  imageBuild={startedAt,finishedAt:new Date().toISOString(),exitCode:b.status??1,text:`${b.stdout??''}${b.stderr??''}`};
  image={tag:imageTag,platform:plat??null,id:id??null,revision:revision??null,built:b.status===0,revisionIsRecordedCommit:revision===before.sourceCommit};
  if(!image.built||!image.revisionIsRecordedCommit)notRunEarly.push({id:'suite:rt-container',reason:`IMAGE_NOT_USABLE: build exit ${b.status}, revision label ${revision??'none'}, recorded commit ${before.sourceCommit}`});}
}
await mkdir(join(out,'suites'),{recursive:true,mode:0o700});await mkdir(join(out,'screens'),{recursive:true});
const scrub=(t)=>t.replaceAll(resolve(root,'..'),'<workspace>').replaceAll(homedir(),'<home>').replaceAll(tmpdir(),'<tmp>').replaceAll(hostname(),'<host>');
const commands=[],suites=[],notRun=[...notRunEarly];
let signalled=0;const children=new Set();
// each suite runs in its own process group so a signal reaches the whole suite (lab-irsim, vitest), not only the direct child. Workers start their own groups (spawnWorker is detached), so the
// first signal is a polite one: lab-irsim and the vitest teardown close their workers on SIGTERM. SIGKILL follows only if the suite is still running 8 s later.
const sendGroup=(c,sig)=>{try{process.kill(-c.pid,sig);}catch{try{c.kill(sig);}catch{/* already gone */}}};
const killGroup=(c,sig)=>{sendGroup(c,sig==='SIGKILL'?'SIGTERM':sig);setTimeout(()=>{if(children.has(c))sendGroup(c,'SIGKILL');},8000).unref();};
trapped=true;
for(const [sig,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.on(sig,()=>{signalled||=code;for(const c of children)killGroup(c,sig);});
async function record(id,cmd,args,{cwd=root,env={},timeoutMs=3_600_000}={}){
 const startedAt=new Date().toISOString(),log=`suites/${id}.log`;
 const code=await new Promise((done)=>{const c=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:true});children.add(c);let text='';
  c.stdout.on('data',d=>{text+=d;});c.stderr.on('data',d=>{text+=d;});const t=setTimeout(()=>killGroup(c,'SIGKILL'),timeoutMs);
  c.once('close',(status,sig)=>{clearTimeout(t);children.delete(c);writeFile(join(out,log),scrub(text)).then(()=>done(status??(sig==='SIGINT'?130:sig==='SIGTERM'?143:sig==='SIGHUP'?129:1)));});});
 const entry={id,command:scrub(`${Object.entries(env).map(([k,v])=>`${k}=${v}`).join(' ')} ${cmd} ${args.join(' ')}`.trim()),cwd:cwd===root?'source':relative(root,cwd),startedAt,finishedAt:new Date().toISOString(),exitCode:code,log,logSha256:sha(readFileSync(join(out,log)))};
 console.log(`${id}: exit ${code}`);return entry;
}
const result=(id,file,kind)=>{const p=join(out,file);if(!existsSync(p))return undefined;const text=scrub(readFileSync(p,'utf8'));writeFileSync(p,text);return {file,sha256:sha(text),summary:summarize(kind,text)};};
if(imageBuild){await writeFile(join(out,'suites/rt-image.log'),scrub(imageBuild.text));
 commands.push({id:'rt-image',command:`sh deploy/lab-runtime/build.sh ${imageTag} --platform ${imagePlatform}`,cwd:'source',startedAt:imageBuild.startedAt,finishedAt:imageBuild.finishedAt,exitCode:imageBuild.exitCode,log:'suites/rt-image.log',logSha256:sha(readFileSync(join(out,'suites/rt-image.log')))});}
const pycache=join(tmpdir(),`mekoniq-pycache-${process.pid}`);await mkdir(pycache,{recursive:true,mode:0o700});
const webotsEnv={MEKONIQ_WEBOTS_HOME:webotsHome};

// ---- 1. the algorithm oracles (RTB kinematics, the PID reference) ----
let algorithm=null;
if(!R11&&!R2A){
 const scratchBase=mkdtempSync(join(tmpdir(),'mekoniq-alg-')),scratch=join(scratchBase,'out'),cmd=await record('algorithm',process.execPath,['scripts/lab-algorithm.mjs','run','--out',scratch]);commands.push(cmd);
 const f=join(scratch,'algorithm-results.json');
 if(existsSync(f)){const text=scrub(readFileSync(f,'utf8'));writeFileSync(join(out,'algorithm-results.json'),text);algorithm={file:'algorithm-results.json',sha256:sha(text)};}else notRun.push({id:'algorithm',reason:`no results written (exit ${cmd.exitCode})`});
 rmSync(scratchBase,{recursive:true,force:true});
}
// ---- 2. the Webots campaign (its own process, signal handling and worker groups), pinned to the closure stamped above ----
const NOCAMPAIGN=R11||R2A;
const campaignCmd=NOCAMPAIGN?null:await record('campaign',process.execPath,['scripts/lab-irsim.mjs','run','--provider','webots','--campaign','r1-qualification','--out',join(out,'campaign'),'--concurrency','1','--webots-home',webotsHome,'--webots-python',webotsPython,'--expect-portable-digest',before.toolClosures.portable],{timeoutMs:7_200_000});
let summary=null;if(!NOCAMPAIGN)try{summary=JSON.parse(await readFile(join(out,'campaign','summary.json'),'utf8'));}catch{summary=null;}
const campaign=NOCAMPAIGN?null:{command:campaignCmd.command,exitCode:campaignCmd.exitCode,log:campaignCmd.log,summary:summary?{path:'campaign/summary.json',sha256:sha(readFileSync(join(out,'campaign','summary.json'))),status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider}:null};
if(!NOCAMPAIGN&&!summary)notRun.push({id:'campaign',reason:`no summary written (exit ${campaignCmd.exitCode})`});

// ---- 3. the verification suites (each named by the cases it tests in sim-extension-qualification.mjs) ----
if(!own.skipSuites&&!signalled)for(const s of SUITES_RUN){
 if(signalled)break;
 if(s.repo==='lab'&&!labDir){notRun.push({id:`suite:${s.id}`,reason:'no Lab checkout (--lab)'});continue;}
 if(s.image&&!image?.revisionIsRecordedCommit)continue; // its reason is in notRun already (no Docker, or no usable image of this commit)
 const cwd=s.repo==='lab'?labDir:root,file=`suites/${s.id}.${s.kind==='pytest'?'xml':'json'}`,abs=join(out,file);
 // R2a: each browser suite has its own screenshot directory (mock and launcher specs both read LAB_EVIDENCE_DIR or LAB_IRSIM_SCREENSHOTS)
 const shots=R2A?join(out,'screens',s.id):join(out,'screens');if(R2A&&s.kind==='playwright')await mkdir(shots,{recursive:true});
 const env=s.kind==='vitest'?{LAB_V2_CLEAN_EXPORT:'1',...s.image?{LAB_CONTAINER_IMAGE:image.tag}:{},...webotsEnv}:s.kind==='pytest'?{PYTHONPATH:(s.pythonPath??[]).map(p=>join(root,p)).join(':'),PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:pycache,PYTHONNOUSERSITE:'1',...webotsEnv}
  :{LAB_PW_JSON:abs,LAB_IRSIM_SCREENSHOTS:shots,...R2A?{LAB_EVIDENCE_DIR:shots}:{},...webotsEnv};
 const run=suiteRun(s,cwd,abs,env),entry=await record(s.id,run.cmd,run.args,{cwd,env:run.env});
 // the mock launcher names a spec's result <name>-<spec>.json (one per spec); a suite here runs exactly one spec
 const spec=(s.command??[]).find(a=>a.endsWith('.spec.ts')),perSpec=spec&&abs.replace(/\.json$/,`-${spec.replace(/\.spec\.ts$/,'')}.json`);
 if(perSpec&&!existsSync(abs)&&existsSync(perSpec))renameSync(perSpec,abs);
 const res=result(s.id,file,s.kind);
 suites.push({...entry,repo:s.repo,kind:s.kind,...res?{result:res}:{}});
 if(!res)notRun.push({id:`suite:${s.id}`,reason:`no result file (exit ${entry.exitCode})`});
}
// ---- 4. license inventory check and the Webots step-time measurement (a measurement, never a gate) ----
if(!signalled){
 commands.push(await record('licenses',process.execPath,['scripts/portable-licenses.mjs','--check']));
 if(!R11&&!R2A){const perf=await record('performance',process.execPath,['scripts/measure-webots.mjs','--out',join(out,'performance.json'),'--webots-home',webotsHome,'--webots-python',webotsPython],{timeoutMs:900_000});
  commands.push(perf);if(!existsSync(join(out,'performance.json')))notRun.push({id:'performance',reason:`measurement not written (exit ${perf.exitCode})`});}
}
// ---- 5. the inputs this record builds on, copied byte for byte (the check reads them back from here, never from a claim) ----
if(R11){copyFileSync(join(r1Dir,'qualification.json'),join(out,'r1-record.json'));copyFileSync(join(r1Dir,r1Doc.irsimRecord.file),join(out,'irsim-record.json'));}
else if(R2A){copyFileSync(join(r11Dir,'qualification.json'),join(out,'r11-record.json'));copyFileSync(join(r11Dir,r11Doc.r1Record.file),join(out,'r1-record.json'));copyFileSync(join(r11Dir,r11Doc.irsimRecord.file),join(out,'irsim-record.json'));
 if(blocked)copyFileSync(join(root,SPIKE_NOTE),join(out,'spike-note.md'));}
else copyFileSync(join(irsimDir,'qualification.json'),join(out,'irsim-record.json'));
copyFileSync(join(mockDir,'manifest.json'),join(out,'mock-regression.json'));
const ref=(file,extra={})=>({file,sha256:sha(readFileSync(join(out,file))),...extra});
const irsimRecord=ref('irsim-record.json',{candidate:R11?r1Doc.irsimRecord.candidate:R2A?r11Doc.irsimRecord.candidate:irsimDir.replace(/\/+$/,'').split('/').pop(),sourceCommit:irsimDoc.identity.before.sourceCommit});
const r1Record=R11?ref('r1-record.json',{candidate:r1Dir.replace(/\/+$/,'').split('/').pop(),sourceCommit:r1Doc.identity.before.sourceCommit}):R2A?ref('r1-record.json',{candidate:r11Doc.r1Record.candidate,sourceCommit:r1Doc.identity.before.sourceCommit}):null;
const r11Record=R2A?ref('r11-record.json',{candidate:r11Dir.replace(/\/+$/,'').split('/').pop(),sourceCommit:r11Doc.identity.before.sourceCommit}):null;
const r2aExtra=R2A?{r11Record,image,...blocked?{blocked:{...blocked,spikeNote:ref('spike-note.md')}}:{}}:{};
const mockRegression={file:'mock-regression.json',sha256:sha(readFileSync(join(out,'mock-regression.json'))),labCommit:mockDoc.identity?.start?.lab?.commit??null,source:mockDir.includes('/docs/')?mockDir.slice(mockDir.indexOf('/docs/')+1):'(outside the repositories)'};

// ---- 6. identity after, statuses, the record ----
const after=identity(),labAfter=labInfo();
const identityStable=before.sourceCommit===after.sourceCommit&&!after.dirty&&before.toolClosures.portable===after.toolClosures.portable&&before.toolClosures.native===after.toolClosures.native&&JSON.stringify(before.locks)===JSON.stringify(after.locks)&&before.webots.executableSha256===after.webots?.executableSha256&&before.oracleProfileDigest===after.oracleProfileDigest&&(!labBefore||labBefore.commit===labAfter.commit&&!labAfter.dirty);
const algorithmDoc=algorithm?JSON.parse(readFileSync(join(out,algorithm.file),'utf8')):null;
const labRecorded=!!labDir&&suites.some(s=>s.id.startsWith('lab-e2e'));
const q=R2A?qualifyR2a({suites,lab:labRecorded,sourceCommit:before.sourceCommit,r11:r11Doc,r1:r1Doc,irsim:irsimDoc,mock:mockDoc,blocked}):R11?qualifyR11({suites,lab:labRecorded,sourceCommit:before.sourceCommit,r1:r1Doc,irsim:irsimDoc,mock:mockDoc}):qualify({campaign:summary&&summary.status==='completed'?summary:null,suites,lab:labRecorded,sourceCommit:before.sourceCommit,algorithm:algorithmDoc,irsim:irsimDoc,mock:mockDoc});
const walk=(d,rel='')=>readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).flatMap(e=>e.isDirectory()?walk(join(d,e.name),`${rel}${e.name}/`):e.isFile()&&`${rel}${e.name}`!=='qualification.json'?[{file:`${rel}${e.name}`,sha256:sha(readFileSync(join(d,e.name))),bytes:statSync(join(d,e.name)).size}]:[]);
const recordDoc={schemaVersion:1,documentType:'sim-extension-qualification',release:own.release,candidateId,accepted:false,acceptedBy:null,acceptedAt:null,
 note:R2A?'evidence input for review; implemented/tested/accepted are independent and no gate status is changed by this record; the MuJoCo arm is a plant with manufacturer-nominal and assumed parameters (not_calibrated) that grips by contact; a container run is not evidence for G-MA1/G-MA2 (D50); G-CLOUD1 is blocked_external until CL01 runs on a deployed service; no real arm, real amd64 machine, Cloud Run or hardware gate is in its scope':R11?'evidence input for review; implemented/tested/accepted are independent and no gate status is changed by this record; the arm is a Webots plant with assumed parameters (not_calibrated), gripping is an event, and no real arm, MuJoCo, Linux or hardware gate is in its scope':'evidence input for review; implemented/tested/accepted are independent and no gate status is changed by this record; MuJoCo, Linux and hardware gates are outside its scope',
 identity:{before,after,identityStable},lab:labBefore?{commit:labBefore.commit,dirty:labAfter.dirty,pin:labBefore.pin}:null,campaign,algorithm,...R11||R2A?{r1Record}:{},...r2aExtra,irsimRecord,mockRegression,suites,commands,performance:existsSync(join(out,'performance.json'))?'performance.json':null,
 cases:q.cases,gates:q.gates,notRun:[...q.notRun,...notRun],interrupted:signalled||undefined,artifacts:walk(out)};
await writeFile(join(out,'qualification.json'),JSON.stringify(recordDoc,null,1)+'\n',{flag:'wx'});
const problems=checkQualification(recordDoc,(p)=>{const f=join(out,p);return existsSync(f)?readFileSync(f):null;});
console.log(JSON.stringify({candidateId,cases:Object.fromEntries(Object.entries(q.cases).map(([k,v])=>[k,v.status])),gates:Object.fromEntries(Object.entries(q.gates).map(([k,v])=>[k,v.status])),notRun:recordDoc.notRun,problems}));
if(signalled)process.exit(signalled);
if(!identityStable){console.error('NOT_RUN: the source commit, the Lab, a tool closure, a lock or the Webots executable changed, or a tree became dirty, while recording');process.exit(2);}
if(!NOCAMPAIGN&&(!summary||campaignCmd.exitCode===2))process.exit(2);
process.exit(problems.filter(p=>!/^CASE_STATUS_MISMATCH|^GATE_STATUS_MISMATCH/.test(p)).length||Object.values(q.cases).some(c=>c.status==='failed')||suites.some(s=>s.exitCode!==0)||commands.some(c=>c.exitCode!==0)?1:0);
