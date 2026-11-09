#!/usr/bin/env node
// Records one LinkForge + IR-SIM qualification candidate (plan 03 C03) into a fresh directory: the C02 campaign through scripts/lab-irsim.mjs, every verification
// suite of scripts/irsim-qualification.mjs (source vitest/pytest, Lab vitest, the Lab IR-SIM browser journeys with screenshots), the license inventory check and
// the 60 s steady-state measurement, with the source/Lab identity stamped before and after. Writes <out>/qualification.json (linkforge-irsim-qualification/1):
// an evidence INPUT for review — `accepted` is always false; tests/acceptance/linkforge-irsim.acceptance.test.ts refuses anything inconsistent.
//   node scripts/record-irsim.mjs --out DIR [--concurrency 1|2] [--campaign ID] [--irsim-python PATH] [--expect-portable-digest HEX] [--lab DIR|none] [--candidate-id ID] [--skip-suites]
// Refuses an existing --out, a dirty source tree, a Lab whose pin is not this source commit/closure. Exit 0 complete (not_run only where declared), 1 a suite or
// the campaign failed or the record is inconsistent, 2 prerequisite/usage (not_run), 130/143 on a signal.
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {arch,homedir,platform,release,tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {closureIdentity,ownOutput,parse,treeState} from './lab-irsim.mjs';
import {SUITES,bytecodeUnder,checkQualification,qualify} from './irsim-qualification.mjs';
import {PORTABLE_TOOL_PATHS} from './native-sim/tool-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=(code,m)=>{console.error(`${code}: ${m}`);process.exit(code==='NOT_RUN'?2:1);};
// own options first; the rest is exactly lab-irsim's `run` argv (same parser, same refusals)
const raw=process.argv.slice(2),own={lab:undefined,candidateId:undefined,skipSuites:false},rest=[];
for(let i=0;i<raw.length;i++){const a=raw[i];if(a==='--lab'){const v=raw[++i]??'';own.lab=v==='none'?'none':resolve(v);}else if(a==='--candidate-id')own.candidateId=raw[++i];else if(a==='--skip-suites')own.skipSuites=true;else rest.push(a);}
const o=parse('run',['--campaign',rest.includes('--campaign')?rest[rest.indexOf('--campaign')+1]:'c02-qualification',...rest.filter((a,i)=>a!=='--campaign'&&rest[i-1]!=='--campaign')]);
if(!o.out)fail('NOT_RUN','MISSING_OPTION:--out');
if(existsSync(o.out))fail('NOT_RUN',`OUT_EXISTS: ${o.out} (a record is written once, into a new directory)`);
const candidateId=own.candidateId??o.out.replace(/\/+$/,'').split('/').pop();
// the record's own files (when --out lies inside the repository, as docs/implementation/evidence does) are not what makes the tree dirty
const ownPaths=ownOutput(o.out),sha=(b)=>createHash('sha256').update(b).digest('hex');
const identity=()=>{const tree=treeState(root,ownPaths),lock=join(root,'robotics/navigation-2d/requirements.lock');
 return {sourceCommit:tree.head,dirty:tree.dirty,dirtyReasons:tree.reasons.slice(0,50),toolClosures:closureIdentity(),node:process.version,os:`${platform()} ${release()}`,arch:arch(),lockSha256:existsSync(lock)?sha(readFileSync(lock)):null,at:new Date().toISOString()};};
const before=identity();
if(before.dirty)fail('NOT_RUN',`SOURCE_DIRTY: commit the source before recording evidence (${before.dirtyReasons.slice(0,5).join('; ')})`);
// the Lab checkout (default ../lab when present): its pin must be exactly this source commit and portable closure, or the browser evidence would be of another candidate
// --lab none records without the Lab (INT01/INT04 not_run); otherwise ../lab when present, or the given checkout
const labDir=own.lab==='none'?null:own.lab??(existsSync(join(root,'../lab/config/source-runtime.lock.json'))?resolve(root,'../lab'):null);
if(own.lab&&own.lab!=='none'&&!existsSync(join(own.lab,'config/source-runtime.lock.json')))fail('NOT_RUN',`LAB_NOT_FOUND: ${own.lab}`);
const labInfo=()=>{if(!labDir)return null;const git=(...a)=>spawnSync('git',a,{cwd:labDir,encoding:'utf8'}).stdout.trim(),pin=JSON.parse(readFileSync(join(labDir,'config/source-runtime.lock.json'),'utf8'));
 return {path:labDir,commit:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=all').length>0,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}};};
const labBefore=labInfo();
if(labBefore){
 const bytecode=bytecodeUnder(root,PORTABLE_TOOL_PATHS);if(bytecode.length)fail('NOT_RUN',`PORTABLE_BYTECODE: ${bytecode.slice(0,5).join(', ')}${bytecode.length>5?` (+${bytecode.length-5})`:''} — the Lab launcher refuses a closure with bytecode; remove it yourself (find <root> -name __pycache__ -prune -exec rm -rf {} +)`);
 if(labBefore.dirty)fail('NOT_RUN','LAB_DIRTY: commit the Lab before recording evidence');
 if(labBefore.pin.sourceCommit!==before.sourceCommit)fail('NOT_RUN',`LAB_PIN_MISMATCH: the Lab pins ${labBefore.pin.sourceCommit}, this source is ${before.sourceCommit} (export, import and pin first)`);
 if(labBefore.pin.portableToolsDigest!==before.toolClosures.portable)fail('NOT_RUN',`LAB_PORTABLE_DIGEST_MISMATCH: Lab ${labBefore.pin.portableToolsDigest}, tree ${before.toolClosures.portable}`);
}
await mkdir(join(o.out,'suites'),{recursive:true,mode:0o700});await mkdir(join(o.out,'screens'),{recursive:true});
const scrub=(t)=>t.replaceAll(resolve(root,'..'),'<workspace>').replaceAll(homedir(),'<home>').replaceAll(tmpdir(),'<tmp>');
const commands=[],suites=[],notRun=[];
let signalled=0;const children=new Set();
for(const [sig,code] of [['SIGINT',130],['SIGTERM',143]])process.on(sig,()=>{signalled||=code;for(const c of children)c.kill(sig);});
/** One recorded command: stdout+stderr to <out>/suites/<id>.log (scrubbed), exit code and times kept. */
async function record(id,cmd,args,{cwd=root,env={},timeoutMs=3_600_000}={}){
 const startedAt=new Date().toISOString(),log=`suites/${id}.log`;
 const code=await new Promise((done)=>{const c=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.add(c);let text='';
  c.stdout.on('data',d=>{text+=d;});c.stderr.on('data',d=>{text+=d;});const t=setTimeout(()=>c.kill('SIGKILL'),timeoutMs);
  c.once('close',(status,sig)=>{clearTimeout(t);children.delete(c);writeFile(join(o.out,log),scrub(text)).then(()=>done(status??(sig==='SIGINT'?130:sig==='SIGTERM'?143:1)));});});
 const entry={id,command:scrub(`${Object.entries(env).map(([k,v])=>`${k}=${v}`).join(' ')} ${cmd} ${args.join(' ')}`.trim()),cwd:cwd===root?'source':relative(root,cwd),startedAt,finishedAt:new Date().toISOString(),exitCode:code,log,logSha256:sha(readFileSync(join(o.out,log)))};
 console.log(`${id}: exit ${code}`);return entry;
}
const junit=(t)=>{const n=(k)=>Number(new RegExp(`\\b${k}="(\\d+)"`).exec(t)?.[1]??0);return {passed:n('tests')-n('failures')-n('errors')-n('skipped'),failed:n('failures')+n('errors'),skipped:n('skipped'),total:n('tests')};};
const summarize=(kind,text)=>{if(kind==='pytest')return junit(text);const j=JSON.parse(text);
 return kind==='vitest'?{passed:j.numPassedTests,failed:j.numFailedTests,skipped:j.numPendingTests+(j.numTodoTests??0),total:j.numTotalTests}:{passed:j.stats.expected,failed:j.stats.unexpected,skipped:j.stats.skipped,total:j.stats.expected+j.stats.unexpected+j.stats.skipped};};
const result=(id,file,kind)=>{const p=join(o.out,file);if(!existsSync(p))return undefined;const text=scrub(readFileSync(p,'utf8'));writeFileSync(p,text);return {file,sha256:sha(text),summary:summarize(kind,text)};};
const pycache=join(tmpdir(),`mekoniq-pycache-${process.pid}`);await mkdir(pycache,{recursive:true,mode:0o700});

// ---- 1. the campaign (its own process, signal handling and worker groups), pinned to the closure stamped above ----
const campaignArgs=['scripts/lab-irsim.mjs','run','--campaign',o.campaign,'--out',join(o.out,'campaign'),'--concurrency',String(o.concurrency??1),'--expect-portable-digest',o['expect-portable-digest']??before.toolClosures.portable,...o['irsim-python']?['--irsim-python',o['irsim-python']]:[]];
const campaignCmd=await record('campaign',process.execPath,campaignArgs);
let summary=null;try{summary=JSON.parse(await readFile(join(o.out,'campaign','summary.json'),'utf8'));}catch{summary=null;}
const campaign={command:campaignCmd.command,exitCode:campaignCmd.exitCode,log:campaignCmd.log,summary:summary?{path:'campaign/summary.json',sha256:sha(readFileSync(join(o.out,'campaign','summary.json'))),status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider}:null};
if(!summary)notRun.push({id:'campaign',reason:`no summary written (exit ${campaignCmd.exitCode})`});

// ---- 2. the verification suites (each named by the cases it tests in irsim-qualification.mjs) ----
if(!own.skipSuites&&!signalled)for(const s of SUITES){
 if(signalled)break;
 if(s.repo==='lab'&&!labDir){notRun.push({id:`suite:${s.id}`,reason:'no Lab checkout (--lab)'});continue;}
 const cwd=s.repo==='lab'?labDir:root,file=`suites/${s.id}.${s.kind==='pytest'?'xml':'json'}`,abs=join(o.out,file);
 let entry;
 if(s.kind==='vitest')entry=await record(s.id,process.execPath,[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...s.files,'--reporter=json',`--outputFile=${abs}`],{cwd,env:{LAB_V2_CLEAN_EXPORT:'1'}});
 else if(s.kind==='pytest')entry=await record(s.id,join(root,s.python),['-m','pytest',...s.files,'-q',`--junitxml=${abs}`],{cwd,env:{PYTHONPATH:(s.pythonPath??[]).map(p=>join(root,p)).join(':'),PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:pycache,PYTHONNOUSERSITE:'1'}});
 else entry=await record(s.id,process.execPath,s.command.map(a=>a.endsWith('.mjs')?join(cwd,a):a),{cwd,env:{LAB_PW_JSON:abs,LAB_IRSIM_SCREENSHOTS:join(o.out,'screens'),...o['irsim-python']?{}:{}}});
 const res=result(s.id,file,s.kind);
 suites.push({...entry,repo:s.repo,kind:s.kind,...res?{result:res}:{}});
 if(!res)notRun.push({id:`suite:${s.id}`,reason:`no result file (exit ${entry.exitCode})`});
}
// ---- 3. license inventory check and the steady-state measurement (a measurement, never a gate) ----
if(!signalled){
 commands.push(await record('licenses',process.execPath,['scripts/portable-licenses.mjs','--check']));
 const perf=await record('performance',process.execPath,['scripts/measure-irsim.mjs','--out',join(o.out,'performance.json'),...o['irsim-python']?['--irsim-python',o['irsim-python']]:[]],{timeoutMs:900_000});
 commands.push(perf);if(!existsSync(join(o.out,'performance.json')))notRun.push({id:'performance',reason:`measurement not written (exit ${perf.exitCode})`});
}
// ---- 4. identity after, statuses, the record ----
const after=identity(),labAfter=labInfo();
const identityStable=before.sourceCommit===after.sourceCommit&&!after.dirty&&before.toolClosures.portable===after.toolClosures.portable&&before.toolClosures.native===after.toolClosures.native&&(!labBefore||labBefore.commit===labAfter.commit&&!labAfter.dirty);
const q=qualify({campaign:summary&&summary.status==='completed'?summary:null,suites,lab:!!labDir&&suites.some(s=>s.id==='lab-e2e')});
const walk=(d,rel='')=>readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).flatMap(e=>e.isDirectory()?walk(join(d,e.name),`${rel}${e.name}/`):e.isFile()&&`${rel}${e.name}`!=='qualification.json'?[{file:`${rel}${e.name}`,sha256:sha(readFileSync(join(d,e.name))),bytes:statSync(join(d,e.name)).size}]:[]);
const recordDoc={schemaVersion:1,documentType:'linkforge-irsim-qualification',candidateId,accepted:false,acceptedBy:null,acceptedAt:null,
 note:'evidence input for review; implemented/tested/accepted are independent and no gate status is changed by this record; native/hardware gates are outside its scope',
 identity:{before,after,identityStable},lab:labBefore?{commit:labBefore.commit,dirty:labAfter.dirty,pin:labBefore.pin}:null,campaign,suites,commands,performance:existsSync(join(o.out,'performance.json'))?'performance.json':null,
 cases:q.cases,gates:q.gates,notRun:[...q.notRun,...notRun],interrupted:signalled||undefined,artifacts:walk(o.out)};
await writeFile(join(o.out,'qualification.json'),JSON.stringify(recordDoc,null,1)+'\n',{flag:'wx'});
const problems=checkQualification(recordDoc,(p)=>{const f=join(o.out,p);return existsSync(f)?readFileSync(f):null;});
console.log(JSON.stringify({candidateId,cases:Object.fromEntries(Object.entries(q.cases).map(([k,v])=>[k,v.status])),gates:Object.fromEntries(Object.entries(q.gates).map(([k,v])=>[k,v.status])),notRun:recordDoc.notRun,problems}));
if(signalled)process.exit(signalled);
if(!identityStable){console.error('NOT_RUN: the source commit, the Lab, or a tool closure changed, or a tree became dirty, while recording');process.exit(2);}
if(!summary||campaignCmd.exitCode===2)process.exit(2);
process.exit(problems.filter(p=>!/^CASE_STATUS_MISMATCH|^GATE_STATUS_MISMATCH/.test(p)).length||Object.values(q.cases).some(c=>c.status==='failed')||suites.some(s=>s.exitCode!==0)||commands.some(c=>c.exitCode!==0)?1:0);
