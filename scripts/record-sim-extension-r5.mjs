// Recorder for release `r5` (R5.0–R5.5, contracts §9). Refuses an existing output, a dirty source or Lab tree, a Lab pin that is not this commit, and any bytecode under the portable roots.
// It copies every input beside the record (the R4 record of the same tuple, the stop-v1 campaign, the container record, the Lab mock regression), builds the hardware candidate package itself,
// runs the closed suites, then reads the whole directory back through scripts/r5-readback.mjs. qualification.json is always `accepted:false`; G-BENCH1 and G-SAFE1 are recorded blocked_external.
import {mkdir,writeFile,readFile,cp,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tableR5,qualifyR5Structure,validateR5Selectors,EXTERNAL_GATES_R5} from './sim-extension-r5.mjs';
import {assessR5Directory,collectR5ArtifactDispositions,verifyR5Directory} from './r5-readback.mjs';
import {evidenceInventory,boundedEvidenceRead} from './r2b-readback.mjs';
import {summarizeResult} from './irsim-qualification.mjs';
import {closureIdentity} from './lab-irsim.mjs';
import {runR2bCaseCommand} from './native-sim/r2b-process.mjs';
import {sourceCommit as srcCommit,sourceDirty as srcDirty,labIdentity} from './repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const INPUTS={'r4-record':['r4Record','inputs/r4','qualification.json'],'stop-campaign':['stopCampaign','inputs/stop','campaign.json'],'container-record':['containerRecord','inputs/container','container.json'],'mock-regression':['mockRegression','inputs/mock','manifest.json']};
export async function recordR5(args){
 const o={};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--plan'){o.plan=true;continue;}if(!['--out','--candidate-id','--lab',...Object.keys(INPUTS).map(x=>'--'+x)].includes(k)||!args[i+1]||args[i+1].startsWith('--'))throw Error('INVALID_OPTION:'+k);o[k.slice(2)]=args[++i];}
 const table=tableR5();if(o.plan){console.log(JSON.stringify({release:'r5',suites:table.suites.map(s=>s.id),gates:table.gates,externalGates:EXTERNAL_GATES_R5,inputs:Object.keys(INPUTS),note:'A missing input leaves its cases not_run; VIO, DGN02, DGN04, CLD05 and CLD06 are not_run by the table; G-BENCH1 and G-SAFE1 are blocked_external'},null,2));return 0;}
 for(const key of ['out',...Object.keys(INPUTS)])if(!o[key])throw Error('MISSING_OPTION:--'+key);
 const out=resolve(o.out),lab=resolve(o.lab??join(root,'apps/lab'));if(existsSync(out))throw Error('OUT_EXISTS');if(out===root||out.startsWith(root+'/')||out===lab||out.startsWith(lab+'/'))throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
 validateR5Selectors(table,{source:root,lab});
 const identity=()=>({sourceCommit:srcCommit(root),dirty:!!srcDirty(root),toolClosures:closureIdentity(),node:process.version}),before=identity();if(before.dirty)throw Error('SOURCE_DIRTY');
 const pin=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8')),{commit:labCommit,dirty:labWasDirty}=labIdentity(root,lab);if(labWasDirty)throw Error('LAB_DIRTY');if(pin.sourceCommit!==before.sourceCommit||pin.portableToolsDigest!==before.toolClosures.portable)throw Error('LAB_PIN_MISMATCH');
 await mkdir(out,{mode:0o700});await mkdir(join(out,'inputs'));await mkdir(join(out,'suites'));const refs={};
 for(const [opt,[key,dest,entry]] of Object.entries(INPUTS)){const source=resolve(o[opt]);if((await lstat(source)).isSymbolicLink())throw Error('EVIDENCE_SYMLINK');
  const original=evidenceInventory(source);await cp(source,join(out,dest),{recursive:true,force:false,errorOnExist:true});
  if(JSON.stringify(evidenceInventory(join(out,dest)))!==JSON.stringify(original))throw Error('INPUT_CHANGED:'+key);const file=dest+'/'+entry;refs[key]={file,sha256:sha(boundedEvidenceRead(out,file))};}
 // the hardware candidate package of HW-C, built by the product's own command (HW-A compiles to blocked and has none)
 {const p=spawnSync(process.execPath,[join(root,'scripts/lab-hardware.mjs'),'package','--design',join(root,'robotics/catalog/electrical/serve-hw-c-v1.json'),'--out',join(out,'inputs/package')],{encoding:'utf8',timeout:180000});
  if(p.status!==0)throw Error('PACKAGE_FAILED:'+(p.stderr||p.stdout).slice(0,300));refs.hardwarePackage={file:'inputs/package/manifest.json',sha256:sha(boundedEvidenceRead(out,'inputs/package/manifest.json'))};}
 const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.once(s,()=>abort.abort());const suites=[],commands=[];
 const env={...process.env,LAB_V2_CLEAN_EXPORT:'1',PYTHONDONTWRITEBYTECODE:'1',PYTEST_ADDOPTS:'-p no:cacheprovider',NO_COLOR:'1'};delete env.FORCE_COLOR;
 for(const suite of table.suites){const directory=join(out,'suites',suite.id);await mkdir(directory);const cwd=suite.repo==='lab'?lab:root,resultFile=`suites/${suite.id}/result.json`,abs=join(out,resultFile);
  const shots=join(directory,'screens');if(suite.kind==='playwright')await mkdir(shots);
  const cmd=suite.kind==='vitest'?[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...suite.files,'--reporter=default','--reporter=json','--outputFile='+abs]:suite.command;
  const suiteEnv={...env,...suite.kind==='playwright'?{LAB_PW_JSON:abs,LAB_IRSIM_SCREENSHOTS:shots,LAB_EVIDENCE_DIR:shots,PLAYWRIGHT_JSON_OUTPUT_NAME:abs}:{}};
  if(suite.kind==='playwright'){delete suiteEnv.NO_COLOR;suiteEnv.FORCE_COLOR='1';}
  const p=await runR2bCaseCommand(process.execPath,cmd,{out:directory,cwd,env:suiteEnv,timeoutMs:6100000,signal:abort.signal});let result=null;
  // the Lab launcher names a spec's result <name>-<spec>.json; a suite here runs exactly one spec
  const spec=(suite.command??[]).find(a=>a.endsWith('.spec.ts')),perSpec=spec&&abs.replace(/\.json$/,`-${spec.replace(/\.spec\.ts$/,'')}.json`);if(perSpec&&!existsSync(abs)&&existsSync(perSpec))await cp(perSpec,abs);
  try{const b=await readFile(abs);result={file:resultFile,sha256:sha(b),summary:summarizeResult(suite.kind,b.toString())};}catch{/* an explicit missing result stays not_run */}
  suites.push({id:suite.id,repo:suite.repo,kind:suite.kind,exitCode:p.exitCode??1,process:`suites/${suite.id}/process.json`,result});
 }
 const licenses=join(out,'suites/licenses');await mkdir(licenses);const l=await runR2bCaseCommand(process.execPath,['scripts/portable-licenses.mjs','--check'],{out:licenses,cwd:root,env,timeoutMs:120000,signal:abort.signal});commands.push({id:'licenses',exitCode:l.exitCode??1,process:'suites/licenses/process.json'});
 const after=identity(),identityStable=JSON.stringify(before)===JSON.stringify(after)&&labIdentity(root,lab).commit===labCommit&&!labIdentity(root,lab).dirty;
 const m={schemaVersion:1,documentType:'sim-extension-qualification',release:'r5',scope:'full',candidateId:o['candidate-id']??out.split('/').at(-1),accepted:false,acceptedBy:null,acceptedAt:null,identity:{before,after,identityStable},
  lab:{commit:labCommit,dirty:!identityStable,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}},campaign:null,performance:null,inputs:refs,suites,commands,
  externalGates:Object.fromEntries(Object.entries(EXTERNAL_GATES_R5).map(([g,needs])=>[g,{status:'blocked_external',accepted:false,needs}]))};
 const derived=await collectR5ArtifactDispositions(out,m);m.artifactDispositions=derived.artifactDispositions;Object.assign(m,qualifyR5Structure({suites,lab:true,sourceCommit:before.sourceCommit,artifactDispositions:m.artifactDispositions}));m.artifacts=evidenceInventory(out);
 await writeFile(join(out,'qualification.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});
 const problems=await verifyR5Directory(out);console.log(JSON.stringify({accepted:false,candidateId:m.candidateId,problems,gates:Object.fromEntries(Object.entries(m.gates).map(([g,x])=>[g,x.status])),notRun:m.notRun}));return problems.length?1:0;
}
export {assessR5Directory};
if(process.argv[1]===fileURLToPath(import.meta.url))recordR5(process.argv.slice(2)).then(c=>{process.exitCode=c;},e=>{console.error(e.message);process.exitCode=2;});
