import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
// @ts-expect-error plain ESM script without types
import {checkCloudRunEvidence} from '../../scripts/cloud-run-qualification.mjs';
type Doc=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const commit='a'.repeat(40),lab='b'.repeat(40),hash='c'.repeat(64),url='https://runtime.example.run.app';
const localGates=['G-MA1','G-MA2','G-RT1','G-RT2','G-UI1','G-INT4','G-REG3'];
function fixture(){
 const base=JSON.stringify({release:'r2a',candidateId:'r2a-candidate-02',accepted:false,identity:{identityStable:true,before:{sourceCommit:commit}},lab:{commit:lab,pin:{sourceCommit:commit,artifactSha256:hash,schemaHash:hash}},gates:Object.fromEntries(localGates.map(id=>[id,{status:'tested',accepted:false}]))});
 const files=new Map<string,string>(),digests:Record<string,string>={};
 const put=(name:string,value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value);files.set(name,text);digests[name]=sha(text);};
 for(const name of 'api-enable.log authorization.json deploy-command.json deploy-dry-run.log deploy.log export-reproducibility.json host-update-command.json host-update.log image-build.log image-push.log local-http-smoke/health.json local-http-smoke/mock-report.json local-http-smoke/mujoco-report.json local-http-smoke/stream-reconnect.json local-http-smoke/summary.json mock-project.json provision-1.log provision-2.log provision-3.log provision-4.log provision.jsonl'.split(' '))put(name,'recorded artifact');
 put('deployment.json',{schema:'mekoniq-cloud-run-deployment/1',accepted:false,qualification:{candidateId:'r2a-candidate-02',sha256:sha(base)},sourceCommit:commit,labCommit:lab,artifactSha256:hash,platform:'linux/amd64',url,revision:'runtime-00002',image:`registry/runtime@sha256:${hash}`,traffic:[{revisionName:'runtime-00002',percent:100}],cl01:'cl01-attempt-01/summary.json',environment:[{name:'LAB_ALLOW_ORIGIN',value:'https://lab.example.com'},{name:'LAB_PUBLIC_HOST',value:new URL(url).hostname},{name:'MEKONIQ_LAB_ACCESS_KEY',valueFrom:{secretKeyRef:{name:'lab-access-key',key:'latest'}}}]});
 put('revision.json',{metadata:{name:'runtime-00002'},status:{imageDigest:`registry/runtime@sha256:${hash}`,conditions:[{type:'Ready',status:'True'}]}});
 put('cl01-attempt-01/summary.json',{schema:'mekoniq-cloud-run-http-smoke/1',accepted:false,status:'tested',expectedCommit:commit,service:url,origin:'https://lab.example.com',cases:{health:'tested',pairing:'tested',streamReconnect:'tested',mock:'tested',mujoco:'tested'},mujoco:{tick:4800,status:'completed',wallMs:69000},cleanup:[{runId:'FD01',archived:true},{runId:'MJ-BV01',archived:true}]});
 put('cl01-attempt-01/health.json',{sourceCommit:commit,schemaHash:hash,features:{bearer:true},deployment:{bind:'public'},backends:[{id:'mujoco_arm',installed:true,reachable:true}]});
 for(const [file,scenarioId,backendSetId,mode] of [['mock-report.json','FD01','mock-amr','mock'],['mujoco-report.json','MJ-BV01','engineering-mujoco-arm-v1','simulation']])put(`cl01-attempt-01/${file}`,{schemaHash:hash,manifest:{sourceCommit:commit,runId:scenarioId,clock:{tickMs:20},scenario:{id:scenarioId},backendSetId,mode,access:'simulated'},outcome:{status:'completed',served:'2',tick:4800,simTimeNs:'96000000000'},attention:[],coffee:{armTrace:{stop:null},jobs:[{jobId:'job-1',status:'delivered'},{jobId:'job-2',status:'delivered'}]},arm:{armPlant:{engine:'mujoco_3d',calibration:'not_calibrated'}}});
 put('cl01-attempt-01/stream-reconnect.json',{after:'6',through:'8',first:[{event:'business',id:'6'}],resumed:[{event:'business',id:'7'},{event:'business',id:'8'}]});
 put('smoke.mjs','// producer captured with the record');put('cl01-attempt-01.log','exit 0');
 const read=(name:string)=>name==='checksums.json'?Buffer.from(JSON.stringify({algorithm:'sha256',files:digests})):files.has(name)?Buffer.from(files.get(name)!):null;
 const mutate=(name:string,fn:(doc:Doc)=>void)=>{const doc=JSON.parse(files.get(name)!);fn(doc);put(name,doc);};
 return {base,files,digests,read,mutate};
}
test('a complete Cloud Run supplement is bound to the unchanged R2a bytes and pin; tested never grants acceptance',()=>{
 const f=fixture();expect(checkCloudRunEvidence(f.read,Buffer.from(f.base))).toEqual([]);
 expect(JSON.parse(f.base).gates['G-CLOUD1']).toBeUndefined();
 f.mutate('deployment.json',d=>d.accepted=true);expect(checkCloudRunEvidence(f.read,Buffer.from(f.base))).toContain('ACCEPTANCE_FORBIDDEN');
});
test('missing and corrupt artifacts fail even when the summary claims success',()=>{
 const f=fixture();f.files.delete('cl01-attempt-01/mujoco-report.json');expect(checkCloudRunEvidence(f.read,f.base)).toContain('ARTIFACT_MISSING:cl01-attempt-01/mujoco-report.json');
 const g=fixture();g.files.set('smoke.mjs','tampered');expect(checkCloudRunEvidence(g.read,g.base)).toContain('ARTIFACT_HASH_MISMATCH:smoke.mjs');
});
test('unsafe checksum paths are rejected before the reader receives them',()=>{
 const f=fixture();f.digests['../secret']=hash;const reads:string[]=[];
 expect(checkCloudRunEvidence((p:string)=>{reads.push(p);return f.read(p);},f.base)).toContain('ARTIFACT_PATH_INVALID:../secret');expect(reads).not.toContain('../secret');
});
test.each([
 ['deployment.json',(d:Doc):void=>{d.qualification.sha256=hash;},'R2A_HASH_MISMATCH'],
 ['deployment.json',(d:Doc):void=>{d.labCommit='d'.repeat(40);},'IDENTITY_MISMATCH'],
 ['cl01-attempt-01/health.json',(d:Doc):void=>{d.schemaHash='e'.repeat(64);},'IDENTITY_MISMATCH'],
 ['revision.json',(d:Doc):void=>{d.status.imageDigest='other';},'DEPLOYMENT_MISMATCH'],
 ['deployment.json',(d:Doc):void=>{d.url='http://127.0.0.1:8000';},'DEPLOYMENT_MISMATCH'],
 ['cl01-attempt-01/summary.json',(d:Doc):void=>{d.cases.pairing='not_run';},'CL01_NOT_TESTED'],
 ['cl01-attempt-01/mujoco-report.json',(d:Doc):void=>{d.outcome.status='needs_attention';},'MUJOCO_NOT_COMPLETED'],
 ['cl01-attempt-01/mujoco-report.json',(d:Doc):void=>{d.outcome.served='0';},'MUJOCO_NOT_COMPLETED'],
 ['cl01-attempt-01/mujoco-report.json',(d:Doc):void=>{d.manifest.sourceCommit='f'.repeat(40);},'IDENTITY_MISMATCH'],
 ['cl01-attempt-01/stream-reconnect.json',(d:Doc):void=>{d.resumed[1].id='9';},'STREAM_NOT_CONTIGUOUS'],
 ['cl01-attempt-01/stream-reconnect.json',(d:Doc):void=>{d.resumed.push({event:'reset'});},'STREAM_NOT_CONTIGUOUS'],
] as const)('rejects rehashed semantic tampering in %s (%s)',(file,change,reason)=>{
 const f=fixture();f.mutate(file,change);expect(checkCloudRunEvidence(f.read,f.base)).toContain(reason);
});

