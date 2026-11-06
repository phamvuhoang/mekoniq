import {existsSync,readFileSync} from 'node:fs';
import Ajv from 'ajv';
import {expect,test} from 'vitest';
const path='packages/contracts/schemas/lab-transfer-evidence.schema.json';
const observation={observationId:'obs-1',runId:'run-1',cupId:'cup-1',transferId:'transfer-1',commandId:'command-1',payloadHash:'0'.repeat(64),deviceId:'arm-1',observerId:'arm-observer',bootId:'boot-1',controlEpoch:1,seq:'9007199254740993',producer:'mock_arm',fidelity:'modeled',phase:'grasp',parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},clockDomain:'arm-clock',observedMonotonicNs:'99999999999999999',receivedMonotonicNs:'10',quality:'valid'};
function schema(){expect(existsSync(path),'the new evidence namespace must have its own schema').toBe(true);return JSON.parse(readFileSync(path,'utf8'));}
test('the transfer namespace accepts modeled observations and rejects incomplete, non-finite and out-of-range values',()=>{
 const s=schema(),ajv=new Ajv({strict:true});ajv.addSchema(s);const valid=ajv.getSchema(s.$id)!;
 expect(valid(observation)).toBe(true);
 for(const patch of [{seq:'-1'},{controlEpoch:0},{controlEpoch:Number.MAX_SAFE_INTEGER+1},{controlEpoch:NaN},{parent:'robot:amr-1/tray:0'},{fidelity:'physical'},{extra:true},{liftPoseReached:'true'},{grip:{closed:true}}])expect(valid({...observation,...patch}),JSON.stringify(patch)).toBe(false);
 const evidence=ajv.getSchema(`${s.$id}#/definitions/CorrelatedTransferEvidence`)!;
 const e={giver:{...observation,phase:'release',parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}},receiver:{...observation,observationId:'obs-2',phase:'receive',deviceId:'amr-1',observerId:'amr-observer',producer:'mock_amr',parent:'robot:amr-1/tray:1',grip:null},dock:{robotId:'amr-1',slot:1,bootId:'amr-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'10'}};
 expect(evidence(e)).toBe(true);
 for(const patch of [{slot:0},{slot:1.5},{errorM:-1},{errorM:NaN},{errorM:Infinity}])expect(evidence({...e,dock:{...e.dock,...patch}})).toBe(false);
});
test('the semantic validator correlates identity, epoch, slot, independent observers and coordinator freshness',async()=>{
 expect(existsSync('packages/lab-runtime/src/v2/beverage/cup-ledger.ts')).toBe(true);
 const {validateTransferObservation,validateCorrelatedTransferEvidence}=await import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');
 const pending={runId:'run-1',cupId:'cup-1',transferId:'transfer-1',commandId:'command-1',payloadHash:'0'.repeat(64),controlEpoch:1,deviceId:'arm-1',to:{kind:'arm' as const,id:'arm-1'}};
 const policy={nowMonotonicNs:'20',freshnessNs:'10',dockToleranceM:0.05};
 expect(validateTransferObservation(observation,pending,policy).ok).toBe(true); // provider clock is unrelated
 for(const patch of [{runId:'other'},{cupId:'other'},{transferId:'other'},{commandId:'other'},{payloadHash:'1'.repeat(64)},{controlEpoch:0},{deviceId:'other'},{receivedMonotonicNs:'21'},{receivedMonotonicNs:'9'},{quality:'stale'},{controlEpoch:NaN}])expect(validateTransferObservation({...observation,...patch},pending,policy).ok,JSON.stringify(patch)).toBe(false);
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}};
 const giver={...observation,phase:'release',parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};
 const receiver={...observation,observationId:'obs-2',phase:'receive',deviceId:'amr-1',observerId:'amr-observer',producer:'mock_amr',parent:'robot:amr-1/tray:1',grip:null};
 const e={giver,receiver,dock:{robotId:'amr-1',slot:1,bootId:'amr-boot',stationary:true,localizationValid:true,errorM:0.01,receivedMonotonicNs:'10'}};
 expect(validateCorrelatedTransferEvidence(e,p,policy).ok).toBe(true);
 for(const bad of [{...e,receiver:{...receiver,observerId:giver.observerId}},{...e,dock:{...e.dock,slot:2}},{...e,dock:{...e.dock,errorM:NaN}},{...e,dock:{...e.dock,errorM:0.051}},{...e,dock:{...e.dock,receivedMonotonicNs:'21'}},{...e,receiver:{...receiver,controlEpoch:2}}])expect(validateCorrelatedTransferEvidence(bad,p,policy).ok).toBe(false);
});
