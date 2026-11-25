// Authoring script for robotics/catalog/{devices,components,documents}: every manufacturer value below was read from a pinned PDF (document id + page in `locator`).
// Idempotent: rewrites its own files and the catalog.json / imports.json entries that name them. Run: pnpm exec tsx scripts/author-device-catalog.mts
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashJson} from '../packages/lab-runtime/src/v2/hash';
import {sealElectrical} from '../packages/lab-runtime/src/engineering/electrical/contracts';
import type {DeviceProfileV1} from '../packages/lab-runtime/src/engineering/electrical/contracts';
import type {SourceRef} from '../packages/lab-runtime/src/engineering/contracts';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),CAT=join(ROOT,'robotics/catalog'),VENDOR=join(ROOT,'../docs/2026-11-25-R5~/research/vendor-documents');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');

interface Pdf{id:string;file:string;url:string;title:string;revision:string;kind:DeviceProfileV1['documents'][number]['kind']}
const PDFS:Record<string,Pdf>={
 'hp5140':{id:'hp5140',file:'orientalmotor/HP-5140-8E.pdf',url:'https://www.orientalmotor.com/products/pdfs/opmanuals/HP-5140-8E.pdf',title:'BLV Series R Type Operating Manual, Installation and Connection Edition (HP-5140-8E)',revision:'8E',kind:'manual'},
 'hp5143':{id:'hp5143',file:'orientalmotor/HP-5143-3E.pdf',url:'https://www.orientalmotor.com/products/pdfs/opmanuals/HP-5143-3E.pdf',title:'BLV Series R Type Driver CANopen Communication Profile (HP-5143-3E)',revision:'3E',kind:'manual'},
};
const bytes:Record<string,Buffer>={},digest:Record<string,string>={};
for(const [k,d] of Object.entries(PDFS)){bytes[k]=await readFile(join(VENDOR,d.file));digest[k]=sha(bytes[k]!);}

const src=(doc:string,locator:string):SourceRef=>({kind:'manufacturer',documentId:doc,revision:PDFS[doc]!.revision,locator,contentSha256:digest[doc]!});
const sc=(value:number,unit:string,s:SourceRef)=>({value,unit,source:s});
const docOf=(...ids:string[])=>ids.map(id=>({id,kind:PDFS[id]!.kind,title:PDFS[id]!.title,revision:PDFS[id]!.revision,url:PDFS[id]!.url,digest:digest[id]!,license:'unreviewed'}));
const component=(id:string,family:string,sku:string|null,docs:string[])=>({schemaVersion:1,id,revision:'1',identity:{manufacturer:'Oriental Motor',family,sku,status:'candidate'},links:[],joints:[],ports:[],models:[],documents:docs.map(d=>({id:d,url:PDFS[d]!.url,digest:digest[d]!,license:'unreviewed'}))});

const C='HP-5143-3E';
const pin=(pin:string,name:string,role:string,s:SourceRef)=>({pin,name,role,portId:null,source:s});
const cn4=(p:number,name:string,role:string)=>pin(String(p),name,role,src('hp5140','HP-5140-8E p.18, CN4 pin assignments'));
const driverComponent=component('orientalmotor-blvd-krd','BLV R series driver (CAN / RS-485)','BLVD-KRD',['hp5140','hp5143']);
const motorComponent=component('orientalmotor-blv-r-60w','BLV R series 60 W brushless motor (round shaft)','BLMR260HK-A',['hp5140']);
const cDigest=(c:object)=>hashJson(c);

const ioIn=(pointId:string,pinNo:number,fn:string)=>({pointId,direction:'input' as const,pin:`CN4/${pinNo}`,commonPin:'CN4/15',
 electrical:{type:'dry_contact_input' as const,voltageRangeV:[12,30] as [number,number],maxCurrentA:null},functions:[fn],defaultFunction:fn,reassignable:true,assignmentPersistence:'retained' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:`${C} p.113: object 60FDh reports limit, home and HWTO status and the remote outputs, not the state of this input; the Function Edition manual is not pinned`,updatePeriodMs:null},safety:null,source:src('hp5140','HP-5140-8E p.18 (CN4 pin list, initial functions in parentheses), p.19-20 (photocoupler inputs), p.35 (12 to 30 VDC)')});
