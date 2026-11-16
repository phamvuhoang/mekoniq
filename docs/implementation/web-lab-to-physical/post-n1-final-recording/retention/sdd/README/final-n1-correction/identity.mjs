import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {closureIdentity} from '../../../../scripts/lab-irsim.mjs';
import {productionBuildIdentity} from '../../../../../lab/scripts/production-build-identity.ts';
const source=process.cwd(),lab=resolve(source,'../lab'),sha=b=>createHash('sha256').update(b).digest('hex'),git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim(),lock=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8'));
const checkerFiles=['scripts/browser-capture-clock.mjs','scripts/sim-extension-r2b.mjs','scripts/r2b-readback.mjs','scripts/irsim-qualification.mjs'],checker={};for(const p of checkerFiles){const b=await readFile(p);checker[p]={bytes:b.length,sha256:sha(b)};}
const evidence={source:{head:git(source,'rev-parse','HEAD'),tree:git(source,'rev-parse','HEAD^{tree}'),status:git(source,'status','--porcelain')},lab:{head:git(lab,'rev-parse','HEAD'),tree:git(lab,'rev-parse','HEAD^{tree}'),status:git(lab,'status','--porcelain')},lock,closures:closureIdentity(),checker,checkerSetSha256:sha(JSON.stringify(checker)),production:await productionBuildIdentity(lab,source,lock)};
await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,production:{buildSha256:evidence.production.buildSha256,files:evidence.production.files.length}}));
