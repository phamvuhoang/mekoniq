import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2).filter(x=>x!=='--');
const suite=args[0]??'lifecycle';
const coordinator=process.env.COORDINATOR_SERIAL,peer=process.env.PEER_SERIAL;
const fail=message=>{console.error('PREREQUISITE: '+message);process.exit(2);};
if(!coordinator||!peer||coordinator===peer)fail('select two distinct enrolled test devices with COORDINATOR_SERIAL and PEER_SERIAL');
if(!/^[A-Za-z0-9._:-]+$/.test(coordinator)||!/^[A-Za-z0-9._:-]+$/.test(peer))fail('invalid device serial');
const file=process.env.ANDROID_LAB_ENROLLMENT;
if(!file||!existsSync(file))fail('ANDROID_LAB_ENROLLMENT must name an explicit test-device enrollment JSON file');
const enrollment=JSON.parse(await readFile(file,'utf8'));
for(const serial of [coordinator,peer])if(!enrollment.devices?.some(d=>d.serial===serial&&d.testOnly===true&&d.packageId==='io.mekoniq.tablet'))fail('selected serial is not explicitly enrolled for this test app: '+serial);
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;
const adb=process.env.ADB??(sdk?join(sdk,'platform-tools','adb'):'adb');
async function run(command,argv,env={}){
 const child=spawn(command,argv,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw new Error('ANDROID_LAB_COMMAND_FAILED:'+command);return output;
}
const device=(serial,...argv)=>run(adb,['-s',serial,...argv]);
const report={suite,startedAt:new Date().toISOString(),devices:[],status:'failed',physicalQualification:'not_run'};
try{
 for(const serial of [coordinator,peer]){
  if((await device(serial,'get-state')).trim()!=='device')fail('device not online: '+serial);
  const model=(await device(serial,'shell','getprop','ro.product.model')).trim();
  const api=(await device(serial,'shell','getprop','ro.build.version.sdk')).trim();
  const app=await device(serial,'shell','dumpsys','package','io.mekoniq.tablet');
  if(!app.includes('DEBUGGABLE'))fail('only installed debug test APKs may be force-stopped by this harness');
  report.devices.push({serial,model,api,emulator:serial.startsWith('emulator-')});
 }
 if(suite!=='lifecycle'&&suite!=='restaurant'&&suite!=='continuity')fail('unknown Android suite');
 await run('apps/tablet-android/android/gradlew',['-p','apps/tablet-android/android',':app:assembleDebug',':app:assembleDebugAndroidTest']);
 for(const serial of [coordinator,peer]){
  await device(serial,'install','-r','apps/tablet-android/android/app/build/outputs/apk/debug/app-debug.apk');
  await device(serial,'install','-r','apps/tablet-android/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
 }
 const testClass=suite==='lifecycle'?'io.mekoniq.tablet.LifecycleAcceptanceTest':suite==='restaurant'?'io.mekoniq.tablet.RestaurantJourneyTest':'io.mekoniq.tablet.ContinuityAcceptanceTest';
 if(suite==='lifecycle')await device(coordinator,'shell','am','force-stop','io.mekoniq.tablet');
 try{
  const output=await device(suite==='lifecycle'?peer:coordinator,'shell','am','instrument','-w','-e','class',testClass,'-e','coordinatorStopped',suite==='lifecycle'?'true':'false','-e','testVenue',enrollment.venueId??'','io.mekoniq.tablet.test/androidx.test.runner.AndroidJUnitRunner');
  if(!/OK \(\d+ tests?\)/.test(output)||/FAILURES|INSTRUMENTATION_FAILED/.test(output))throw new Error('ANDROID_INSTRUMENTATION_FAILED');
  report.status='passed';
 }finally{if(suite==='lifecycle')await device(coordinator,'shell','am','start','-n','io.mekoniq.tablet/.MainActivity');}
}finally{
 await mkdir('.lab/android',{recursive:true});await writeFile('.lab/android/'+suite+'.json',JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2)+'\n');
}