const ioOut=(pointId:string,pinNo:number,commonNo:number,fn:string)=>({pointId,direction:'output' as const,pin:`CN4/${pinNo}`,commonPin:`CN4/${commonNo}`,
 electrical:{type:'isolated_transistor_output' as const,voltageRangeV:[12,30] as [number,number],maxCurrentA:sc(0.01,'A',src('hp5140','HP-5140-8E p.20 and p.35: 12 to 30 VDC, 10 mA or less, saturated voltage 2.0 VDC maximum'))},functions:[fn],defaultFunction:fn,reassignable:true,assignmentPersistence:'retained' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:`${C} p.114: 60FEh writes remote inputs; whether it can drive this output depends on the function assignment in the Function Edition manual, which is not pinned`,updatePeriodMs:null},safety:null,source:src('hp5140','HP-5140-8E p.18 and p.20')});
const hwto=(pointId:string,pinNo:number,commonNo:number)=>({pointId,direction:'input' as const,pin:`CN4/${pinNo}`,commonPin:`CN4/${commonNo}`,
 electrical:{type:'dry_contact_input' as const,voltageRangeV:[12,30] as [number,number],maxCurrentA:null},functions:['power_removal'],defaultFunction:'power_removal',reassignable:false,assignmentPersistence:'fixed' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:`${C} p.113: either HWTO input being active is reported together as bit 3 of 60FDh`,updatePeriodMs:null},
 safety:{function:'safe_input' as const,claim:'Provide individual contacts for operating the HWTO1 input and the HWTO2 input.',documentId:'hp5140',locator:'HP-5140-8E p.23',certificate:null},source:src('hp5140','HP-5140-8E p.23, input voltage 12 to 30 VDC')});

