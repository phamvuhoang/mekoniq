import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {runOwnedProcess} from '../../../../scripts/native-sim/owned-process.mjs';
const source=process.cwd(),lab=resolve(source,'../lab'),out=resolve(process.argv[2]);await mkdir(out);
const require=createRequire(join(lab,'package.json')),{preview}=await import(pathToFileURL(require.resolve('vite')).href),{productionBuildIdentity}=await import(pathToFileURL(join(lab,'scripts/production-build-identity.ts')).href),lock=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8'));
const before=await productionBuildIdentity(lab,source,lock),invocationId=randomUUID(),startedAtEpochMs=Date.now();await writeFile(join(out,'browser-invocation.json'),JSON.stringify({version:2,invocationId,before,startedAtEpochMs},null,2));
let web,receipt;const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM','SIGALRM'])process.once(signal,()=>controller.abort());
try{
 web=await preview({root:lab,configFile:join(lab,'vite.config.ts'),logLevel:'error',preview:{host:'127.0.0.1',port:4175,strictPort:true}});
 receipt=await runOwnedProcess('pnpm',['exec','playwright','test','--config','playwright.b07b.config.ts','replay-offline.spec.ts','payload-story.spec.ts','--output',join(out,'playwright')],{out,cwd:lab,env:{...process.env,LAB_BROWSER_INVOCATION:invocationId,LAB_B07B_EVIDENCE:out,LAB_PW_JSON:join(out,'result.json')},timeoutMs:480000,signal:controller.signal});
 const after=await productionBuildIdentity(lab,source,lock),result=await readFile(join(out,'result.json'));await writeFile(join(out,'browser-runtime-identity.json'),JSON.stringify({version:2,invocationId,startedAtEpochMs,finishedAtEpochMs:Date.now(),before,after,receipt,resultSha256:createHash('sha256').update(result).digest('hex'),scope:'Complete strict replay and historical genuine payload/world stories through existing B07 external production entrypoint; locale/viewport/keyboard/reduced-motion/2D/axe and offline denial only; no new runtime/physics/performance execution'},null,2));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('CALLER_PRODUCTION_BUILD_CHANGED');console.log(JSON.stringify({receipt,stats:JSON.parse(result).stats,invocationId}));process.exitCode=receipt.exitCode??1;
}finally{
 if(web){if('closeAllConnections' in web.httpServer)web.httpServer.closeAllConnections();await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('OWNED_PREVIEW_CLOSE_TIMEOUT')),5000);web.httpServer.close(error=>{clearTimeout(timer);if(error)reject(error);else done();});});await writeFile(join(out,'preview-cleanup.json'),JSON.stringify({port:4175,listening:web.httpServer.listening,closedAt:new Date().toISOString(),ownership:'exact server created by this invocation',otherResourcesStopped:false},null,2));}
}
