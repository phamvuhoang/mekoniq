// CLI driver of the same native lifecycle used by the authenticated gateway.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeScenarioRun,type NativeProviderFactory} from './native-lifecycle';
import type {SilRunOptions,SilRunResult,SilAssertion,SilRunManifest} from './campaign';
import {PRNG} from '../random';
import {assessNativeFaultCase,type NativeFaultBaseline} from './native-fault-oracle';
import type {JsonObject} from '../../../../contracts/src/index';
import {hashJson} from '../hash';
export async function runNativeSilScenario(o:SilRunOptions,factory:NativeProviderFactory):Promise<SilRunResult>{
 if(o.faults?.length)throw new Error('NATIVE_LEGACY_FAULT_SCHEDULE_UNSUPPORTED');
 const run=await createNativeScenarioRun({project:o.project,scenarioId:o.scenarioId,scenarioRevision:o.scenarioRevision,seed:o.seed,mode:'simulation',access:'simulated',backendSetId:o.backendSetId,sourceCommit:o.sourceCommit},{directory:o.outDir,catalog:o.catalog,scenarios:o.scenarios},factory,{deadlineMs:Math.min(3_600_000,o.maxIterations*Math.max(1,o.paceMs)),paceMs:Math.max(1,o.paceMs)});
 try{
  await run.start();let v=await run.snapshot();
  while(v.run.status==='running'||v.run.status==='paused'){await new Promise(r=>setTimeout(r,Math.max(1,o.paceMs)));v=await run.snapshot();}
  await run.awaitObservationWindow();
  const report=await run.report(),verification=report.verification!,types=report.businessEvents.map(e=>e.type),native=verification.execution==='ran';
  let assertions:SilAssertion[]=[{id:'BV01.native-verification',result:verification.result,reason:verification.blockers.join(',')},{id:'BV01.served-after-handoff',result:report.outcome.status==='completed'&&report.outcome.served==='2'&&types.indexOf('CargoLoaded')>=0&&types.indexOf('DeliveryHandedOff')>types.indexOf('CargoLoaded')?'pass':'fail',detail:`served=${report.outcome.served}; ${report.outcome.status}`},
   {id:'ARM03',result:verification.arm?.result??'not_run',reason:verification.arm?.reasonCodes.join(',')},
   {id:'SIM.engine-samples',result:native?'pass':'not_run',reason:native?undefined:'NATIVE_ENGINE_SAMPLES_MISSING'},
   {id:'SIM.no-contact',result:!native?'not_run':verification.blockers.includes('GAZEBO_CONTACT')?'fail':verification.blockers.some(c=>c.startsWith('CONTACT_'))?'not_run':'pass'},
   {id:'BV01.cup-ledger',result:verification.transfers.length>0&&!verification.blockers.includes('CUP_TRANSFER_COVERAGE_MISSING')?'pass':'not_run'},
  ];
  if(factory.faultExpectation){const log=JSON.parse(await readFile(join(o.outDir,'fault-evidence.json'),'utf8')) as JsonObject[],baselines=JSON.parse(await readFile(join(o.outDir,'fault-baselines.json'),'utf8')) as NativeFaultBaseline[],dispatches=JSON.parse(await readFile(join(o.outDir,'native-command-dispatch.json'),'utf8')) as JsonObject[];const assessment=assessNativeFaultCase(factory.faultExpectation,report,log,baselines,dispatches),result=assessment.some(a=>a.result==='fail')?'fail':assessment.some(a=>a.result==='not_run')?'not_run':'pass';await writeFile(join(o.outDir,'fault-case-assessment.json'),JSON.stringify({expectation:factory.faultExpectation,producer:native?'native':'protocol_double',coverageScope:'provider-observations-through-fault-injection',businessOutcome:report.outcome,businessVerification:verification.result,assessment,result:native?result:'not_run'}));assertions=[...assessment.map(a=>!native&&['ARM03','SIM.engine-samples','SIM.no-contact'].includes(a.id)?{...a,result:'not_run' as const,reason:'PROTOCOL_DOUBLE_OR_NATIVE_SAMPLES_MISSING'}:a),{id:'BV01.native-verification',result:native?result:'not_run',reason:native?undefined:'PROTOCOL_DOUBLE_OR_NATIVE_SAMPLES_MISSING',detail:`Declared negative-case oracle; business remains ${report.outcome.status}/${report.verification?.result}.`}];}
  await writeFile(join(o.outDir,'assertions.json'),JSON.stringify(assertions));
  const artifacts=[...verification.artifacts.map(a=>({path:a.path,sha256:a.sha256})),...await Promise.all(['assertions.json','report.json',...factory.faultExpectation?['fault-case-assessment.json']:[]].map(async path=>({path,sha256:createHash('sha256').update(await readFile(join(o.outDir,path))).digest('hex')})))];
  const manifest:SilRunManifest={...factory.faultExpectation?{nativeFaultExpectation:factory.faultExpectation}:{},schemaVersion:1,runId:run.id,sourceCommit:o.sourceCommit,mode:'simulation',access:'simulated',backendSetId:o.backendSetId,backends:report.manifest.backends.map(b=>b.id),scenario:report.manifest.scenario,project:report.manifest.project,world:{inputHash:o.world.inputHash,manifestHash:o.world.manifestHash,mapId:o.world.mapId,mapRevision:o.world.mapRevision},seed:o.seed,prng:PRNG,clock:{iterationMs:20,source:'actual Gazebo /clock; controller monotonic separately mapped in arm-tick-map.json'},evidence:native?'sil':'protocol_double',backendCapability:{backendId:'gazebo_nav2',available:native,step:false,version:'1',reasons:verification.blockers,evidence:native?'sil':'protocol_double',bootId:report.telemetry.samples.find(s=>s.providerId==='gazebo_nav2')?.bootId??null,robots:report.entities.map(e=>e.id)},status:report.outcome.status==='completed'?'completed':'needs_attention',iterations:report.outcome.tick,businessDigest:hashJson(report.businessEvents),hashAlgorithm:'sha256-canonical-json-v1',outputs:artifacts,limitations:report.limitations};
  manifest.prng=report.manifest.prng as SilRunManifest['prng'];manifest.manifestHash=hashJson(manifest);await writeFile(join(o.outDir,'run-manifest.json'),JSON.stringify(manifest,null,2));
  return {manifest,assertions,business:{served:report.outcome.served,missions:{completed:types.filter(t=>t==='MissionCompleted').length,needsAttention:report.attention.length,open:0}}};
 }finally{await run.close();}
}
