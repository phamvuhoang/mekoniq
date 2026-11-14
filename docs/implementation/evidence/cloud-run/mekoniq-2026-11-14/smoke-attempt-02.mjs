// HTTP portion of CL01. Key arrives only on stdin. Never writes tokens or headers.
// CLOUD_RUN_URL, EXPECTED_COMMIT, EXPECTED_SCHEMA, SOURCE_ROOT, MOCK_PROJECT, SMOKE_OUT.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const service=new URL(process.env.CLOUD_RUN_URL),out=process.env.SMOKE_OUT;
assert(service.protocol==='https:'&&service.hostname.endsWith('.run.app')||service.protocol==='http:'&&service.hostname==='127.0.0.1');
assert(!service.username&&!service.password&&service.pathname==='/'&&!service.search&&!service.hash);
assert(out&&process.env.EXPECTED_COMMIT&&process.env.EXPECTED_SCHEMA&&process.env.SOURCE_ROOT&&process.env.MOCK_PROJECT);
const origin='https://mekoniq-lab.vercel.app',base=service.origin+'/lab/v2';
const key=readFileSync(0,'utf8').trim();assert(key.length>=32,'access key required on stdin');
await mkdir(out);
let token='';const streams=[];
const summary={schema:'mekoniq-cloud-run-http-smoke/1',accepted:false,startedAt:new Date().toISOString(),service:service.origin,origin,expectedCommit:process.env.EXPECTED_COMMIT,cases:{},browser:'not_run'};
const scrub=value=>JSON.stringify(value,(_k,v)=>/^(csrfToken|sessionToken|reclaimToken)$/.test(_k)?'<redacted>':v,2).replaceAll(key,'<redacted>').replaceAll(token||'\u0000','<redacted>')+'\n';
const save=(name,value)=>writeFile(join(out,name),scrub(value));
const api=async(path,{method='GET',body,auth=true}={})=>{
 const r=await fetch(base+path,{method,headers:{Origin:origin,...body===undefined?{}:{'Content-Type':'application/json'},...auth&&token?{Authorization:`Bearer ${token}`}:{ }},...body===undefined?{}:{body:JSON.stringify(body)},signal:AbortSignal.timeout(120000)});
 const data=await r.json();return {status:r.status,data};
};
const expectApi=async(path,options,status)=>{const r=await api(path,options);assert.equal(r.status,status,`${path}: HTTP ${r.status} ${r.data.code??r.data.error??''}`);return r.data;};
const openRun=async(project,scenarioId,backendSetId,mode,health)=>{
 let view=await expectApi('/runs',{method:'POST',body:{project,scenarioId,scenarioRevision:1,seed:42,mode,access:'simulated',backendSetId,runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}},201);
 const path=`/runs/${view.run.id}`;
 const act=async(kind,payload={})=>view=await expectApi(path+'/actions',{method:'POST',body:{actionId:randomUUID(),expectedRevision:view.run.runRevision,kind,payload}},200);
 return {path,act,view:()=>view};
};
async function sse(path,after,header=false){
 const ctl=new AbortController();streams.push(ctl);
 const r=await fetch(base+path+'/events'+(header?'':`?after=${after}`),{headers:{Origin:origin,Authorization:`Bearer ${token}`,...header?{'Last-Event-ID':String(after)}:{}},signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(120000)])});
 assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/event-stream/);
 const messages=[];let failure;
 const finished=(async()=>{let buf='';const decoder=new TextDecoder();try{for await(const chunk of r.body){buf+=decoder.decode(chunk,{stream:true}).replaceAll('\r\n','\n');let end;while((end=buf.indexOf('\n\n'))>=0){const lines=buf.slice(0,end).split('\n');buf=buf.slice(end+2);const m={event:'message'};let data='';for(const line of lines){const at=line.indexOf(':');if(at<1)continue;const name=line.slice(0,at),value=line.slice(at+1).replace(/^ /,'');if(name==='data')data+=value+'\n';else if(name==='id'||name==='event')m[name]=value;}if(data){m.data=JSON.parse(data);messages.push(m);}}}}catch(e){if(!ctl.signal.aborted)failure=e;}})();
 return {messages,until:async(cursor)=>{const limit=Date.now()+30000;while(!messages.some(m=>m.event==='business'&&m.id===String(cursor))){if(failure)throw failure;if(Date.now()>limit)throw new Error('SSE_CURSOR_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,50));}},close:async()=>{ctl.abort();await finished;}};
}
try{
 const health=await expectApi('/health',{auth:false},200);await save('health.json',health);
 assert.equal(health.sourceCommit,process.env.EXPECTED_COMMIT);assert.equal(health.schemaHash,process.env.EXPECTED_SCHEMA);assert.equal(health.features.bearer,true);assert.equal(health.deployment.bind,'public');
 assert(health.backends.some(b=>b.id==='mujoco_arm'&&b.installed&&b.reachable));summary.cases.health='tested';
 assert.equal((await api('/sessions',{method:'POST',auth:false,body:{token:randomUUID()+randomUUID()}})).status,401);
 const paired=await expectApi('/sessions',{method:'POST',auth:false,body:{token:key}},201);token=paired.sessionToken;assert.equal(typeof token,'string');summary.cases.pairing='tested';
 const project=JSON.parse(await readFile(process.env.MOCK_PROJECT,'utf8'));
 const mock=await openRun(project,'FD01','mock-amr','mock',health),first=await sse(mock.path,mock.view().run.eventCursor??0);
 await mock.act('start');let view=await mock.act('step',{ticks:400});await first.until(view.run.eventCursor);
 const seen=String(view.run.eventCursor);await first.close();view=await mock.act('step',{ticks:400});
 assert(BigInt(view.run.eventCursor)>BigInt(seen));const second=await sse(mock.path,seen,true);await second.until(view.run.eventCursor);await second.close();
 const ids=second.messages.filter(m=>m.event==='business').map(m=>m.id);
 assert.equal(ids[0],String(BigInt(seen)+1n));assert.equal(new Set(ids).size,ids.length);assert(!second.messages.some(m=>m.event==='reset'));
 for(let i=1;i<ids.length;i++)assert.equal(BigInt(ids[i]),BigInt(ids[i-1])+1n);
 await save('stream-reconnect.json',{after:seen,through:String(view.run.eventCursor),first:first.messages,resumed:second.messages});summary.cases.streamReconnect='tested';
 for(let count=0;view.run.status==='running'&&count<80;count++)view=await mock.act('step',{ticks:500});
 const mockReport=await expectApi(mock.path+'/report',{},200);await save('mock-report.json',mockReport);assert.equal(mockReport.outcome.status,'completed');summary.cases.mock='tested';
 const armProject=JSON.parse(await readFile(join(process.env.SOURCE_ROOT,'robotics/simulation-mujoco/fixtures/xarm6-g2-v1/coffee-cell-project.json'),'utf8'));
 const arm=await openRun(armProject,'MJ-BV01','engineering-mujoco-arm-v1','simulation',health);view=await arm.act('start');const t0=performance.now();
 while(view.run.status==='running'){assert(view.tick<=6000,'STEP_LIMIT');view=await arm.act('step',{ticks:50});}
 summary.mujoco={tick:view.tick,status:view.run.status,wallMs:Math.round(performance.now()-t0)};
 const report=await expectApi(arm.path+'/report',{},200);await save('mujoco-report.json',report);
 assert.equal(report.outcome.status,'completed');assert.equal(report.outcome.served,'2');assert.equal(report.arm.armPlant.calibration,'not_calibrated');summary.cases.mujoco='tested';
 summary.status='tested';
}catch(e){summary.status='failed';summary.error=String(e);process.exitCode=1;}
finally{for(const ctl of streams)ctl.abort();summary.finishedAt=new Date().toISOString();await save('summary.json',summary);console.log(scrub({status:summary.status,cases:summary.cases,mujoco:summary.mujoco,error:summary.error}));}
