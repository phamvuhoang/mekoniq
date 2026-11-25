import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import type {DeviceProfileV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import type {SourceRef} from '../../packages/lab-runtime/src/engineering/contracts';
import {sealElectrical} from '../../packages/lab-runtime/src/engineering/electrical/contracts';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const DOC_DIGEST={datasheet:sha('datasheet'),manual:sha('manual'),safety:sha('safety-manual'),cert:sha('certificate'),eds:sha('eds')};
const ref=(documentId:string,locator='p1'):SourceRef=>({kind:'manufacturer',documentId,revision:'1',locator,contentSha256:({datasheet:DOC_DIGEST.datasheet,manual:DOC_DIGEST.manual,'safety-manual':DOC_DIGEST.safety,certificate:DOC_DIGEST.cert,eds:DOC_DIGEST.eds} as Record<string,string>)[documentId]!});
/** A manufacturer source that resolves to a document the fixture profile declares. */
export const manufacturer=(documentId='manual',locator='p1')=>ref(documentId,locator);
export const assumedSource:SourceRef={kind:'assumed',documentId:'worksheet',revision:'1',locator:'guess',contentSha256:'a'.repeat(64)};
const scalar=(value:number,unit:string,source:SourceRef)=>({value,unit,source});

export interface ProfileOpts{componentDigest?:string;id?:string;ioSource?:SourceRef;firmware?:string|null;orderCode?:string|null;certificateModels?:string[];kind?:DeviceProfileV1['kind'];noDrive?:boolean;extraDocs?:DeviceProfileV1['documents']}
const doc=(id:string,kind:DeviceProfileV1['documents'][number]['kind'],digest:string)=>({id,kind,title:id,revision:'1',url:'https://example.invalid/'+id,digest,license:'unreviewed'});
/** A fully cited two-input, two-output drive with a torque-off claim; every option narrows it to one defect. */
export function driveProfile(o:ProfileOpts={}):DeviceProfileV1{
 const orderCode=o.orderCode===undefined?'DRV-750':o.orderCode,io=o.ioSource??manufacturer('manual','CN2');
 const point=(pointId:string,direction:'input'|'output',pin:string,fn:string,extra:Record<string,unknown>={})=>({pointId,direction,pin:'CN2/'+pin,commonPin:'CN2/1',
  electrical:{type:(direction==='input'?'pnp_sink_input':'pnp_source_output') as 'pnp_sink_input',voltageRangeV:[12,30] as [number,number],maxCurrentA:direction==='output'?scalar(0.01,'A',io):null},
  functions:[fn,'general_purpose'],defaultFunction:'general_purpose',reassignable:true,assignmentPersistence:'retained' as const,
  busExposure:{kind:'cyclic' as const,object:'60FD:00',bit:Number(pin)+15,precondition:null,updatePeriodMs:null},safety:null,source:io,...extra});
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const p:any={schemaVersion:1,documentType:'device-profile',id:o.id??'drv-750',revision:1,
  component:{id:'drv-component',revision:'1',digest:o.componentDigest??sha('component')},variant:{orderCode,hardwareRevision:null,firmware:o.firmware===undefined?'1.0':o.firmware},kind:o.kind??'servo_drive',
  documents:[doc('datasheet','datasheet',DOC_DIGEST.datasheet),doc('manual','manual',DOC_DIGEST.manual),doc('safety-manual','safety_manual',DOC_DIGEST.safety),doc('certificate','certificate',DOC_DIGEST.cert),doc('eds','description_file',DOC_DIGEST.eds),...(o.extraDocs??[])],
  connectors:[{id:'CN2',label:'I/O',matingPart:'MATE-8',pins:[{pin:'1',name:'COM',role:'return',portId:null,source:io},{pin:'2',name:'IN0',role:'di',portId:null,source:io},{pin:'3',name:'IN1',role:'di',portId:null,source:io},{pin:'4',name:'OUT0',role:'do',portId:null,source:io},{pin:'5',name:'STO1',role:'sto',portId:null,source:io}]}],
  ioPoints:[point('IN0','input','2','general'),point('IN1','input','3','general'),point('OUT0','output','4','general',{busExposure:{kind:'acyclic',object:'60FE:01',bit:null,precondition:'enable remote output',updatePeriodMs:20}})],
  interfaces:[{id:'can0',portId:'bus',protocol:'canopen',profile:'cia402',descriptionDocumentId:'eds',source:manufacturer('manual','CAN')}],
  drive:o.noDrive?null:{axes:2,modes:['csp','csv'],ratedCurrentA:scalar(5,'A',manufacturer('datasheet')),peakCurrentA:scalar(15,'A',manufacturer('datasheet')),profileAccelerationRadS2:null,
   feedback:{kinds:['incremental'],countsPerRev:scalar(10000,'1',manufacturer('datasheet'))},watchdog:{kind:'heartbeat',rangeMs:[10,10000],source:manufacturer('manual','heartbeat')},
   stop:{quickStop:true,quickStopOption:scalar(6,'1',manufacturer('manual','605A')),faultReactionOption:scalar(0,'1',manufacturer('manual','605E')),
    torqueOff:{function:'sto',claim:'STO input removes torque',documentId:'safety-manual',locator:'3.1',certificate:{documentId:'certificate',body:'TUV',number:'123',models:o.certificateModels??['DRV-750']}},
    torqueOffPointIds:[],monitorOutputPointId:null,brakeOutputPointId:null,source:manufacturer('manual','stop')},
   faultMap:[{vendorCode:'E01',neutral:'OVERSPEED',source:manufacturer('manual','faults')}]}};
 return sealElectrical(p) as DeviceProfileV1;
}
export const profileDigest=(p:DeviceProfileV1)=>hashJson({...p,digest:undefined});

/** Blob bytes behind DOC_DIGEST; the document digest is the sha256 of exactly this text. */
export const DOC_TEXT:Record<string,string>={[DOC_DIGEST.datasheet]:'datasheet',[DOC_DIGEST.manual]:'manual',[DOC_DIGEST.safety]:'safety-manual',[DOC_DIGEST.cert]:'certificate',[DOC_DIGEST.eds]:'eds'};
/** Adds a profile to an existing catalog root: file, blobs (unless `blobs:false`) and the `deviceProfiles` entry. */
export async function addProfile(root:string,profile:DeviceProfileV1,o:{blobs?:boolean;declared?:string;summary?:unknown}={}){
 await mkdir(join(root,'devices'),{recursive:true});await mkdir(join(root,'documents'),{recursive:true});
 const file=`devices/${profile.id}.json`;await writeFile(join(root,file),JSON.stringify(profile));
 if(o.blobs!==false)for(const d of profile.documents)if(DOC_TEXT[d.digest]!==undefined)await writeFile(join(root,'documents',d.digest),DOC_TEXT[d.digest]!);
 if(o.summary){await mkdir(join(root,'descriptions'),{recursive:true});await writeFile(join(root,'descriptions',`${DOC_DIGEST.eds}.summary.json`),JSON.stringify(o.summary));}
 const index=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'));
 index.deviceProfiles=[...(index.deviceProfiles??[]),{file,digest:o.declared??profile.digest}];
 await writeFile(join(root,'catalog.json'),JSON.stringify(index));
}

import type {ElectricalDesignV1,SignalV1,WiringPolicyV1,SafetyRequirementsV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
export const signal=(o:Partial<SignalV1>={}):SignalV1=>({id:'bumper-front',label:'Front bumper',role:'bumper',direction:'input',field:{deviceId:'bumper-front-sw',pin:'1',returnPin:'2'},
 electrical:{type:'relay_output',nominalV:24,currentA:{value:0.005,unit:'A',source:assumedSource}},consumer:'controller',maxLatencyMs:50,required:true,pinned:null,...o});
export const wiringPolicy=(o:Partial<WiringPolicyV1>={}):WiringPolicyV1=>sealElectrical({schemaVersion:1,documentType:'wiring-policy',id:'wiring-policy-test',revision:1,
 ampacity:[{csaMm2:0.5,maxCurrentA:{value:5,unit:'A',source:assumedSource}},{csaMm2:1,maxCurrentA:{value:10,unit:'A',source:assumedSource}},{csaMm2:2.5,maxCurrentA:{value:20,unit:'A',source:assumedSource}}],
 signalMinCsaMm2:0.25,maxVoltageDropFraction:{value:0.03,unit:'1',source:assumedSource},copperResistivityOhmMm2PerM:0.0175,colours:[{role:'power',colour:'red'},{role:'return',colour:'black'}],
 sources:{ampacity:assumedSource,drop:assumedSource},...o}) as WiringPolicyV1;
/** One drive device ('drive-left' with the given profile) and one pin-level signal; `o` overrides any top-level field. */
export function design(o:Partial<ElectricalDesignV1>&{profile?:DeviceProfileV1}={}):ElectricalDesignV1{
 const profile=o.profile??driveProfile(),{profile:_p,...rest}=o;void _p;
 return sealElectrical({schemaVersion:1,documentType:'electrical-design',id:'design-test',revision:1,project:{id:'project-test',revision:1},option:{id:'hw-test',label:'Test option',rationale:'fixture'},
  devices:[{id:'drive-left',profile:{id:profile.id,revision:profile.revision,digest:profile.digest},assemblyInstanceId:null},{id:'bumper-front-sw',profile:{id:profile.id,revision:profile.revision,digest:profile.digest},assemblyInstanceId:null}],
  axes:[{axisId:'amr-1/wheel-left',driveDeviceId:'drive-left',channel:0,motorDeviceId:null}],buses:[],power:[],signals:[signal()],stopFunctions:[],safetyRequirementsRef:null,
  wiringPolicyRef:{id:'wiring-policy-test',revision:1,digest:wiringPolicy().digest},...rest}) as ElectricalDesignV1;
}
export const safetyRequirements=(requirements:SafetyRequirementsV1['requirements']=[]):SafetyRequirementsV1=>sealElectrical({schemaVersion:1,documentType:'safety-requirements',id:'safety-test',revision:1,requirements}) as SafetyRequirementsV1;

import type {DesignContext} from '../../packages/lab-runtime/src/engineering/electrical/design';
type Point=DeviceProfileV1['ioPoints'][number];
/** An input point on the I/O module of {@link allocContext}: cyclic, 12 to 30 V, free for any signal. */
export const point=(o:Partial<Point>&{pointId?:string}={}):Point=>({pointId:'IN1',direction:'input',pin:'IO/IN1',commonPin:'IO/COM',electrical:{type:'pnp_sink_input',voltageRangeV:[12,30],maxCurrentA:null},functions:['general_purpose'],defaultFunction:'general_purpose',reassignable:true,
 assignmentPersistence:'retained',busExposure:{kind:'cyclic',object:'6000:01',bit:0,precondition:null,updatePeriodMs:null},safety:null,source:manufacturer('manual','IO'),...o,...(o.pointId&&!o.pin?{pin:'IO/'+o.pointId}:{})});
/** A design with a controller and one I/O module on a 10 ms CANopen bus; `points` are the module's I/O, `signals` the design's. */
export function allocContext(o:{points?:Point[];signals?:SignalV1[];cycleMs?:number;moduleOnBus?:boolean;extraDevices?:{id:string;profile:DeviceProfileV1;onBus?:boolean}[]}={}):DesignContext{
 const points=o.points??[point()],base=driveProfile({kind:'io_module',noDrive:true,id:'io-module'});
 const io=sealElectrical({...base,component:{...base.component,id:'io-component'},kind:'io_module' as const,connectors:[{id:'IO',label:'I/O',matingPart:null,pins:[{pin:'COM',name:'COM',role:'return' as const,portId:null,source:manufacturer('manual','IO')},...points.map(p=>({pin:p.pointId,name:p.pointId,role:(p.direction==='input'?'di':'do') as 'di'|'do',portId:null,source:manufacturer('manual','IO')}))]}],ioPoints:points,digest:undefined}) as DeviceProfileV1;
 const ctrl=sealElectrical({...driveProfile({id:'ctrl',kind:'compute',noDrive:true}),ioPoints:[],digest:undefined}) as DeviceProfileV1,extra=o.extraDevices??[];
 const devices=[{id:'controller',profile:ctrl},{id:'io',profile:io},...extra.map(e=>({id:e.id,profile:e.profile}))];
 const d=design({signals:o.signals??[signal({field:{deviceId:'controller',pin:'1',returnPin:null}})]});
 const full:ElectricalDesignV1={...d,devices:devices.map(x=>({id:x.id,profile:{id:x.profile.id,revision:1,digest:x.profile.digest},assemblyInstanceId:null})),axes:[],
  buses:[{id:'can0',protocol:'canopen',controllerDeviceId:'controller',cycleMs:o.cycleMs??10,members:[{deviceId:'controller',interfaceId:'can0',address:null},...(o.moduleOnBus===false?[]:[{deviceId:'io',interfaceId:'can0',address:1}]),...extra.filter(e=>e.onBus!==false).map((e,i)=>({deviceId:e.id,interfaceId:'can0',address:2+i}))]}]};
 return {design:full,profiles:new Map(devices.map(x=>[x.id,x.profile])),resolved:{placements:[],bom:{lines:[]}} as never,project:{id:'project-test',revision:1,digest:'p'.repeat(64)}};
}
