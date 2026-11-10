#!/usr/bin/env node
// Records one simulation-extension qualification candidate (plan 01 W09, Release 1) into a fresh directory: the algorithm oracles (ALG01-03/05, PID01-03), the Webots campaign
// through scripts/lab-irsim.mjs --provider webots, every verification suite of scripts/sim-extension-qualification.mjs (source vitest/pytest, Lab vitest, the Lab Webots browser
// journeys with screenshots), the license inventory check and a Webots step-time measurement, with the source/Lab identity stamped before and after. It builds on a recorded
// LinkForge + IR-SIM record of the SAME source commit and the Lab's mock regression manifest. Writes <out>/qualification.json (sim-extension-qualification/1): an evidence INPUT
// for review: `accepted` is always false, a gate is `tested` at most, and tests/acceptance/sim-extension.acceptance.test.ts refuses anything inconsistent.
//   node scripts/record-sim-extension.mjs --release r1 --out DIR --candidate-id ID --irsim-record DIR --mock-regression DIR [--lab DIR|none] [--skip-suites]
//        [--webots-home DIR] [--webots-python PATH]
// Refuses an existing --out, a dirty source tree, a Lab whose pin is not this source commit/closure, bytecode under a tool root, and an --irsim-record of another commit.
// A record that exits 1 or 2 is never edited by hand: fix the cause and record the next candidate. Exit 0 complete (not_run only where declared), 1 a suite or the campaign failed or
// the record is inconsistent, 2 prerequisite/usage (not_run), 130/143 on a signal.
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {arch,homedir,hostname,platform,release,tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {closureIdentity,ownOutput,treeState} from './lab-irsim.mjs';
import {bytecodeUnder,summarizeResult as summarize} from './irsim-qualification.mjs';
import {SUITES,checkIrsimRecord,checkQualification,qualify} from './sim-extension-qualification.mjs';
import {PORTABLE_TOOL_PATHS} from './native-sim/tool-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=(code,m)=>{console.error(`${code}: ${m}`);process.exit(code==='NOT_RUN'?2:1);};
const raw=process.argv.slice(2),own={release:undefined,out:undefined,candidateId:undefined,irsimRecord:undefined,mock:undefined,lab:undefined,skipSuites:false,webotsHome:undefined,webotsPython:undefined};
const VALUE={'--release':'release','--out':'out','--candidate-id':'candidateId','--irsim-record':'irsimRecord','--mock-regression':'mock','--lab':'lab','--webots-home':'webotsHome','--webots-python':'webotsPython'};
for(let i=0;i<raw.length;i++){const a=raw[i];if(a==='--skip-suites')own.skipSuites=true;else if(VALUE[a]){const v=raw[++i];if(v===undefined||v.startsWith('--'))fail('NOT_RUN',`MISSING_VALUE:${a}`);own[VALUE[a]]=v;}else fail('NOT_RUN',`UNKNOWN_OPTION:${a}`);}
if(own.release!=='r1')fail('NOT_RUN',`MISSING_OPTION:--release r1 (only Release 1 is implemented${own.release?`, got ${own.release}`:''})`);
for(const [k,f] of [['out','--out'],['irsimRecord','--irsim-record'],['mock','--mock-regression']])if(!own[k])fail('NOT_RUN',`MISSING_OPTION:${f}`);
const out=resolve(own.out),irsimDir=resolve(own.irsimRecord),mockDir=resolve(own.mock);
if(existsSync(out))fail('NOT_RUN',`OUT_EXISTS: ${out} (a record is written once, into a new directory)`);
const candidateId=own.candidateId??out.replace(/\/+$/,'').split('/').pop();
const ownPaths=ownOutput(out),sha=(b)=>createHash('sha256').update(b).digest('hex');
const webotsHome=resolve(own.webotsHome??process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app'),webotsExe=join(webotsHome,'Contents/MacOS/webots'),webotsPython=resolve(own.webotsPython??join(root,'.venv-webots/bin/python'));
const lockOf=(p)=>existsSync(join(root,p))?sha(readFileSync(join(root,p))):null;
const webotsIdentity=()=>{if(!existsSync(webotsExe))return null;try{return {version:execFileSync(webotsExe,['--version'],{encoding:'utf8',timeout:30000}).trim().split('\n').pop(),executableSha256:sha(readFileSync(webotsExe))};}catch{return null;}};
const {tsImport}=await import('tsx/esm/api'),{loadOracleProfile}=await tsImport('../packages/lab-runtime/src/v2/algorithm/checker.ts',import.meta.url);
const identity=()=>{const tree=treeState(root,ownPaths);
 return {sourceCommit:tree.head,dirty:tree.dirty,dirtyReasons:tree.reasons.slice(0,50),toolClosures:closureIdentity(),node:process.version,os:`${platform()} ${release()}`,arch:arch(),lockSha256:lockOf('robotics/navigation-2d/requirements.lock'),
  locks:{algorithm:lockOf('robotics/algorithm/requirements.lock'),simulation3d:lockOf('robotics/simulation-3d/requirements.lock'),irsim:lockOf('robotics/navigation-2d/requirements.lock'),linkforge:lockOf('robotics/model-validation/requirements.lock')},
  webots:webotsIdentity(),oracleProfileDigest:loadOracleProfile().digest,at:new Date().toISOString()};};
const before=identity();
if(before.dirty)fail('NOT_RUN',`SOURCE_DIRTY: commit the source before recording evidence (${before.dirtyReasons.slice(0,5).join('; ')})`);
if(!before.webots)fail('NOT_RUN',`WEBOTS_NOT_INSTALLED: no Webots R2025a at ${webotsHome}`);
// the recorded inputs this record builds on: the LinkForge + IR-SIM record and the Lab's mock regression, both of THIS source commit
const readJson=(p,what)=>{try{return JSON.parse(readFileSync(p,'utf8'));}catch{return fail('NOT_RUN',`${what}: cannot read ${p}`);}};
const irsimDoc=readJson(join(irsimDir,'qualification.json'),'IRSIM_RECORD_MISSING'),mockDoc=readJson(join(mockDir,'manifest.json'),'MOCK_REGRESSION_MISSING');
const irsimProblems=checkIrsimRecord(irsimDoc,before.sourceCommit);if(irsimProblems.length)fail('NOT_RUN',`${irsimProblems.join('; ')} (record linkforge-irsim for this commit first)`);
if(mockDoc.schema!=='lab-v2-regression/1'||mockDoc.identity?.start?.source?.commit!==before.sourceCommit)fail('NOT_RUN',`MOCK_REGRESSION_COMMIT: the Lab regression is of ${mockDoc.identity?.start?.source?.commit??'no commit'}, this source is ${before.sourceCommit}`);
const labDir=own.lab==='none'?null:own.lab?resolve(own.lab):existsSync(join(root,'../lab/config/source-runtime.lock.json'))?resolve(root,'../lab'):null;
if(own.lab&&own.lab!=='none'&&!existsSync(join(labDir,'config/source-runtime.lock.json')))fail('NOT_RUN',`LAB_NOT_FOUND: ${own.lab}`);
const labInfo=()=>{if(!labDir)return null;const git=(...a)=>spawnSync('git',a,{cwd:labDir,encoding:'utf8'}).stdout.trim(),pin=JSON.parse(readFileSync(join(labDir,'config/source-runtime.lock.json'),'utf8'));
 return {path:labDir,commit:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=all').length>0,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}};};
const labBefore=labInfo();
if(labBefore){
 const bytecode=bytecodeUnder(root,PORTABLE_TOOL_PATHS);if(bytecode.length)fail('NOT_RUN',`PORTABLE_BYTECODE: ${bytecode.slice(0,5).join(', ')}${bytecode.length>5?` (+${bytecode.length-5})`:''} — the Lab launchers refuse a closure with bytecode; remove it yourself (find <root> -name __pycache__ -prune -exec rm -rf {} +)`);
 if(labBefore.dirty)fail('NOT_RUN','LAB_DIRTY: commit the Lab before recording evidence');
 if(labBefore.pin.sourceCommit!==before.sourceCommit)fail('NOT_RUN',`LAB_PIN_MISMATCH: the Lab pins ${labBefore.pin.sourceCommit}, this source is ${before.sourceCommit} (export, import and pin first)`);
 if(labBefore.pin.portableToolsDigest!==before.toolClosures.portable)fail('NOT_RUN',`LAB_PORTABLE_DIGEST_MISMATCH: Lab ${labBefore.pin.portableToolsDigest}, tree ${before.toolClosures.portable}`);
}
await mkdir(join(out,'suites'),{recursive:true,mode:0o700});await mkdir(join(out,'screens'),{recursive:true});
const scrub=(t)=>t.replaceAll(resolve(root,'..'),'<workspace>').replaceAll(homedir(),'<home>').replaceAll(tmpdir(),'<tmp>').replaceAll(hostname(),'<host>');
const commands=[],suites=[],notRun=[];
let signalled=0;const children=new Set();
// each suite runs in its own process group so a signal reaches the whole suite (lab-irsim, vitest), not only the direct child. Workers start their own groups (spawnWorker is detached), so the
// first signal is a polite one: lab-irsim and the vitest teardown close their workers on SIGTERM. SIGKILL follows only if the suite is still running 8 s later.
const sendGroup=(c,sig)=>{try{process.kill(-c.pid,sig);}catch{try{c.kill(sig);}catch{/* already gone */}}};
const killGroup=(c,sig)=>{sendGroup(c,sig==='SIGKILL'?'SIGTERM':sig);setTimeout(()=>{if(children.has(c))sendGroup(c,'SIGKILL');},8000).unref();};
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
const pycache=join(tmpdir(),`mekoniq-pycache-${process.pid}`);await mkdir(pycache,{recursive:true,mode:0o700});
const webotsEnv={MEKONIQ_WEBOTS_HOME:webotsHome};

// ---- 1. the algorithm oracles (RTB kinematics, the PID reference) ----
let algorithm=null;
{
 const scratchBase=mkdtempSync(join(tmpdir(),'mekoniq-alg-')),scratch=join(scratchBase,'out'),cmd=await record('algorithm',process.execPath,['scripts/lab-algorithm.mjs','run','--out',scratch]);commands.push(cmd);
 const f=join(scratch,'algorithm-results.json');
 if(existsSync(f)){const text=scrub(readFileSync(f,'utf8'));writeFileSync(join(out,'algorithm-results.json'),text);algorithm={file:'algorithm-results.json',sha256:sha(text)};}else notRun.push({id:'algorithm',reason:`no results written (exit ${cmd.exitCode})`});
 rmSync(scratchBase,{recursive:true,force:true});
}
// ---- 2. the Webots campaign (its own process, signal handling and worker groups), pinned to the closure stamped above ----
const campaignCmd=await record('campaign',process.execPath,['scripts/lab-irsim.mjs','run','--provider','webots','--campaign','r1-qualification','--out',join(out,'campaign'),'--concurrency','1','--webots-home',webotsHome,'--webots-python',webotsPython,'--expect-portable-digest',before.toolClosures.portable],{timeoutMs:7_200_000});
let summary=null;try{summary=JSON.parse(await readFile(join(out,'campaign','summary.json'),'utf8'));}catch{summary=null;}
const campaign={command:campaignCmd.command,exitCode:campaignCmd.exitCode,log:campaignCmd.log,summary:summary?{path:'campaign/summary.json',sha256:sha(readFileSync(join(out,'campaign','summary.json'))),status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider}:null};
if(!summary)notRun.push({id:'campaign',reason:`no summary written (exit ${campaignCmd.exitCode})`});

// ---- 3. the verification suites (each named by the cases it tests in sim-extension-qualification.mjs) ----
if(!own.skipSuites&&!signalled)for(const s of SUITES){
 if(signalled)break;
 if(s.repo==='lab'&&!labDir){notRun.push({id:`suite:${s.id}`,reason:'no Lab checkout (--lab)'});continue;}
 const cwd=s.repo==='lab'?labDir:root,file=`suites/${s.id}.${s.kind==='pytest'?'xml':'json'}`,abs=join(out,file);
 let entry;
 if(s.kind==='vitest')entry=await record(s.id,process.execPath,[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...s.files,'--reporter=json',`--outputFile=${abs}`,'--reporter=default'],{cwd,env:{LAB_V2_CLEAN_EXPORT:'1',...webotsEnv}});
 else if(s.kind==='pytest')entry=await record(s.id,join(root,s.python),['-m','pytest',...s.files,'-q',`--junitxml=${abs}`],{cwd,env:{PYTHONPATH:(s.pythonPath??[]).map(p=>join(root,p)).join(':'),PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:pycache,PYTHONNOUSERSITE:'1',...webotsEnv}});
 else entry=await record(s.id,process.execPath,s.command.map(a=>a.endsWith('.mjs')?join(cwd,a):a),{cwd,env:{LAB_PW_JSON:abs,LAB_IRSIM_SCREENSHOTS:join(out,'screens'),...webotsEnv}});
 const res=result(s.id,file,s.kind);
 suites.push({...entry,repo:s.repo,kind:s.kind,...res?{result:res}:{}});
 if(!res)notRun.push({id:`suite:${s.id}`,reason:`no result file (exit ${entry.exitCode})`});
}
// ---- 4. license inventory check and the Webots step-time measurement (a measurement, never a gate) ----
if(!signalled){
 commands.push(await record('licenses',process.execPath,['scripts/portable-licenses.mjs','--check']));
 const perf=await record('performance',process.execPath,['scripts/measure-webots.mjs','--out',join(out,'performance.json'),'--webots-home',webotsHome,'--webots-python',webotsPython],{timeoutMs:900_000});
 commands.push(perf);if(!existsSync(join(out,'performance.json')))notRun.push({id:'performance',reason:`measurement not written (exit ${perf.exitCode})`});
}
// ---- 5. the inputs this record builds on, copied byte for byte (the check reads them back from here, never from a claim) ----
copyFileSync(join(irsimDir,'qualification.json'),join(out,'irsim-record.json'));copyFileSync(join(mockDir,'manifest.json'),join(out,'mock-regression.json'));
const irsimRecord={file:'irsim-record.json',sha256:sha(readFileSync(join(out,'irsim-record.json'))),candidate:irsimDir.replace(/\/+$/,'').split('/').pop(),sourceCommit:irsimDoc.identity.before.sourceCommit};
const mockRegression={file:'mock-regression.json',sha256:sha(readFileSync(join(out,'mock-regression.json'))),labCommit:mockDoc.identity?.start?.lab?.commit??null,source:mockDir.includes('/docs/')?mockDir.slice(mockDir.indexOf('/docs/')+1):'(outside the repositories)'};

// ---- 6. identity after, statuses, the record ----
const after=identity(),labAfter=labInfo();
const identityStable=before.sourceCommit===after.sourceCommit&&!after.dirty&&before.toolClosures.portable===after.toolClosures.portable&&before.toolClosures.native===after.toolClosures.native&&JSON.stringify(before.locks)===JSON.stringify(after.locks)&&before.webots.executableSha256===after.webots?.executableSha256&&before.oracleProfileDigest===after.oracleProfileDigest&&(!labBefore||labBefore.commit===labAfter.commit&&!labAfter.dirty);
const algorithmDoc=algorithm?JSON.parse(readFileSync(join(out,algorithm.file),'utf8')):null;
const q=qualify({campaign:summary&&summary.status==='completed'?summary:null,suites,lab:!!labDir&&suites.some(s=>s.id.startsWith('lab-e2e')),sourceCommit:before.sourceCommit,algorithm:algorithmDoc,irsim:irsimDoc,mock:mockDoc});
const walk=(d,rel='')=>readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).flatMap(e=>e.isDirectory()?walk(join(d,e.name),`${rel}${e.name}/`):e.isFile()&&`${rel}${e.name}`!=='qualification.json'?[{file:`${rel}${e.name}`,sha256:sha(readFileSync(join(d,e.name))),bytes:statSync(join(d,e.name)).size}]:[]);
const recordDoc={schemaVersion:1,documentType:'sim-extension-qualification',release:'r1',candidateId,accepted:false,acceptedBy:null,acceptedAt:null,
 note:'evidence input for review; implemented/tested/accepted are independent and no gate status is changed by this record; MuJoCo, Linux and hardware gates are outside its scope',
 identity:{before,after,identityStable},lab:labBefore?{commit:labBefore.commit,dirty:labAfter.dirty,pin:labBefore.pin}:null,campaign,algorithm,irsimRecord,mockRegression,suites,commands,performance:existsSync(join(out,'performance.json'))?'performance.json':null,
 cases:q.cases,gates:q.gates,notRun:[...q.notRun,...notRun],interrupted:signalled||undefined,artifacts:walk(out)};
await writeFile(join(out,'qualification.json'),JSON.stringify(recordDoc,null,1)+'\n',{flag:'wx'});
const problems=checkQualification(recordDoc,(p)=>{const f=join(out,p);return existsSync(f)?readFileSync(f):null;});
console.log(JSON.stringify({candidateId,cases:Object.fromEntries(Object.entries(q.cases).map(([k,v])=>[k,v.status])),gates:Object.fromEntries(Object.entries(q.gates).map(([k,v])=>[k,v.status])),notRun:recordDoc.notRun,problems}));
if(signalled)process.exit(signalled);
if(!identityStable){console.error('NOT_RUN: the source commit, the Lab, a tool closure, a lock or the Webots executable changed, or a tree became dirty, while recording');process.exit(2);}
if(!summary||campaignCmd.exitCode===2)process.exit(2);
process.exit(problems.filter(p=>!/^CASE_STATUS_MISMATCH|^GATE_STATUS_MISMATCH/.test(p)).length||Object.values(q.cases).some(c=>c.status==='failed')||suites.some(s=>s.exitCode!==0)||commands.some(c=>c.exitCode!==0)?1:0);
