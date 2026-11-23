import type {BeliefRecord} from '../../src/shared/navigation2d';
import {admitBeliefReport} from '../../src/twin/belief';
const profileBytes="{\n  \"schemaVersion\": 1,\n  \"documentType\": \"perception-profile\",\n  \"id\": \"perception-nominal-v1\",\n  \"revision\": 1,\n  \"digest\": \"0450ee298dc8db3d72de98f3ab0e0a984a71f8ce8d36119a8babece8b41b36f9\",\n  \"calibration\": \"not_calibrated\",\n  \"parameterSource\": \"assumed\",\n  \"updateEveryTicks\": 10,\n  \"latencyTicks\": 5,\n  \"biasM\": [\n    0,\n    0\n  ],\n  \"sigmaM\": [\n    0.002,\n    0.002\n  ],\n  \"dropoutProbability\": 0.05,\n  \"visibleRegionId\": \"nozzle-stand\",\n  \"maxAgeTicks\": 50\n}\n";
const profile=JSON.parse(profileBytes),sha='d29f2369a1aa842f763501db96e858e5fa64878600a8f720731d728a7a194fbf';
export function coveredReport(beliefs:BeliefRecord[],horizon=100){
 return {manifest:{runId:'run',perception:{profile:{id:profile.id,revision:profile.revision,digest:profile.digest,sha256:sha}}},
  outcome:{tick:horizon},arm:{worldTrace:{prefixCovered:true,firstTick:0,lastTick:horizon,publicCommittedTick:horizon,samples:horizon+1,reasonCodes:[]}},
  perceptionEvidence:{schemaVersion:1,beliefs,attempts:[],recovery:[],complete:false,issues:[] as string[],
   coverage:{scope:'belief_evaluations',firstTick:0,lastTick:horizon,prefixCovered:true,streamFinalized:false},
   policy:{ageBasis:'publishedTick',profile:structuredClone(profile),profileSha256:sha,profileBytes}}};
}
export function loadedReport(beliefs:BeliefRecord[]){const r=coveredReport(beliefs);admitBeliefReport(r);return r;}
