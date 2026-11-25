import {mkdir,writeFile,readFile,cp,realpath,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
import {tableR3} from './sim-extension-r3.mjs';
import {collectR3Artifacts,verifyR3Directory} from './r3-readback.mjs';
import {evidenceInventory} from './r2b-readback.mjs';
import {closureIdentity} from './lab-irsim.mjs';
import {checkedCheckerIdentity} from './native-checker-bootstrap.mjs';
import {sourceCommit as srcCommit,sourceDirty as srcDirty,labIdentity} from './repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function recordR3(args){
 const o={};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--plan'){if(o.plan)throw Error('R3_DUPLICATE_OPTION');o.plan=true;continue;}if(!['--release','--handoff','--native-records','--profile','--scope','--out','--lab','--candidate-id'].includes(k)||o[k]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('R3_INVALID_OPTION:'+k);o[k]=args[++i];}
 const table=tableR3(o['--profile'],o['--scope']);if(o.plan){console.log(JSON.stringify({...table,note:'Fixed table only; no host/Docker prerequisites probed. Preparation is not native or physical qualification.'},null,2));return 0;}
 for(const k of ['--handoff','--native-records','--out'])if(!o[k])throw Error('MISSING_OPTION:'+k);
 const out=resolve(o['--out']),lab=await realpath(resolve(o['--lab']??join(root,'apps/lab'))),parent=await realpath(dirname(out));if(existsSync(out))throw Error('OUT_EXISTS');
 for(const repo of [await realpath(root),lab])if(parent===repo||parent.startsWith(repo+'/'))throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
 const checker=await checkedCheckerIdentity(),snapshot=()=>({sourceCommit:srcCommit(root),dirty:!!srcDirty(root),toolClosures:closureIdentity()}),before=snapshot();
 const {commit:labCommit,dirty:labWasDirty}=labIdentity(root,lab),pin=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8'));if(labWasDirty||pin.sourceCommit!==before.sourceCommit||pin.portableToolsDigest!==before.toolClosures.portable)throw Error('LAB_PIN_MISMATCH');
 await mkdir(out,{mode:0o700});await mkdir(join(out,'inputs'));
 for(const [key,dest]of [['--handoff','handoff'],['--native-records','native']]){const input=resolve(o[key]);if(!(await lstat(input)).isDirectory()||(await lstat(input)).isSymbolicLink())throw Error('INPUT_DIRECTORY_REQUIRED');const original=evidenceInventory(input);await cp(input,join(out,'inputs',dest),{recursive:true,force:false,errorOnExist:true});if(!same(evidenceInventory(input),original)||!same(evidenceInventory(join(out,'inputs',dest)),original))throw Error('INPUT_CHANGED');}
 const handoff=JSON.parse(await readFile(join(out,'inputs/handoff/manifest.json'),'utf8')),after=snapshot(),stable=same(before,after)&&labIdentity(root,lab).commit===labCommit&&!labIdentity(root,lab).dirty&&same(checker,await checkedCheckerIdentity());
 const m={schemaVersion:1,documentType:'sim-extension-qualification',release:'r3',profile:o['--profile'],scope:o['--scope'],candidateId:o['--candidate-id']??out.split('/').at(-1),accepted:false,acceptedBy:null,acceptedAt:null,dynamics:'not_calibrated',subject:handoff.subject,checker,identity:{before,after,identityStable:stable},lab:{commit:labCommit,dirty:!stable,pin:{sourceCommit:pin.sourceCommit,artifactSha256:pin.artifactSha256,portableToolsDigest:pin.portableToolsDigest,schemaHash:pin.schemaHash}},campaign:null,performance:null};
 Object.assign(m,await collectR3Artifacts(out,m));m.identity.after=snapshot();m.identity.identityStable=m.identity.identityStable&&same(m.identity.before,m.identity.after)&&labIdentity(root,lab).commit===labCommit&&!labIdentity(root,lab).dirty&&same(checker,await checkedCheckerIdentity());m.lab.dirty=!m.identity.identityStable;m.artifacts=evidenceInventory(out);await writeFile(join(out,'qualification.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});
 const issues=await verifyR3Directory(out);console.log(JSON.stringify({accepted:false,profile:m.profile,scope:m.scope,levels:m.levels,gates:m.gates,blockedNativeCases:m.blockedNativeCases,issues}));return issues.length?1:0;
}