const blvdProfile=sealElectrical<Omit<DeviceProfileV1,'digest'>>({schemaVersion:1,documentType:'device-profile',id:'blvd-krd-v1',revision:1,
 component:{id:driverComponent.id,revision:'1',digest:cDigest(driverComponent)},variant:{orderCode:'BLVD-KRD',hardwareRevision:null,firmware:null},kind:'servo_drive',documents:docOf('hp5140','hp5143'),
 connectors:[
  {id:'CN1',label:'Main power supply',matingPart:'F32FSS-03V-KX with LF3F-41GF-P2.0 contacts (J.S.T.); cable LC03D06A sold separately',pins:[pin('1','VIN','power',src('hp5140','HP-5140-8E p.16, CN1 pin assignment')),pin('2','GND','return',src('hp5140','HP-5140-8E p.16, CN1 pin assignment')),pin('3','FG','pe',src('hp5140','HP-5140-8E p.16, CN1 pin assignment'))]},
  {id:'CN2',label:'Motor',matingPart:null,pins:[pin('1','MOTOR','motor_phase',src('hp5140','HP-5140-8E p.17: motor cable or connection cable into CN2; pin list not in this manual'))]},
  {id:'CN3',label:'Encoder / electromagnetic brake',matingPart:null,pins:[pin('1','ENC/MB','encoder',src('hp5140','HP-5140-8E p.17: encoder and brake connector CN3; pin list not in this manual'))]},
  {id:'CN4',label:'I/O, CAN, RS-485, power removal',matingPart:'DFMC 0,5/14-ST-2,54 (PHOENIX CONTACT), AWG26 to 20',pins:[
   cn4(1,'OUT0+','do'),cn4(2,'OUT0-','return'),cn4(3,'OUT1+','do'),cn4(4,'OUT1-','return'),cn4(5,'CAN_L','bus'),cn4(6,'CAN_H','bus'),cn4(7,'CAN_GND','return'),cn4(8,'485GND','return'),cn4(9,'TR+','bus'),cn4(10,'TR-','bus'),
   cn4(11,'HWTO1+','sto'),cn4(12,'HWTO1-','sto'),cn4(13,'0V','return'),cn4(14,'EDM-','do'),cn4(15,'IN-COM','return'),cn4(16,'IN0','di'),cn4(17,'IN1','di'),cn4(18,'IN2','di'),cn4(19,'IN3','di'),cn4(20,'NET-VIN','power'),
   cn4(21,'NET-GND','return'),cn4(22,'485GND','return'),cn4(23,'TR+','bus'),cn4(24,'TR-','bus'),cn4(25,'+V','power'),cn4(26,'HWTO2+','sto'),cn4(27,'HWTO2-','sto'),cn4(28,'EDM+','do')]}],
 ioPoints:[ioIn('IN0',16,'ID-SEL0'),ioIn('IN1',17,'ID-SEL1'),ioIn('IN2',18,'STOP'),ioIn('IN3',19,'FREE'),ioOut('OUT0',1,2,'COMM-PWR'),ioOut('OUT1',3,4,'ALM-B'),hwto('HWTO1',11,12),hwto('HWTO2',26,27),
  {pointId:'EDM',direction:'output',pin:'CN4/28',commonPin:'CN4/14',electrical:{type:'isolated_transistor_output',voltageRangeV:[12,30],maxCurrentA:sc(0.01,'A',src('hp5140','HP-5140-8E p.23: 10 mA or less, saturated voltage 2.0 V maximum'))},functions:['edm'],defaultFunction:'edm',reassignable:false,assignmentPersistence:'fixed',
   busExposure:{kind:'none',object:null,bit:null,precondition:null,updatePeriodMs:null},safety:null,source:src('hp5140','HP-5140-8E p.23: "The EDM output is not an output signal to ensure the safety"; monitoring a failure only')}],
 interfaces:[
  {id:'can0',portId:'CN4/5,6,7',protocol:'canopen',profile:'cia402',descriptionDocumentId:null,source:src('hp5143','HP-5143-3E: CANopen communication profile of the BLV R driver; EDS file not pinned')},
  {id:'rs485',portId:'CN4/9,10,8',protocol:'modbus_rtu',profile:null,descriptionDocumentId:null,source:src('hp5140','HP-5140-8E p.3 and p.18: RS-485 (Modbus RTU) on CN4')}],
 drive:{axes:1,modes:['pp','pv'],ratedCurrentA:sc(3.3,'A',src('hp5140','HP-5140-8E p.35: supply-side rated current, 60 W, at 24 VDC (1.7 A at 48 VDC)')),peakCurrentA:sc(5.5,'A',src('hp5140','HP-5140-8E p.35: supply-side maximum input current, 60 W')),
  profileAccelerationRadS2:sc(1000*Math.PI/30,'rad/s^2',src('hp5143','HP-5143-3E p.103: 6083h default 1,000 (r/min)/s, range 1 to 1,000,000,000; converted to rad/s^2')),
  feedback:{kinds:['encoder in motor (CN3)'],countsPerRev:null},
  watchdog:{kind:'heartbeat',rangeMs:[0,65535],source:src('hp5143','HP-5143-3E p.67: 1017h producer heartbeat 0 to 65,535 ms (0); p.23: 8130h node guarding or heartbeat error')},
  stop:{quickStop:true,quickStopOption:sc(2,'1',src('hp5143','HP-5143-3E p.99: 605Ah default 2 = decelerate with the quick stop ramp 6085h, then switch on disabled')),faultReactionOption:sc(2,'1',src('hp5143','HP-5143-3E p.100: 605Eh default 2 = decelerate with the quick stop ramp 6085h')),
   torqueOff:{function:'sto',claim:'The power removal function is a function that stops supplying the power to the motor by the hardware.',documentId:'hp5140',locator:'HP-5140-8E p.3, p.7 (risk assessment and verification testing required), p.38 (safety function STO)',certificate:null},
   torqueOffPointIds:['HWTO1','HWTO2'],monitorOutputPointId:'EDM',brakeOutputPointId:null,source:src('hp5140','HP-5140-8E p.7, p.23')},
  faultMap:[{vendorCode:'FF10h',neutral:'FOLLOWING_ERROR',source:src('hp5143','HP-5143-3E p.23: position deviation')},{vendorCode:'FF31h',neutral:'OVERSPEED',source:src('hp5143','HP-5143-3E p.23: overspeed')},
   {vendorCode:'FF28h',neutral:'FEEDBACK_LOSS',source:src('hp5143','HP-5143-3E p.23: encoder error')},{vendorCode:'FF2Ah',neutral:'FEEDBACK_LOSS',source:src('hp5143','HP-5143-3E p.23: encoder communication error')},
   {vendorCode:'8130h',neutral:'COMMAND_TIMEOUT',source:src('hp5143','HP-5143-3E p.23: node guarding error or heartbeat error')},{vendorCode:'FF68h',neutral:'EXTERNAL_TRIP',source:src('hp5143','HP-5143-3E p.23: HWTO input detection')}]}});

