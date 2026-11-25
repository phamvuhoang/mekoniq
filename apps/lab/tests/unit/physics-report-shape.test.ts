import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {validReportShape} from '../../src/reports/report-shape';
import {report} from '../support/navigation-report';
const metric={available:false,value:null,unit:'m',reason:'PHYSICS_COVERAGE_INCOMPLETE'};
const block=()=>({manifest:{schemaVersion:1,documentType:'physics-evidence',identity:{runId:'r',bootId:'b',sceneDigest:'a'.repeat(64),loadProfileDigest:'b'.repeat(64),physicsProfileDigest:'c'.repeat(64)},streams:[],coverage:{firstTick:0,lastTick:0,complete:false},gaps:[],terminalReason:null,metricsPolicyDigest:'d'.repeat(64),assumptions:[{kind:'assumed',documentId:'test',revision:'1',locator:'fixture',contentSha256:'e'.repeat(64)}]},manifestSha256:'f'.repeat(64),complete:false,issues:['PHYSICS_COVERAGE_INCOMPLETE'],metrics:Object.fromEntries(['loadDisplacementM','maxTiltRad','tiltExceededDurationS','wheelPositionResidualM','wheelYawResidualRad','contactPeakN','contactImpulseNs','stopDistanceM'].map(k=>[k,metric]))});
test('legacy report stays importable; optional physics block is admitted intact',()=>{
 expect(validReportShape(report())).toBe(true);const r={...report(),physicsEvidence:block()};expect(validReportShape(r)).toBe(true);expect(r.physicsEvidence.metrics.contactImpulseNs).toEqual(metric);
});
test('malformed or contradictory optional physics cannot pass the browser report boundary',()=>{
 for(const bad of [{},{...block(),manifestSha256:'wrong'},{...block(),complete:true},{...block(),metrics:{...block().metrics,contactPeakN:{available:true,value:1,unit:'N',samples:1}}},{...block(),metrics:{...block().metrics,contactPeakN:{available:true,value:Infinity,unit:'N',samples:1}}}])expect(validReportShape({...report(),physicsEvidence:bad})).toBe(false);
});
