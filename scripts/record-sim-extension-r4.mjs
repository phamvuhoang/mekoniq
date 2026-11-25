// Recorder for release `r4` (plan V16, contracts §10). Refuses an existing output, a dirty source or Lab tree, a Lab pin that is not this commit, and any bytecode under the portable roots (the closure identity covers it).
// It copies every input beside the record, runs the closed suites, then reads the whole directory back through scripts/r4-readback.mjs. qualification.json is always `accepted:false`.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,cp,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tableR4,qualifyR4Structure,validateR4Selectors} from './sim-extension-r4.mjs';
import {assessR4Directory,collectR4ArtifactDispositions,verifyR4Directory} from './r4-readback.mjs';
import {evidenceInventory,boundedEvidenceRead} from './r2b-readback.mjs';
import {summarizeResult} from './irsim-qualification.mjs';
import {closureIdentity} from './lab-irsim.mjs';
import {runR2bCaseCommand} from './native-sim/r2b-process.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const INPUTS={'recovery-campaign':['recoveryCampaign','inputs/recovery','campaign.json'],'r2b-record':['r2bRecord','inputs/r2b','qualification.json'],'cil-campaign':['cilCampaign','inputs/cil','campaign.json'],'fault-campaign':['faultCampaign','inputs/fault','campaign.json'],'tray-campaign':['trayCampaign','inputs/tray','campaign.json'],
 'perception-study':['perceptionStudy','inputs/study','campaign.json'],'bench-record':['benchCampaign','inputs/bench','campaign.json'],'container-record':['containerRecord','inputs/container','container.json'],
 'mock-regression':['mockRegression','inputs/mock','manifest.json'],'calibration-selftest':['calibrationSelftest','inputs/calibration','calibration-selftest.json']};
