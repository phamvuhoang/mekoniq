/* eslint-disable @typescript-eslint/no-explicit-any -- raw synthetic command/HTTP observations */
/* Synthetic artifact reader fixture; no container or native execution. */
import {createHash} from 'node:crypto';
export const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export const CHUNK_PROGRAM="const fs=require('fs'),path=require('path'),crypto=require('crypto');const root='/data/runs',id=process.argv[1];const dir=fs.readdirSync(root).find(n=>{try{return JSON.parse(fs.readFileSync(path.join(root,n,'reclaim.json'))).runId===id}catch{return false}});const evidence=path.join(root,dir,'world-evidence');console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(evidence).filter(n=>n.endsWith('.ndjson.gz')).map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(evidence,n))).digest('hex')]))))";
export const WORKER_PROGRAM="const fs=require('fs');console.log(fs.readdirSync('/proc').filter(n=>/^\\d+$/.test(n)).filter(n=>{try{return fs.readFileSync('/proc/'+n+'/cmdline','utf8').split('\\0').includes('mujoco_worker')}catch{return false}}).length)";
export function web05Fixture(){
 const source='a'.repeat(40),schema='b'.repeat(64),image='sha256:'+'c'.repeat(64),active='active-run',finished='finished-run',invocationId='web05-invocation';
 const files:Record<string,unknown>={},observations:any[]=[],refs:Record<string,string>={};
 const put=(p:string,v:unknown)=>files[p]=v;
 const command=(key:string,args:string[],out='',exitCode=0)=>{refs[key]=key;observations.push({id:key,sequence:observations.length,kind:'command',startedAtEpochMs:1000+observations.length*10,finishedAtEpochMs:1005+observations.length*10,command:'docker',args,exitCode,signal:null,stdout:out,stderr:''});};
 const http=(key:string,path:string,response:unknown,request?:unknown,status=200)=>{refs[key]=key;observations.push({id:key,sequence:observations.length,kind:'http',startedAtEpochMs:1000+observations.length*10,finishedAtEpochMs:1005+observations.length*10,method:request===undefined?'GET':'POST',path,status,request,response});};
 const inspect={Id:image,Os:'linux',Architecture:'amd64',Config:{Labels:{'org.opencontainers.image.revision':source}}},health={sourceCommit:source,schemaHash:schema};
 put('health.json',health);put('image-inspect.json',inspect);command('image',['image','inspect',image],JSON.stringify([inspect]));command('container',['inspect','main'],JSON.stringify([{Name:'/main',Image:image,Mounts:[{Type:'volume',Name:'volume',Destination:'/data/runs',RW:true}]}]));http('health','/health',health);
 const report=(id:string,tick:number,status:string)=>({schemaVersion:2,schemaHash:schema,manifest:{runId:id,sourceCommit:source},outcome:{tick,status,served:status==='completed'?'2':'0'},businessEvents:[]});
 const finishedReport={...report(finished,2,'completed'),worldSweep:{scope:{identity:{runId:finished,bootId:'boot',sceneDigest:'d'.repeat(64)},publicCommittedTick:2,prefixCovered:true,streamFinalized:true}}};
 const replayReport=structuredClone(finishedReport);replayReport.outcome.status='needs_attention';finishedReport.worldSweep.scope.streamFinalized=false;
 put('finished-report.json',finishedReport);http('finished',`/runs/${finished}/report`,finishedReport);
 const before=report(active,300,'running'),after=report(active,300,'needs_attention'),chunks={'chunk-00000.ndjson.gz':'e'.repeat(64)};
 put('before-crash-report.json',before);http('before',`/runs/${active}/report`,before);put('committed-before.json',chunks);command('chunksBefore',['exec','main','node','-e',CHUNK_PROGRAM,active],JSON.stringify(chunks));
 command('contenderStart',['run','-d','--name','contender','-v','volume:/data/runs',image],'container-2');command('contenderWait',['wait','contender'],'1');command('contenderLogs',['logs','--tail','20','contender'],'LAB_DATA_DIR_BUSY');
 command('kill',['kill','--signal','KILL','main'],'main');command('restart',['start','main'],'main');http('healthAfter','/health',health);
 http('reclaim',`/runs/${active}/reclaim`,{run:{id:active,status:'needs_attention'},tick:300,controlAccess:'view_reconcile'},{proof:'[redacted]'});
 put('after-crash-report.json',after);http('after',`/runs/${active}/report`,after);put('committed-after.json',chunks);command('chunksAfter',['exec','main','node','-e',CHUNK_PROGRAM,active],JSON.stringify(chunks));
 http('resume',`/runs/${active}/actions`,{error:'RECLAIM_READ_ONLY'},{actionId:'resume-refused',kind:'resume',payload:{}},403);command('workers',['exec','main','node','-e',WORKER_PROGRAM],'0');
 http('finishedReclaim',`/runs/${finished}/reclaim`,{run:{id:finished,status:'needs_attention'},tick:2,controlAccess:'view_reconcile'},{proof:'[redacted]'});put('replay-report.json',replayReport);http('replayReport',`/runs/${finished}/report`,replayReport);
 const replay=(id:string)=>{const r=structuredClone(replayReport);r.manifest.runId=id;r.worldSweep.scope.identity.runId=id;const raw=JSON.stringify(r),scene=JSON.stringify({sceneDigest:'d'.repeat(64),files:[]}),rows=[0,1,2].map(tick=>JSON.stringify({tick,snapshot:{runId:id,bootId:'boot',sceneDigest:'d'.repeat(64),simTimeNs:String(tick*20000000)}})).join('\n')+'\n';
 const assets=[['report.json',raw,'report','application/json'],['scene.json',scene,'scene','application/json'],['world.ndjson',rows,'world','application/x-ndjson']].map(([path,bytes,role,mediaType])=>{put('replay/'+path,Buffer.from(bytes!));return {path,sha256:sha(bytes!),decodedSha256:sha(bytes!),bytes:Buffer.byteLength(bytes!),decodedBytes:Buffer.byteLength(bytes!),role,mediaType,encoding:'identity'};});
 return {schemaVersion:1,documentType:'web-replay-package',runId:id,horizon:{tick:2,tickMs:20},provenance:{kind:'imported_integrity_only',accepted:false,calibration:'not_calibrated',scope:'display_only_not_requalification',reportTransform:'credential_redaction_v1',rawReportSha256:sha(raw)},coverage:{prefixCovered:true,streamFinalized:true,sampled:false,terminal:'completed',gaps:[],issues:[]},assets,streams:[{kind:'world',chunks:['world.ndjson'],firstTick:0,lastTick:2,samples:3}],licensing:[]};};
 const manifest=replay(finished);put('replay/manifest.json',manifest);put('replay-manifest.json',manifest);http('replay',`/runs/${finished}/replay`,{exportId:'export',manifest},{},201);
 const record={version:2,accepted:false,execution:'actual_container',invocationId,sourceCommit:source,schemaHash:schema,activeRunId:active,finishedRunId:finished,containerName:'main',contenderName:'contender',volumeName:'volume',image:{id:image,sourceCommit:source,os:'linux',architecture:'amd64'},observations:refs};
 put('web05.json',record);put('lifecycle-observations.json',{invocationId,observations});
 return {source,schema,files,record,observations,replay,put};
}