test('the provenance inventory cannot be removed together with its checksums',()=>{
 const f=fixture();f.files.delete('image-build.log');delete f.digests['image-build.log'];
 expect(checkCloudRunEvidence(f.read,f.base)).toContain('ARTIFACT_MISSING:image-build.log');
});
test('a contiguous prefix is incomplete until it reaches the independently recorded cursor',()=>{
 const f=fixture();f.mutate('cl01-attempt-01/stream-reconnect.json',d=>{d.resumed=d.resumed.slice(0,1);});
 expect(checkCloudRunEvidence(f.read,f.base)).toContain('STREAM_NOT_CONTIGUOUS');
});
test.each(['stop','attention','jobs','clock','time'])('terminal outcome cannot hide contradictory plant evidence: %s',field=>{
 const f=fixture();f.mutate('cl01-attempt-01/mujoco-report.json',d=>{
  if(field==='stop')d.coffee.armTrace.stop={reason:'PLANT_UNSTABLE',latched:true};
  if(field==='attention')d.attention=[{reason:'TRANSFER_UNKNOWN'}];
  if(field==='jobs')d.coffee.jobs[0].status='needs_attention';
  if(field==='clock')d.manifest.clock.tickMs=10;
  if(field==='time')d.outcome.simTimeNs='32000000000';
 });expect(checkCloudRunEvidence(f.read,f.base)).toContain('MUJOCO_NOT_COMPLETED');
});
test('missing revision names never establish matching deployment identity',()=>{
 const f=fixture();f.mutate('deployment.json',d=>{delete d.revision;for(const t of d.traffic)delete t.revisionName;});f.mutate('revision.json',d=>{delete d.metadata.name;});
 expect(checkCloudRunEvidence(f.read,f.base)).toContain('DEPLOYMENT_MISMATCH');
});
test('missing configured and tested origins never establish an origin match',()=>{
 const f=fixture();f.mutate('deployment.json',d=>{d.environment=d.environment.filter((e:Doc)=>e.name!=='LAB_ALLOW_ORIGIN');});f.mutate('cl01-attempt-01/summary.json',d=>{delete d.origin;});
 expect(checkCloudRunEvidence(f.read,f.base)).toContain('DEPLOYMENT_MISMATCH');
});
test('the smoke must archive both of its runs before it finishes',()=>{
 const f=fixture();f.mutate('cl01-attempt-01/summary.json',d=>{d.cleanup=[];});expect(checkCloudRunEvidence(f.read,f.base)).toContain('SMOKE_CLEANUP_INCOMPLETE');
});
