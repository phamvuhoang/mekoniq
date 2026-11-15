import {validMobileSample} from '../twin/payload';
import physicsSchema from '../shared/engineering-schemas/physics-evidence-v1.schema.json' with {type:'json'};
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
// Import is a trust boundary. Validate every structural field consumed by replay/UI before persistence.
// Domain state remains extensible, but known display fields cannot override these types.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {RunReport} from '../scenarios/controls';
type S=Record<string,unknown>;
const str:S={type:'string',maxLength:65536},num:S={type:'number'},bool:S={type:'boolean'},integer:S={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const decimal:S={type:'string',pattern:'^[0-9]+$',maxLength:40},date:S={type:'string',format:'date-time'};
const arr=(items:S):S=>({type:'array',items});
const obj=(properties:Record<string,S>,required=Object.keys(properties)):S=>({type:'object',properties,required});
const record=(additionalProperties:S):S=>({type:'object',additionalProperties,maxProperties:10000});
const nullable=(s:S):S=>({anyOf:[s,{type:'null'}]});
const vector=(n:number):S=>({...arr(num),minItems:n,maxItems:n});
const quantity=obj({amount:str,unit:str,provenance:str,tolerance:str},['amount','unit','provenance']);
const step=obj({id:str,kind:str,status:str,deviceId:str,commandId:nullable(str),target:nullable(quantity),measured:nullable(quantity),observedBy:nullable(str)});
const movement=obj({transferId:str,provenance:str,observedBy:str,at:date});
const job=obj({jobId:str,recipeId:str,recipeRevision:integer,status:str,steps:arr(step)});
const cup=obj({cupId:str,ownerKind:str,ownerId:str,movements:arr(movement)});
const state=obj({jobId:str,cupId:str,recipeId:str,recipeRevision:integer,status:str,steps:arr(step),ownerKind:str,ownerId:str,movements:arr(movement),served:decimal,attentionReason:nullable(str),currentStopId:nullable(str),robotId:nullable(str),stops:arr(obj({id:str,status:str,action:str,allocationIds:arr(str)},[]))},[]);
const collisionResult=obj({ok:bool,engine:str,geometryRevision:str,modelRevision:str,pair:{...arr(str),minItems:2,maxItems:2},toleranceM:num,evaluations:integer,reason:str,fraction:num,clearanceM:num},['ok','engine','geometryRevision','modelRevision']);
const scene=obj({available:bool,scope:{enum:['self_injected_only','self_scene_robot']},reason:str,revision:str,profileRevision:nullable(integer),tick:integer,world:arr({}),robotPoses:arr(obj({id:str,from:vector(2),to:vector(2)}))},['available','scope','revision','profileRevision','tick']);
const collision=obj({world:arr({}),checks:nullable(integer),last:nullable(collisionResult),scene,evidence:obj({intervals:arr(obj({firstTick:integer,lastTick:integer,fromQ:arr(num),toQ:arr(num),heldCupId:nullable(str),worldRevision:str,sceneRevision:nullable(str),result:collisionResult})),worlds:record(arr({})),droppedIntervals:nullable(integer),firstFailure:obj({tick:integer,fromQ:arr(num),toQ:arr(num),heldCupId:nullable(str),worldRevision:str,world:arr({}),scene:nullable(scene),result:collisionResult}),projection:obj({cursorTick:integer,lastCheckTick:nullable(integer),retainedRange:obj({fromTick:nullable(integer),toTick:nullable(integer)}),historyComplete:bool,worldScope:{const:'checked_geometry'},reason:str},['cursorTick','lastCheckTick','retainedRange','historyComplete','worldScope'])},['intervals','worlds','droppedIntervals'])},['world','checks','last']);
const identity=obj({id:str,revision:integer,hash:str});
const telemetryState=nullable(obj({xM:num,yM:num,yawRad:num,moving:bool,hold:nullable(str),goalCommandId:str,goalState:str,jointsRad:vector(6),jointsActualRad:vector(6),jointsCommandedRad:vector(6),tcpM:vector(3),homed:bool,cycleState:str,machineStatus:str,cupPresent:nullable(bool)},[]));
const sample=obj({schemaVersion:{const:2},runId:str,entityId:str,providerId:str,bootId:str,seq:decimal,simTimeNs:nullable(decimal),observedAt:nullable(date),receivedMonotonicNs:decimal,frameId:str,origin:{enum:['mock','controller_sim','physics_sim','hardware']},quality:{enum:['valid','stale','unknown','invalid']},reasonCodes:arr(str),commanded:telemetryState,observed:telemetryState,estimated:telemetryState,causationId:nullable(str)});
const level:S={enum:['unsupported','modeled','verified']},digest:S={type:'string',pattern:'^[0-9a-f]{64}$'};
const closed=(s:S):S=>({...s,additionalProperties:false});
const capabilities=closed(obj(Object.fromEntries(['geometry','rigidBody','actuator','sensor','grasp','process','calibration'].map(k=>[k,level]))));
const engineeringEvidence=closed(obj({status:{enum:['pass','fail','not_run']},reasons:arr(str),capabilities,caseResults:arr({}),artifactRefs:closed(obj({sampleCount:integer,firstSimTimeNs:nullable(decimal),lastSimTimeNs:nullable(decimal),samplesSha256:digest,artifacts:arr(str)}))}));
// IR-SIM navigation metrics as the source reports them (navigation2d runner): every field the Lab renders or decides on has its type, counts are non-negative safe integers
const episode=obj({pair:{...arr(str),minItems:2,maxItems:2},source:str,fromTick:integer,toTick:integer});
const navigation=obj({horizon:nullable(integer),coverage:{enum:['complete','incomplete']},reasons:arr(str),distanceM:nullable(record(num)),driveDistanceM:nullable(record(num)),collisionEpisodes:nullable(integer),safetyEnvelopeEpisodes:nullable(integer),
 episodes:arr(episode),minClearanceM:nullable(num),minSeparationM:nullable(num),sensorPublications:obj({expected:integer,recorded:integer,complete:bool})},[]);
const physicsMetric:S={oneOf:[closed(obj({available:{const:true},value:num,unit:str,samples:integer})),closed(obj({available:{const:false},value:{type:'null'},unit:str,reason:str}))]};
const physicsKeys=['loadDisplacementM','maxTiltRad','tiltExceededDurationS','wheelPositionResidualM','wheelYawResidualRad','contactPeakN','contactImpulseNs','stopDistanceM'];
const physicsEvidence=closed(obj({manifest:{$ref:'physics-evidence-v1.schema.json'},manifestSha256:digest,complete:bool,issues:arr(str),metrics:closed(obj(Object.fromEntries(physicsKeys.map(k=>[k,physicsMetric]))))}));
physicsEvidence.allOf=[{if:{type:'object',properties:{complete:{const:true}},required:['complete']},
 then:{type:'object',properties:{issues:{type:'array',maxItems:0},manifest:{type:'object',properties:{coverage:{type:'object',properties:{complete:{const:true}}},gaps:{type:'array',maxItems:0},terminalReason:{type:'null'}}}}},
 else:{type:'object',properties:{metrics:{type:'object',properties:Object.fromEntries(physicsKeys.map(k=>[k,{type:'object',properties:{available:{const:false}}}]))}}}}];
const shape=obj({
 physicsEvidence,
 manifest:obj({engineering:closed(obj({bundleDigest:digest,projectDigest:digest})),runId:str,sourceCommit:str,mode:{enum:['mock','simulation']},access:str,backendSetId:str,backends:arr(obj({id:str,version:str,model:str,dynamics:bool})),clock:obj({tickMs:{...integer,minimum:1,maximum:3600000},native:obj({provider:{const:'gazebo_nav2'},originNs:decimal,businessEpochMs:integer})},['tickMs']),seed:integer,scenario:identity,project:identity,world:identity,assets:arr(obj({id:str,revision:integer,contentHash:str,resolved:bool})),models:arr(obj({id:str,revision:{type:['string','number']},hash:str,provenance:str})),recipes:arr(identity),profiles:arr(obj({id:str,revision:integer,hash:str,provenance:str})),armCollisionScene:obj({hash:str,profile:nullable(obj({revision:integer},['revision'])),profileHash:nullable(str),world:obj({}),worldHash:str,robotGeometry:arr(obj({id:str,radiusM:nullable(num)}))})},['runId','sourceCommit','mode','access','backendSetId','backends','clock','seed','scenario','project','world','assets']),
 engineeringEvidence,
 outcome:obj({status:str,served:decimal,tick:integer,simTimeNs:decimal}),
 metrics:obj({maxConcurrentMovers:integer,distanceM:record(num),collision:obj({available:bool,reason:str,contacts:nullable(integer),minSeparationM:nullable(num)},['available','contacts','minSeparationM']),navigation},['distanceM','collision']),
 businessEvents:arr(obj({sequence:decimal,at:date,type:str,kind:str,id:str,state},['sequence','at','type','kind','id'])),
 effects:arr(obj({id:str,type:str,status:str,attempts:integer,payload:obj({commandId:nullable(str)},[])})),faults:arr(obj({tick:integer,faultId:str,entityId:nullable(str)})),
 attention:arr(obj({reason:str,tick:integer,robotId:str,subjectId:str,commandId:str},['reason','tick'])),
 telemetry:obj({lossy:{const:true},coalesced:{const:true},rateHz:num,source:str,samples:arr(sample),sampleCounts:record(integer),dropped:integer,gaps:arr(obj({reason:str,fromTick:nullable(integer),toTick:integer}))}),
 reconciliations:arr(obj({subjectId:str,commandId:nullable(str),nativeState:str,tick:integer})),coverage:record(bool),limitations:arr(str),
 coffee:obj({plantLog:arr(obj({})),jobs:arr(job),cups:arr(cup),armTrace:obj({tag:str,interpolation:str,modelRevision:str,limitsOk:bool,samples:arr(obj({tick:integer,q:arr(num),tcp:vector(3)})),collision:nullable(collision),stop:nullable(obj({latched:bool,reconcileRequired:bool,reason:str,events:arr(obj({tick:integer,stage:{enum:['requested','acknowledged','observed','reset']},reason:str,provenance:{const:'modelled'}}))}))},['tag','interpolation','modelRevision','limitsOk','samples'])},['jobs','cups','armTrace'])
},['manifest','outcome','metrics','businessEvents','effects','faults','reconciliations','coverage','limitations']);
const ajv=new Ajv({strict:true,allowUnionTypes:true});addFormats(ajv);ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(physicsSchema,'physics-evidence-v1.schema.json');
const validShape=ajv.compile<RunReport>(shape);
export function validReportShape(value:unknown):value is RunReport{
 if(!validShape(value))return false;
 if(value.manifest.backends.some(b=>b.id==='mujoco_3d')&&(value.manifest.mode!=='simulation'||value.manifest.access!=='simulated'||value.manifest.calibration?.status!=='not_calibrated'))return false;
 return (value.telemetry?.samples??[]).every(s=>s.providerId==='mujoco_3d'?validMobileSample(s):s.observed?.payloadKind===undefined);
}