export async function recordR4(args){
 const o={};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--plan'){o.plan=true;continue;}if(!['--out','--candidate-id','--lab',...Object.keys(INPUTS).map(x=>'--'+x)].includes(k)||!args[i+1]||args[i+1].startsWith('--'))throw Error('INVALID_OPTION:'+k);o[k.slice(2)]=args[++i];}
 const table=tableR4();if(o.plan){console.log(JSON.stringify({release:'r4',suites:table.suites.map(s=>s.id),gates:table.gates,inputs:Object.keys(INPUTS),note:'A missing input leaves its cases not_run; G-CAL1 is outside the closing condition; CLD03 is never recorded here (deploy_order_pending)'},null,2));return 0;}
 for(const key of ['out','r2b-record','cil-campaign','fault-campaign','tray-campaign','perception-study','bench-record','container-record','mock-regression'])if(!o[key])throw Error('MISSING_OPTION:--'+key);
 const out=resolve(o.out),lab=resolve(o.lab??join(root,'apps/lab'));if(existsSync(out))throw Error('OUT_EXISTS');if(out===root||out.startsWith(root+'/')||out===lab||out.startsWith(lab+'/'))throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
 validateR4Selectors(table,{source:root,lab});
 const git=(cwd,...a)=>execFileSync('git',a,{cwd,encoding:'utf8'}).trim(),identity=()=>({sourceCommit:git(root,'rev-parse','HEAD'),dirty:!!git(root,'status','--porcelain','--untracked-files=all'),toolClosures:closureIdentity(),node:process.version}),before=identity();if(before.dirty)throw Error('SOURCE_DIRTY');
 const pin=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8')),labCommit=git(lab,'rev-parse','HEAD');if(git(lab,'status','--porcelain','--untracked-files=all'))throw Error('LAB_DIRTY');if(pin.sourceCommit!==before.sourceCommit||pin.portableToolsDigest!==before.toolClosures.portable)throw Error('LAB_PIN_MISMATCH');
 await mkdir(out,{mode:0o700});await mkdir(join(out,'inputs'));await mkdir(join(out,'suites'));const refs={};
 for(const [opt,[key,dest,entry]] of Object.entries(INPUTS)){if(!o[opt])continue;const source=resolve(o[opt]);if((await lstat(source)).isSymbolicLink())throw Error('EVIDENCE_SYMLINK');
  const original=evidenceInventory(source);await cp(source,join(out,dest),{recursive:true,force:false,errorOnExist:true});
  if(JSON.stringify(evidenceInventory(join(out,dest)))!==JSON.stringify(original))throw Error('INPUT_CHANGED:'+key);const file=dest+'/'+entry;
  // Retaining the headerless directory lets the reader distinguish a supplied corrupt recovery from an omitted input.
  try{refs[key]={file,sha256:sha(boundedEvidenceRead(out,file))};}
  catch(error){if(key!=='recoveryCampaign'||error.code!=='ENOENT')throw error;}}
 // WEB10: the R4 replay samples of the Lab checkout, byte for byte (the catalog and the two package directories; a package that does not exist is simply absent and its case is not_run)
 {const dest=join(out,'inputs/web/replays'),from=join(lab,'public/replays');await mkdir(dest,{recursive:true});await cp(join(from,'catalog.json'),join(dest,'catalog.json'));for(const id of ['drive-fault','belief-recovery'])if(existsSync(join(from,id)))await cp(join(from,id),join(dest,id),{recursive:true});refs.webSamples={file:'inputs/web/replays/catalog.json',sha256:sha(boundedEvidenceRead(out,'inputs/web/replays/catalog.json'))};}
 const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.once(s,()=>abort.abort());const suites=[],commands=[];
 const env={...process.env,LAB_V2_CLEAN_EXPORT:'1',PYTHONDONTWRITEBYTECODE:'1',PYTEST_ADDOPTS:'-p no:cacheprovider',NO_COLOR:'1'};delete env.FORCE_COLOR;
 for(const suite of table.suites){const directory=join(out,'suites',suite.id);await mkdir(directory);const cwd=suite.repo==='lab'?lab:root,resultFile=`suites/${suite.id}/result.json`,abs=join(out,resultFile);
  const shots=join(directory,'screens');if(suite.kind==='playwright')await mkdir(shots);
  const cmd=suite.kind==='vitest'?[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...suite.files,'--reporter=default','--reporter=json','--outputFile='+abs]:suite.command;
  // the two engine suites that also read a recorded campaign are pointed at the copy beside the record (without it their "recorded campaign" test is skipped, which the core counts as not_run)
  const recorded={'rec-campaign-engine':{RECOVERY_RECORDED_DIR:join(out,'inputs/recovery')},'cil-engine':{CIL_RECORDED_DIR:join(out,'inputs/cil')},'tune-engine':{BENCH_RECORDED_DIR:join(out,'inputs/bench')}}[suite.id]??{};
  const suiteEnv={...env,...recorded,...suite.kind==='playwright'?{LAB_PW_JSON:abs,LAB_IRSIM_SCREENSHOTS:shots,LAB_EVIDENCE_DIR:shots,PLAYWRIGHT_JSON_OUTPUT_NAME:abs}:{}};
  if(suite.kind==='playwright'){delete suiteEnv.NO_COLOR;suiteEnv.FORCE_COLOR='1';}
  const p=await runR2bCaseCommand(process.execPath,cmd,{out:directory,cwd,env:suiteEnv,timeoutMs:6100000,signal:abort.signal});let result=null;
  // the Lab launcher names a spec's result <name>-<spec>.json; a suite here runs exactly one spec
  const spec=(suite.command??[]).find(a=>a.endsWith('.spec.ts')),perSpec=spec&&abs.replace(/\.json$/,`-${spec.replace(/\.spec\.ts$/,'')}.json`);if(perSpec&&!existsSync(abs)&&existsSync(perSpec))await cp(perSpec,abs);
  try{const b=await readFile(abs);result={file:resultFile,sha256:sha(b),summary:summarizeResult(suite.kind,b.toString())};}catch{/* an explicit missing result stays not_run */}
  suites.push({id:suite.id,repo:suite.repo,kind:suite.kind,exitCode:p.exitCode??1,process:`suites/${suite.id}/process.json`,result});
 }
 const licenses=join(out,'suites/licenses');await mkdir(licenses);const l=await runR2bCaseCommand(process.execPath,['scripts/portable-licenses.mjs','--check'],{out:licenses,cwd:root,env,timeoutMs:120000,signal:abort.signal});commands.push({id:'licenses',exitCode:l.exitCode??1,process:'suites/licenses/process.json'});
 const after=identity(),identityStable=JSON.stringify(before)===JSON.stringify(after)&&git(lab,'rev-parse','HEAD')===labCommit&&!git(lab,'status','--porcelain','--untracked-files=all');
 const m={schemaVersion:1,documentType:'sim-extension-qualification',release:'r4',scope:'full',candidateId:o['candidate-id']??out.split('/').at(-1),accepted:false,acceptedBy:null,acceptedAt:null,identity:{before,after,identityStable},
  lab:{commit:labCommit,dirty:!identityStable,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}},campaign:null,performance:null,inputs:refs,suites,commands};
 const derived=await collectR4ArtifactDispositions(out,m);m.artifactDispositions=derived.artifactDispositions;Object.assign(m,qualifyR4Structure({suites,lab:true,sourceCommit:before.sourceCommit,artifactDispositions:m.artifactDispositions}));m.artifacts=evidenceInventory(out);
 await writeFile(join(out,'qualification.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});
 const problems=await verifyR4Directory(out);console.log(JSON.stringify({accepted:false,candidateId:m.candidateId,problems,gates:Object.fromEntries(Object.entries(m.gates).map(([g,x])=>[g,x.status])),notRun:m.notRun}));return problems.length?1:0;
}
export {assessR4Directory};
if(process.argv[1]===fileURLToPath(import.meta.url))recordR4(process.argv.slice(2)).then(c=>{process.exitCode=c;},e=>{console.error(e.message);process.exitCode=2;});
