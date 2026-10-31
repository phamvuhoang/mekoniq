// Explicit disposable Android lab: real APK/Keystore/SQLite/TLS/domain, no host business server.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,generateKeyPairSync,sign,createHash} from 'node:crypto';
import https from 'node:https';
import {canonicalize} from 'json-canonicalize';
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT??join(homedir(),'Library/Android/sdk');
const adb=join(sdk,'platform-tools/adb'),emulator=join(sdk,'emulator/emulator'),avdmanager=join(sdk,'cmdline-tools/latest/bin/avdmanager');
const directory='.lab/android/two-emulator';await mkdir(directory,{recursive:true});
const coordinator=process.env.COORDINATOR_SERIAL??'emulator-5580',peer=process.env.PEER_SERIAL??'emulator-5582';
if(coordinator!=='emulator-5580'||peer!=='emulator-5582')throw new Error('ONLY_DEDICATED_EMULATOR_PORTS_5580_5582_ALLOWED');
const component='io.mekoniq.tablet/io.mekoniq.tablet.lab.TestDeviceOwnerReceiver';
const runId=randomUUID(),scope={organizationId:'org-mekoniq-emulator-'+runId,venueId:'venue-emulator'};
const report={startedAt:new Date().toISOString(),scope,coordinator,peer,status:'failed',physicalQualification:'not_run',wallClockSoak:'not_run',network:'ADB TCP forwarding is transport only; bundled APK owns all business decisions',steps:[]};
const env={...process.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk};
async function run(binary,args,input,timeout=180000){
 const child=spawn(binary,args,{env,stdio:['pipe','pipe','pipe']});let output='';
 child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
 if(input!==undefined)child.stdin.end(input);else child.stdin.end();
 const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
 if(code!==0)throw new Error(`${binary} failed (${code}): ${output.slice(-6000)}`);return output;
}
const device=(serial,...args)=>run(adb,['-s',serial,...args]);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ensurePeer(){
 const devices=await run(adb,['devices']);
 if(!devices.includes(peer+'\tdevice')){
  const avds=await run(emulator,['-list-avds']);
  if(!avds.split(/\r?\n/).includes('mekoniq-wave01-peer'))await run(avdmanager,['create','avd','-n','mekoniq-wave01-peer','-k','system-images;android-33;google_apis;arm64-v8a','-d','pixel_3a'],'no\n');
  const log=await open(join(directory,'peer-emulator.log'),'a');
  const child=spawn(emulator,['-avd','mekoniq-wave01-peer','-port','5582','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-memory','1536'],{env,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
 }
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){try{if((await device(peer,'shell','getprop','sys.boot_completed')).trim()==='1')return;}catch{/* Emulator may still be booting. */}await pause(2000);}
 throw new Error('PEER_EMULATOR_BOOT_TIMEOUT');
}
async function verifyOwned(serial,name){
 const actual=(await device(serial,'emu','avd','name')).split(/\r?\n/)[0].trim();if(actual!==name)throw new Error('REFUSE_NON_LAB_AVD:'+actual);
 report.steps.push({stage:'verified-device',serial,avd:actual,api:(await device(serial,'shell','getprop','ro.build.version.sdk')).trim(),model:(await device(serial,'shell','getprop','ro.product.model')).trim()});
}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function action(serial,name,extra={}){
 const args=['shell','am','instrument','-w','-e','class','io.mekoniq.tablet.NativeLabFixtureTest#runLabAction','-e','action',name];
 for(const [key,value]of Object.entries(extra))args.push('-e',key,typeof value==='string'?value:encode(value));
 args.push('io.mekoniq.tablet.test/androidx.test.runner.AndroidJUnitRunner');
 const output=await device(serial,...args);
 await writeFile(join(directory,serial+'-'+name+'.log'),output);
 if(!/OK \(1 test\)/.test(output)||/FAILURES|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED/.test(output))throw new Error('INSTRUMENTATION_'+name+': '+output.slice(-6000));
 const result=output.match(/MEKONIQ_RESULT=(\{[^\r\n]+\})/);if(!result)throw new Error('MISSING_LAB_RESULT:'+name);return JSON.parse(result[1]);
}
const issuer=generateKeyPairSync('ec',{namedCurve:'P-256'}),issuerPublic=issuer.publicKey.export({format:'jwk'});
const signObject=payload=>sign('sha256',Buffer.from(canonicalize(payload)),{key:issuer.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
const signed=(payload,key='grant')=>({[key]:payload,signature:signObject(payload)});
function fixture(identity,owner,isCoordinator,seed,identities){
 const deviceId=isCoordinator?'lab-coordinator':'lab-peer',actorRef=isCoordinator?'lab-owner':'lab-peer-owner';
 const issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString();
 const restrictions={...scope,deviceId,cloudBaseUrl:'https://127.0.0.1:1',enrollmentIssuerJwk:JSON.stringify(issuerPublic),coordinatorEnabled:isCoordinator,ownerEndpoint:'https://10.0.2.2:57443',ownerFingerprint:owner.certificateFingerprint,coordinatorPort:18443};
 const snapshots=[{kind:'configuration',id:'applied',state:seed.configuration},{kind:'catalog',id:'current',state:seed.menu},{kind:'catalog-version',id:'1',state:seed.menu},...seed.stations.map(x=>({kind:'station',id:x.id,state:x})),...seed.tables.map(x=>({kind:'table',id:x.id,state:x})),{kind:'robot',id:seed.robot.id,state:{...seed.robot,ownerDeviceId:'lab-coordinator'}}];
 for(const [id,item]of Object.entries(identities))snapshots.push({kind:'device',id,state:{deviceEpoch:item.deviceEpoch,status:'active',publicJwk:item.jwk,certificateFingerprint:item.certificateFingerprint}});
 return {restrictions,snapshots,authority:signed({...scope,deviceEpoch:identity.deviceEpoch,coordinatorEpoch:1,policyRevision:1,ownerDeviceId:'lab-coordinator',ownerDeviceEpoch:owner.deviceEpoch,publicJwk:owner.jwk,expiresAt}),offlineGrant:signed({schemaVersion:1,...scope,actorRef,deviceId,deviceEpoch:identity.deviceEpoch,permissions:['*'],stationIds:['kitchen','bar','wash'],coordinatorEpoch:1,issuedAt,expiresAt,nonce:randomUUID()},'payload'),pairingGrant:signed({...scope,deviceId,deviceEpoch:identity.deviceEpoch,actorRef,permissions:['*'],stationIds:['kitchen','bar','wash'],expiresAt,publicJwk:identity.jwk,certificateFingerprint:identity.certificateFingerprint})};
}
async function startOwner(){
 await device(coordinator,'shell','am','start','-n','io.mekoniq.tablet/.MainActivity');
 const end=Date.now()+30000;
 while(Date.now()<end){try{await new Promise((resolve,reject)=>{
  const request=https.get('https://127.0.0.1:57443/v1/health',{rejectUnauthorized:false,timeout:1000},res=>{res.resume();resolve();});
  request.on('socket',socket=>socket.on('secureConnect',()=>{const actual=createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');if(actual!==report.ownerCertificateFingerprint)request.destroy(new Error('PIN_MISMATCH'));}));
  request.on('timeout',()=>request.destroy(new Error('TIMEOUT')));request.on('error',reject);
 });await pause(2000);return;}catch{/* Wait for the real native listener. */}await pause(500);}
 await writeFile(join(directory,'owner-listener-failure.log'),await device(coordinator,'logcat','-d','-t','1500'));throw new Error('REAL_OWNER_TLS_LISTENER_NOT_READY');
}
function command(type,payload,operationId,identity){const time=new Date().toISOString();return {schemaVersion:1,...scope,operationId,type,actorRef:'lab-peer-owner',deviceId:'lab-peer',deviceEpoch:identity.deviceEpoch,coordinatorEpoch:1,policyRevision:1,occurredAt:time,recordedAt:time,payload,payloadHash:createHash('sha256').update(canonicalize(payload)).digest('hex')};}
try{
 await ensurePeer();await verifyOwned(coordinator,'mekoniq-wave01-test');await verifyOwned(peer,'mekoniq-wave01-peer');
 if(!process.argv.includes('--skip-build'))await run('apps/tablet-android/android/gradlew',['-p','apps/tablet-android/android',':app:assembleDebug',':app:assembleDebugAndroidTest'],undefined,240000);
 for(const serial of [coordinator,peer]){
  await device(serial,'install','-r','apps/tablet-android/android/app/build/outputs/apk/debug/app-debug.apk');
  await device(serial,'install','-r','apps/tablet-android/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
  const owner=await device(serial,'shell','dumpsys','device_policy');
  if(!owner.includes('TestDeviceOwnerReceiver'))await device(serial,'shell','dpm','set-device-owner',component);
  await device(serial,'shell','pm','grant','io.mekoniq.tablet','android.permission.POST_NOTIFICATIONS').catch(()=>{});
 }
 for(const serial of [coordinator,peer]){await device(serial,'shell','am','force-stop','io.mekoniq.tablet');await action(serial,'resetIdentity');}
 const a=await action(coordinator,'identity'),b=await action(peer,'identity');report.ownerCertificateFingerprint=a.certificateFingerprint;
 const seed=JSON.parse(await readFile('tests/fixtures/restaurant-v1.json','utf8'));
 await writeFile(join(directory,'issuer-private.json'),JSON.stringify(issuer.privateKey.export({format:'jwk'})),{mode:0o600});
 await action(coordinator,'install',{fixture:fixture(a,a,true,seed,{'lab-coordinator':a,'lab-peer':b})});
 await action(peer,'install',{fixture:fixture(b,a,false,seed,{'lab-coordinator':a,'lab-peer':b})});
 await device(coordinator,'forward','tcp:57443','tcp:18443');
 const offer=await action(coordinator,'offer');await startOwner();await action(peer,'pair',{offer});report.steps.push({stage:'paired-over-real-pinned-TLS',passed:true});
 const sessionId='session-'+runId,openCommand=command('Session.Open',{sessionId,tableId:'table-1'},'open-'+runId,b);
 const orderCommand=command('Order.Place',{sessionId,tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]},'order-'+runId,b);
 const journey=await action(peer,'send',{commands:[openCommand,orderCommand]});
 for(const result of journey.responses)if(result.status!=='accepted'||result.ack!=='venue')throw new Error('PEER_COMMAND_NOT_VENUE_COMMITTED:'+JSON.stringify(result));
 report.steps.push({stage:'real-domain-session-and-order-with-WAN-unavailable',responses:journey.responses});
 await device(coordinator,'shell','am','force-stop','io.mekoniq.tablet');
 const persisted=await action(coordinator,'inspect');if(persisted.orders!==1||persisted.sessions!==1)throw new Error('RESTART_DURABILITY_FAILED');
 await startOwner();const retry=await action(peer,'sendRaw',{command:orderCommand});if(retry.status!=='accepted'||retry.ack!=='venue'||retry.duplicate!==true)throw new Error('OWNER_RETRY_NOT_DURABLY_DEDUPLICATED:'+JSON.stringify(retry));
 report.steps.push({stage:'coordinator-restart-and-real-TLS-retry',orders:persisted.orders,duplicate:retry.duplicate});
 await device(coordinator,'shell','am','force-stop','io.mekoniq.tablet');
 // Cut the transport explicitly: Android may restart a device-owner process after force-stop.
 await device(coordinator,'forward','--remove','tcp:57443');
 const isolated=command('Session.Open',{sessionId:'isolated-'+runId,tableId:'table-2'},'isolated-'+runId,b);
 const loss=await action(peer,'send',{commands:[isolated]});if(loss.responses[0].status!=='pending'||loss.responses[0].ack!=='local')throw new Error('FALSE_VENUE_ACK_WHEN_OWNER_UNREACHABLE:'+JSON.stringify(loss));
 const local=await action(peer,'inspect');if(local.pending<1)throw new Error('ISOLATED_INTENT_NOT_DURABLE');
 report.steps.push({stage:'transport-partition-keeps-peer-local-pending',response:loss.responses[0],pending:local.pending});
 report.status='passed';
}catch(error){report.error=error instanceof Error?error.stack:String(error);throw error;}
finally{report.finishedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:join(directory,'report.json'),physicalQualification:report.physicalQualification}));}