const motorProfile=sealElectrical<Omit<DeviceProfileV1,'digest'>>({schemaVersion:1,documentType:'device-profile',id:'blv-r-60w-v1',revision:1,
 component:{id:motorComponent.id,revision:'1',digest:cDigest(motorComponent)},variant:{orderCode:'BLMR260HK-A',hardwareRevision:null,firmware:null},kind:'motor',documents:docOf('hp5140'),
 connectors:[{id:'MOTOR',label:'Motor cable to driver CN2',matingPart:null,pins:[pin('1','MOTOR','motor_phase',src('hp5140','HP-5140-8E p.17: motor cable into CN2; pin list not in this manual'))]},
  {id:'ENC',label:'Encoder and brake cable to driver CN3',matingPart:null,pins:[pin('1','ENC/MB','encoder',src('hp5140','HP-5140-8E p.17: encoder and brake cable into CN3; pin list not in this manual'))]}],
 ioPoints:[],interfaces:[],drive:null});

const DEVICES=[{component:driverComponent,profile:blvdProfile},{component:motorComponent,profile:motorProfile}];

// ---- write
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
for(const k of Object.keys(PDFS))await writeFile(join(CAT,'documents',digest[k]!),bytes[k]!);
const imports=JSON.parse(await readFile(join(CAT,'imports.json'),'utf8')) as {documentId:string}[];
for(const [k,d] of Object.entries(PDFS)){const e={documentId:`vendor:${d.id}`,url:d.url,sha256:digest[k]!,commit:'n/a (vendor PDF)',license:'unreviewed',file:`documents/${digest[k]}`};const i=imports.findIndex(x=>x.documentId===e.documentId);if(i<0)imports.push(e);else imports[i]=e;}
await writeFile(join(CAT,'imports.json'),json(imports));
await mkdir(join(CAT,'devices'),{recursive:true});
const index=JSON.parse(await readFile(join(CAT,'catalog.json'),'utf8')) as {components:{file:string;digest:string}[];deviceProfiles?:{file:string;digest:string}[]};
const upsert=(list:{file:string;digest:string}[],e:{file:string;digest:string})=>{const i=list.findIndex(x=>x.file===e.file);if(i<0)list.push(e);else list[i]=e;list.sort((a,b)=>a.file<b.file?-1:1);};
index.deviceProfiles??=[];
for(const {component:c,profile:p} of DEVICES){
 await writeFile(join(CAT,`components/${c.id}.json`),json(c));upsert(index.components,{file:`components/${c.id}.json`,digest:cDigest(c)});
 await writeFile(join(CAT,`devices/${p.id}.json`),json(p));upsert(index.deviceProfiles,{file:`devices/${p.id}.json`,digest:(p as {digest:string}).digest});
}
await writeFile(join(CAT,'catalog.json'),json(index));
console.log(JSON.stringify(DEVICES.map(d=>({component:d.component.id,componentDigest:cDigest(d.component),profile:d.profile.id,digest:(d.profile as {digest:string}).digest}))));
