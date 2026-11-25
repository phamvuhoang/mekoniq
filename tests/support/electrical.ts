import {createHash} from 'node:crypto';
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

export interface ProfileOpts{id?:string;ioSource?:SourceRef;firmware?:string|null;orderCode?:string|null;certificateModels?:string[];kind?:DeviceProfileV1['kind'];noDrive?:boolean;extraDocs?:DeviceProfileV1['documents']}
const doc=(id:string,kind:DeviceProfileV1['documents'][number]['kind'],digest:string)=>({id,kind,title:id,revision:'1',url:'https://example.invalid/'+id,digest,license:'unreviewed'});
/** A fully cited two-input, two-output drive with a torque-off claim; every option narrows it to one defect. */
export function driveProfile(o:ProfileOpts={}):DeviceProfileV1{
 const orderCode=o.orderCode===undefined?'DRV-750':o.orderCode,io=o.ioSource??manufacturer('manual','CN2');
 const point=(pointId:string,direction:'input'|'output',pin:string,fn:string,extra:Record<string,unknown>={})=>({pointId,direction,pin:'CN2/'+pin,commonPin:'CN2/1',
  electrical:{type:(direction==='input'?'pnp_sink_input':'pnp_source_output') as 'pnp_sink_input',voltageRangeV:[12,30] as [number,number],maxCurrentA:direction==='output'?scalar(0.01,'A',io):null},
  functions:[fn,'general_purpose'],defaultFunction:'general_purpose',reassignable:true,assignmentPersistence:'retained' as const,
  busExposure:{kind:'cyclic' as const,object:'60FD:00',bit:Number(pin)+15,precondition:null,updatePeriodMs:null},safety:null,source:io,...extra});
 const p:any={schemaVersion:1,documentType:'device-profile',id:o.id??'drv-750',revision:1,
  component:{id:'drv-component',revision:'1',digest:sha('component')},variant:{orderCode,hardwareRevision:null,firmware:o.firmware===undefined?'1.0':o.firmware},kind:o.kind??'servo_drive',
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
