import {mkdir,writeFile,readFile,cp,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tableR2b,qualifyR2bStructure,validateR2bSelectors} from './sim-extension-r2b.mjs';
import {verifyR2bDirectory,assessR2bDirectory,collectR2bArtifactDispositions,evidenceInventory,boundedEvidenceRead} from './r2b-readback.mjs';
import {summarizeResult} from './irsim-qualification.mjs';
import {closureIdentity} from './lab-irsim.mjs';
import {runR2bCaseCommand} from './native-sim/r2b-process.mjs';
import {sourceCommit as srcCommit,sourceDirty as srcDirty,labIdentity} from './repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
export async function recordR2b(args){
 const o={scope:'full'};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--plan'){o.plan=true;continue;}if(!['--release','--scope','--out','--candidate-id','--r2a-record','--physics-campaign','--cell-campaign','--semantic-study','--web-record','--lab','--container-record'].includes(k)||!args[i+1]||args[i+1].startsWith('--'))throw Error('INVALID_OPTION:'+k);o[k.slice(2)]=args[++i];}
 const table=tableR2b(o.scope);if(o.plan){console.log(JSON.stringify({release:'r2b',scope:o.scope,suites:table.suites,gates:table.gates,note:'No prerequisite probes run in R2b plan; WEB06 blocked_external; missing container remains not_run while other local cases execute.'},null,2));return 0;}
 for(const key of ['r2a-record','physics-campaign','out',...o.scope==='full'?['cell-campaign','semantic-study','web-record']:[]])if(!o[key])throw Error('MISSING_OPTION:--'+key);
 const out=resolve(o.out),lab=resolve(o.lab??join(root,'apps/lab'));if(existsSync(out))throw Error('OUT_EXISTS');if(out===root||out.startsWith(root+'/')||out===lab||out.startsWith(lab+'/'))throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
 validateR2bSelectors(table,{source:root,lab});
 const identity=()=>({sourceCommit:srcCommit(root),dirty:!!srcDirty(root),toolClosures:closureIdentity(),node:process.version}),before=identity();if(before.dirty)throw Error('SOURCE_DIRTY');
 const pin=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8')),{commit:labCommit,dirty:labWasDirty}=labIdentity(root,lab);if(labWasDirty)throw Error('LAB_DIRTY');if(pin.sourceCommit!==before.sourceCommit||pin.portableToolsDigest!==before.toolClosures.portable)throw Error('LAB_PIN_MISMATCH');
 await mkdir(out,{mode:0o700});await mkdir(join(out,'inputs'));await mkdir(join(out,'suites'));const refs={};
 const copy=async(key,input,dest,entry)=>{const source=resolve(input);const original=evidenceInventory(source);await cp(source,join(out,dest),{recursive:true,force:false,errorOnExist:true});if(JSON.stringify(evidenceInventory(source))!==JSON.stringify(original)||JSON.stringify(evidenceInventory(join(out,dest)))!==JSON.stringify(original))throw Error('INPUT_CHANGED:'+key);const file=dest+'/'+entry;refs[key]={file,sha256:sha(boundedEvidenceRead(out,file))};};
 await copy('r2aRecord',o['r2a-record'],'inputs/r2a','qualification.json');await copy('physicsCampaign',o['physics-campaign'],'inputs/physics','campaign.json');
 if(o.scope==='full'){await copy('cellCampaign',o['cell-campaign'],'inputs/cell','campaign.json');await copy('webCapture',o['web-record'],'inputs/web','actual-cell-production.json');const input=resolve(o['semantic-study']),st=await lstat(input);if(!st.isFile()||st.isSymbolicLink()||st.size>200*1024*1024)throw Error('SEMANTIC_INPUT_PATH');const b=await readFile(input);await writeFile(join(out,'inputs/semantic-study.json'),b,{flag:'wx'});refs.semanticStudy={file:'inputs/semantic-study.json',sha256:sha(b)};if(o['container-record'])await copy('containerRecord',o['container-record'],'inputs/container','web05.json');}
 const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.once(s,()=>abort.abort());const suites=[],commands=[];
 const env={...process.env,LAB_V2_CLEAN_EXPORT:'1',PYTHONDONTWRITEBYTECODE:'1',PYTEST_ADDOPTS:'-p no:cacheprovider',NO_COLOR:'1'};delete env.FORCE_COLOR;
 for(const suite of table.suites){const directory=join(out,'suites',suite.id);await mkdir(directory);const resultFile=`suites/${suite.id}/result.json`,cwd=suite.repo==='lab'?lab:root;
  // A missing image is recorded locally; it never suppresses unrelated local suites or probes Docker.
  if(suite.id==='web-container'&&!env.LAB_CONTAINER_IMAGE){suites.push({id:suite.id,repo:suite.repo,kind:suite.kind,exitCode:2,reason:'IMAGE_UNBUILT',result:null});continue;}
  const suiteEnv={...env,...suite.id==='web-container'&&!o['container-record']?{LAB_WEB05_EVIDENCE_DIR:join(out,'inputs/container')}:{}};
  const p=await runR2bCaseCommand(process.execPath,[join(cwd,'node_modules/vitest/vitest.mjs'),'run',...suite.files,'--reporter=default','--reporter=json','--outputFile='+join(out,resultFile)],{out:directory,cwd,env:suiteEnv,timeoutMs:6100000,signal:abort.signal});let result=null;try{const b=await readFile(join(out,resultFile));result={file:resultFile,sha256:sha(b),summary:summarizeResult(suite.kind,b.toString())};}catch{/* explicit missing result remains not_run */}suites.push({id:suite.id,repo:suite.repo,kind:suite.kind,exitCode:p.exitCode??1,process:`suites/${suite.id}/process.json`,result});
 }
 const licenses=join(out,'suites/licenses');await mkdir(licenses);const l=await runR2bCaseCommand(process.execPath,['scripts/portable-licenses.mjs','--check'],{out:licenses,cwd:root,env,timeoutMs:120000,signal:abort.signal});commands.push({id:'licenses',exitCode:l.exitCode??1,process:'suites/licenses/process.json'});
 if(o.scope==='full'&&!refs.containerRecord&&existsSync(join(out,'inputs/container/web05.json')))refs.containerRecord={file:'inputs/container/web05.json',sha256:sha(boundedEvidenceRead(out,'inputs/container/web05.json'))};
 const after=identity(),identityStable=JSON.stringify(before)===JSON.stringify(after)&&labIdentity(root,lab).commit===labCommit&&!labIdentity(root,lab).dirty,q=qualifyR2bStructure({scope:o.scope,suites,lab:true,sourceCommit:before.sourceCommit}),m={schemaVersion:1,documentType:'sim-extension-qualification',release:'r2b',scope:o.scope,candidateId:o['candidate-id']??out.split('/').at(-1),accepted:false,acceptedBy:null,acceptedAt:null,identity:{before,after,identityStable},lab:{commit:labCommit,dirty:!identityStable,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}},campaign:null,performance:null,...refs,suites,commands,cases:q.cases,gates:q.gates,notRun:q.notRun,artifacts:evidenceInventory(out)};
 const derived=await collectR2bArtifactDispositions(out,m);m.artifactDispositions=derived.artifactDispositions;Object.assign(m,qualifyR2bStructure({scope:o.scope,suites,lab:true,sourceCommit:before.sourceCommit,artifactDispositions:m.artifactDispositions}));
 const constructionProblems=await assessR2bDirectory(out,m);if(constructionProblems.length){await writeFile(join(out,'construction-problems.json'),JSON.stringify(constructionProblems,null,2)+'\n');m.artifacts=evidenceInventory(out);}
 await writeFile(join(out,'qualification.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});const problems=await verifyR2bDirectory(out);console.log(JSON.stringify({accepted:false,candidateId:m.candidateId,problems,gates:m.gates}));return problems.length?1:0;
}
