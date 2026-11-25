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
 'zlac':{id:'zlac-manual',file:'zltech/ZLAC8015D_manual_v1.02_20231030_zh.pdf',url:'https://www.zlingkj.com/download/robot-hub-servo-driver-77233',title:'ZLAC8015D servo hub motor driver user manual V1.02 (Chinese)',revision:'V1.02',kind:'manual'},
 'zllg':{id:'zllg-drawing',file:'zltech/ZLLG65ASM250-L_V3.15.pdf',url:'https://www.zlingkj.com/en/robot-hub-servo-motor-series/901228',title:'ZLLG65ASM250-L robot hub servo motor drawing V3.15',revision:'V3.15',kind:'datasheet'},
 'hp5143':{id:'hp5143',file:'orientalmotor/HP-5143-3E.pdf',url:'https://www.orientalmotor.com/products/pdfs/opmanuals/HP-5143-3E.pdf',title:'BLV Series R Type Driver CANopen Communication Profile (HP-5143-3E)',revision:'3E',kind:'manual'},
};
const bytes:Record<string,Buffer>={},digest:Record<string,string>={};
for(const [k,d] of Object.entries(PDFS)){bytes[k]=await readFile(join(VENDOR,d.file));digest[k]=sha(bytes[k]!);}

const src=(doc:string,locator:string):SourceRef=>({kind:'manufacturer',documentId:PDFS[doc]!.id,revision:PDFS[doc]!.revision,locator,contentSha256:digest[doc]!});
const sc=(value:number,unit:string,s:SourceRef)=>({value,unit,source:s});
const docOf=(...ids:string[])=>ids.map(id=>({id:PDFS[id]!.id,kind:PDFS[id]!.kind,title:PDFS[id]!.title,revision:PDFS[id]!.revision,url:PDFS[id]!.url,digest:digest[id]!,license:'unreviewed'}));
const component=(id:string,family:string,sku:string|null,docs:string[],mfr='Oriental Motor')=>({schemaVersion:1,id,revision:'1',identity:{manufacturer:mfr,family,sku,status:'candidate'},links:[],joints:[],ports:[],models:[],documents:docs.map(d=>({id:PDFS[d]!.id,url:PDFS[d]!.url,digest:digest[d]!,license:'unreviewed'}))});

const C='HP-5143-3E';
const pin=(pin:string,name:string,role:string,s:SourceRef)=>({pin,name,role,portId:null,source:s});
const cn4=(p:number,name:string,role:string)=>pin(String(p),name,role,src('hp5140','HP-5140-8E p.18, CN4 pin assignments'));
const driverComponent={...component('orientalmotor-blvd-krd','BLV R series driver (CAN / RS-485)','BLVD-KRD',['hp5140','hp5143']),ports:[{id:'vin',kind:'power',frame:{xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]},mate:'dc-bus',direction:'in',voltageRangeV:[15,55],continuousCurrentA:{value:3.3,unit:'A',source:src('hp5140','HP-5140-8E p.35: rated supply current, 60 W motor, at 24 VDC')}}]};
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
  {id:'CN1',label:'Main power supply',matingPart:'F32FSS-03V-KX with LF3F-41GF-P2.0 contacts (J.S.T.); cable LC03D06A sold separately',pins:[{...pin('1','VIN','power',src('hp5140','HP-5140-8E p.16, CN1 pin assignment')),portId:'vin'},pin('2','GND','return',src('hp5140','HP-5140-8E p.16, CN1 pin assignment')),pin('3','FG','pe',src('hp5140','HP-5140-8E p.16, CN1 pin assignment'))]},
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


// ---------- HW-B hardware: ZLTECH ZLAC8015D driver and ZLLG65ASM250-L hub wheel (documents read from the pinned PDFs; PDF page numbers)
const ZL='ZLAC8015D manual V1.02';
const zp=(page:number,what:string)=>src('zlac',`${ZL} PDF p.${page}: ${what}`);
const assumedSrc=(locator:string):SourceRef=>({kind:'assumed',documentId:'r5-assumptions',revision:'1',locator,contentSha256:sha('r5-assumptions v1')});
const zlacComponent={...component('zltech-zlac8015d','ZLAC8015D dual hub servo driver','ZLAC8015D',['zlac','zllg'],'ZLTECH'),ports:[{id:'vin',kind:'power',frame:{xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]},mate:'dc-bus',direction:'in',voltageRangeV:[20,48],continuousCurrentA:{value:13,unit:'A',source:{kind:'derived',documentId:PDFS.zllg!.id,revision:PDFS.zllg!.revision,locator:'2 x rated current 6.5 A of ZLLG65ASM250-L (drawing V3.15); supply current is not stated in the driver manual',contentSha256:digest.zllg!}}}]};
const zllgComponent=component('zltech-zllg65asm250','ZLLG65ASM250-L hub servo wheel 24 V','ZLLG65ASM250-L',['zllg'],'ZLTECH');
const zlacPins=(conn:string,list:[number,string,string][])=>list.map(([n,name,role])=>pin(String(n),name,role,zp(6,`${conn} pin table`)));
const zIn=(pointId:string,pinNo:number)=>({pointId,direction:'input' as const,pin:`J4/${pinNo}`,commonPin:'J4/6',electrical:{type:'dry_contact_input' as const,voltageRangeV:[5,5] as [number,number],maxCurrentA:null},functions:['enable','start_stop','emergency_stop','limit'],defaultFunction:'unassigned',reassignable:true,assignmentPersistence:'volatile' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:'the user manual says the input function is configured over CAN/RS485; it does not say the input state is readable there (CANopen manual not pinned)',updatePeriodMs:null},safety:null,
 source:zp(7,'2 isolated programmable inputs, 5 V; 12 V needs 1 kOhm, 24 V 2 kOhm in series; unassigned after power-up (p.8, 3.2.3)')});
const zOut=(pointId:string,pinNo:number)=>({pointId,direction:'output' as const,pin:`J3/${pinNo}`,commonPin:null,electrical:{type:'npn_sink_output' as const,voltageRangeV:[3.3,24] as [number,number],maxCurrentA:sc(0.01,'A',assumedSrc('output current is not stated in the manual'))},functions:['alarm','in_position'],defaultFunction:'alarm',reassignable:true,assignmentPersistence:'volatile' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:'the manual says the output function is configured over CAN/RS485',updatePeriodMs:null},safety:null,source:zp(8,'output with internal 5 V pull-up, or external 3.3 to 24 V pull-up (3.2.3)')});
const zBrake=(pointId:string,pinNo:number,side:string)=>({pointId,direction:'output' as const,pin:`J3/${pinNo}`,commonPin:`J3/${pinNo-2}`,electrical:{type:'isolated_transistor_output' as const,voltageRangeV:[24,48] as [number,number],maxCurrentA:sc(1,'A',assumedSrc('brake circuit rating is not stated in the manual'))},functions:['brake'],defaultFunction:'brake',reassignable:false,assignmentPersistence:'fixed' as const,
 busExposure:{kind:'none' as const,object:null,bit:null,precondition:null,updatePeriodMs:null},safety:null,source:zp(6,`${side} brake control, J3 pins BGND/-BR/BDC (3.1.4); circuit in figure 5`)});
const zlacProfile=sealElectrical<Omit<DeviceProfileV1,'digest'>>({schemaVersion:1,documentType:'device-profile',id:'zlac8015d-v1',revision:1,
 component:{id:zlacComponent.id,revision:'1',digest:cDigest(zlacComponent)},variant:{orderCode:'ZLAC8015D',hardwareRevision:null,firmware:null},kind:'servo_drive',documents:docOf('zlac','zllg'),
 connectors:[
  {id:'PWR-L',label:'Left motor power and supply',matingPart:null,pins:zlacPins('3.1.1',[[1,'DC','power'],[2,'GND','return'],[3,'U','motor_phase'],[4,'V','motor_phase'],[5,'W','motor_phase']]).map(p=>p.name==='DC'?{...p,portId:'vin'}:p)},
  {id:'PWR-R',label:'Right motor power and supply',matingPart:null,pins:zlacPins('3.1.2',[[1,'U','motor_phase'],[2,'V','motor_phase'],[3,'W','motor_phase'],[4,'DC','power'],[5,'GND','return']]).map(p=>p.name==='DC'?{...p,portId:'vin'}:p)},
  {id:'J3',label:'Brakes and outputs',matingPart:null,pins:zlacPins('3.1.4',[[1,'BGND-L','return'],[2,'-BR-L','brake'],[3,'BDC-L','brake'],[4,'BGND-R','return'],[5,'-BR-R','brake'],[6,'BDC-R','brake'],[7,'OUTPUT1','do'],[8,'OUTPUT2','do']])},
  {id:'J4',label:'Inputs and encoder outputs',matingPart:null,pins:zlacPins('3.1.5',[[1,'AOUT-L','encoder'],[2,'BOUT-L','encoder'],[3,'AOUT-R','encoder'],[4,'BOUT-R','encoder'],[5,'+5V','power'],[6,'GND','return'],[7,'INPUT1','di'],[8,'INPUT2','di']])},
  {id:'J5',label:'CAN and RS-485',matingPart:null,pins:zlacPins('3.1.6',[[1,'CANH','bus'],[2,'A','bus'],[3,'CANL','bus'],[4,'B','bus']])},
  {id:'J2',label:'Left motor encoder and HALL',matingPart:null,pins:[pin('1','ENC-L','encoder',zp(6,'3.1.3 encoder and HALL port, 12 pins'))]},
  {id:'J6',label:'Right motor encoder and HALL',matingPart:null,pins:[pin('1','ENC-R','encoder',zp(6,'3.1.3 encoder and HALL port, 12 pins'))]}],
 ioPoints:[zIn('IN1',7),zIn('IN2',8),zOut('OUT1',7),zOut('OUT2',8),zBrake('BRAKE_L',3,'left'),zBrake('BRAKE_R',6,'right')],
 interfaces:[{id:'can0',portId:'J5/1,3',protocol:'canopen',profile:'cia402',descriptionDocumentId:null,source:zp(4,'CANopen CiA301 and CiA402 sub-protocols, 100 to 1000 kbps, default 500 kbps (1.2)')},
  {id:'rs485',portId:'J5/2,4',protocol:'modbus_rtu',profile:null,descriptionDocumentId:null,source:zp(4,'RS-485 Modbus RTU, 9600 to 128000 bps, default 115200 (1.2)')}],
 drive:{axes:2,modes:['pp','pv','pt'],ratedCurrentA:sc(15,'A',zp(5,'2.1: output current (peak) typical 15 A')),peakCurrentA:sc(30,'A',zp(5,'2.1: output current (peak) maximum 30 A')),
  profileAccelerationRadS2:sc(20,'rad/s^2',assumedSrc('profile acceleration is not stated in the user manual (CANopen manual not pinned)')),
  feedback:{kinds:['incremental encoder','HALL'],countsPerRev:sc(4096,'1',src('zllg','ZLLG65ASM250-L drawing V3.15: encoder lines 4096 (valid for this wheel only)'))},
  watchdog:{kind:'none',rangeMs:null,source:assumedSrc('the user manual does not describe a communication watchdog')},
  stop:{quickStop:false,quickStopOption:null,faultReactionOption:null,torqueOff:null,torqueOffPointIds:[],monitorOutputPointId:null,brakeOutputPointId:null,source:zp(3,'p.3: e-stop circuit outside the controller; no torque-off input described; p.9 3.6: bleeder resistor advised')},
  faultMap:[{vendorCode:'LED-6',neutral:'FOLLOWING_ERROR',source:zp(9,'3.5 status LED: position deviation, 6 red flashes')},{vendorCode:'LED-12',neutral:'FEEDBACK_LOSS',source:zp(9,'3.5: encoder broken or miswired, 12 red flashes')},{vendorCode:'LED-10',neutral:'FEEDBACK_LOSS',source:zp(9,'3.5: HALL missing or wrong, 10 red flashes')},
   {vendorCode:'LED-1',neutral:'OTHER',source:zp(9,'3.5: over-voltage')},{vendorCode:'LED-2',neutral:'OTHER',source:zp(9,'3.5: under-voltage')},{vendorCode:'LED-3',neutral:'OTHER',source:zp(9,'3.5: over-current')},{vendorCode:'LED-4',neutral:'OTHER',source:zp(9,'3.5: overload')},{vendorCode:'LED-11',neutral:'OTHER',source:zp(9,'3.5: motor over-temperature')}]}});
const zllgProfile=sealElectrical<Omit<DeviceProfileV1,'digest'>>({schemaVersion:1,documentType:'device-profile',id:'zllg65asm250-v1',revision:1,
 component:{id:zllgComponent.id,revision:'1',digest:cDigest(zllgComponent)},variant:{orderCode:'ZLLG65ASM250-L',hardwareRevision:'V3.15',firmware:null},kind:'motor',documents:docOf('zllg'),
 connectors:[{id:'POWER',label:'Motor lead U/V/W',matingPart:null,pins:[pin('1','U','motor_phase',src('zllg','drawing V3.15, 8015D terminal wiring: pin 1 yellow U')),pin('2','V','motor_phase',src('zllg','drawing V3.15: pin 2 green V')),pin('3','W','motor_phase',src('zllg','drawing V3.15: pin 3 blue W'))]},
  {id:'SIGNAL',label:'Encoder and HALL lead',matingPart:null,pins:[pin('1','ENC','encoder',src('zllg','drawing V3.15, 12-pin signal terminal (encoder A/B, thermistor, HALL U/V/W, +5 V, GND), 4096 lines'))]}],
 ioPoints:[],interfaces:[],drive:null});

// ---------- Reference devices without a pinned document: every value is `assumed` and says so; their profiles stay at `candidate`.
const ID:{xyzM:[number,number,number];quaternionXyzw:[number,number,number,number]}={xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]};
const A=(why:string)=>assumedSrc(why);
type AssumedPoint=ReturnType<typeof apoint>;
const apoint=(pointId:string,direction:'input'|'output',pinRef:string,common:string|null,type:'pnp_sink_input'|'pnp_source_output'|'dry_contact_input',volts:[number,number],amps:number|null,fn:string,exposure:{kind:'cyclic'|'acyclic'|'none';object:string|null;bit:number|null;periodMs:number|null},why:string)=>({pointId,direction,pin:pinRef,commonPin:common,
 electrical:{type,voltageRangeV:volts,maxCurrentA:amps===null?null:sc(amps,'A',A(why))},functions:[fn],defaultFunction:fn,reassignable:false,assignmentPersistence:'fixed' as const,
 busExposure:{kind:exposure.kind,object:exposure.object,bit:exposure.bit,precondition:null,updatePeriodMs:exposure.periodMs},safety:null,source:A(why)});
interface Spec{id:string;kind:DeviceProfileV1['kind'];family:string;sku:string;ports?:{id:string;direction:'in'|'out';volts:[number,number];amps:number}[];connectors:{id:string;label:string;pins:[string,string,string,string|null][]}[];points?:AssumedPoint[];interfaces?:DeviceProfileV1['interfaces'][number][]}
const assumedDevice=(sp:Spec)=>{
 const why=`reference device ${sp.id}: values are planning assumptions until a part is chosen`;
 const comp={...component(`ref-${sp.id}`,sp.family,sp.sku,[],'MEKONIQ reference'),ports:(sp.ports??[]).map(q=>({id:q.id,kind:'power',frame:ID,mate:'dc-bus',direction:q.direction,voltageRangeV:q.volts,continuousCurrentA:sc(q.amps,'A',A(why))}))};
 const profile=sealElectrical<Omit<DeviceProfileV1,'digest'>>({schemaVersion:1,documentType:'device-profile',id:`${sp.id}-v1`,revision:1,component:{id:comp.id,revision:'1',digest:cDigest(comp)},variant:{orderCode:null,hardwareRevision:null,firmware:null},kind:sp.kind,documents:[],
  connectors:sp.connectors.map(c=>({id:c.id,label:c.label,matingPart:null,pins:c.pins.map(([n,name,role,port])=>({pin:n,name,role,portId:port,source:A(why)}))})) as DeviceProfileV1['connectors'],
  ioPoints:(sp.points??[]) as unknown as DeviceProfileV1['ioPoints'],interfaces:sp.interfaces??[],drive:null});
 return {component:comp,profile};
};
const canIf=(id='can0')=>({id,portId:'CAN',protocol:'canopen' as const,profile:null,descriptionDocumentId:null,source:A('CAN bus interface, planning assumption')});
const fuse=(amps:number)=>assumedDevice({id:`fuse-${amps}a`,kind:'protection',family:`inline fuse holder ${amps} A`,sku:`FUSE-${amps}A`,connectors:[{id:'F',label:'Fuse',pins:[['IN','IN','power',null],['OUT','OUT','power',null]]}],
 points:[apoint('RATED','output','F/OUT','F/IN','pnp_source_output',[0,60],amps,'protection_rating',{kind:'none',object:null,bit:null,periodMs:null},`rated current of the fuse is ${amps} A (the rating is carried as the maximum current of this point)`)]});
const diPoints=Array.from({length:16},(_,i)=>apoint(`DI${i}`,'input',`IO/DI${i}`,'IO/COM','pnp_sink_input',[12,30],null,'general_purpose',{kind:'cyclic',object:'6000:01',bit:i,periodMs:null},'16-channel PNP input block, planning assumption'));
const doPoints=Array.from({length:4},(_,i)=>apoint(`DO${i}`,'output',`IO/DO${i}`,'IO/COM','pnp_source_output',[18,30],0.5,'general_purpose',{kind:'cyclic',object:'6200:01',bit:i,periodMs:null},'4-channel PNP output block, 0.5 A per channel, planning assumption'));
const REF=[
 assumedDevice({id:'controller-ref',kind:'compute',family:'embedded controller (CAN, Ethernet)',sku:'CTRL-REF',ports:[{id:'vin',direction:'in',volts:[9,36],amps:2}],connectors:[{id:'PWR',label:'Supply',pins:[['VIN','VIN','power','vin'],['GND','GND','return',null]]},{id:'CAN',label:'CAN',pins:[['CANH','CANH','bus',null],['CANL','CANL','bus',null],['GND','CAN GND','return',null]]}],interfaces:[canIf()]}),
 assumedDevice({id:'io-module-can-ref',kind:'io_module',family:'CANopen remote I/O 16 DI / 4 DO, 24 V',sku:'IOM-REF',ports:[{id:'vin',direction:'in',volts:[18,30],amps:0.3}],connectors:[{id:'PWR',label:'Supply',pins:[['VIN','VIN','power','vin'],['GND','GND','return',null]]},{id:'CAN',label:'CAN',pins:[['CANH','CANH','bus',null],['CANL','CANL','bus',null],['GND','CAN GND','return',null]]},
   {id:'IO',label:'Field I/O',pins:[...Array.from({length:16},(_,i)=>[`DI${i}`,`DI${i}`,'di',null] as [string,string,string,string|null]),...Array.from({length:4},(_,i)=>[`DO${i}`,`DO${i}`,'do',null] as [string,string,string,string|null]),['COM','COM','return',null]]}],points:[...diPoints,...doPoints],interfaces:[canIf()]}),
 assumedDevice({id:'battery-24v-pack',kind:'battery',family:'24 V battery pack',sku:'BAT-REF',ports:[{id:'out',direction:'out',volts:[22,29],amps:40}],connectors:[{id:'OUT',label:'Output',pins:[['POS','POS','power','out'],['NEG','NEG','return',null]]}]}),
 fuse(5),fuse(10),fuse(20),
 assumedDevice({id:'estop-button',kind:'safety_device',family:'emergency stop push button, 2 NC',sku:'ESTOP-REF',connectors:[{id:'C',label:'Contacts',pins:[['S1','S1','sto',null],['S2','S2','sto',null],['S3','S3','sto',null],['S4','S4','sto',null]]}]}),
 assumedDevice({id:'safety-relay',kind:'safety_device',family:'safety relay (external to the drives)',sku:'SAFRLY-REF',ports:[{id:'vin',direction:'in',volts:[18,30],amps:0.1}],connectors:[{id:'C',label:'Terminals',pins:[['A1','A1','power','vin'],['A2','A2','return',null],['S11','S11','sto',null],['S12','S12','sto',null],['S21','S21','sto',null],['S22','S22','sto',null],['13','13','sto',null],['14','14','sto',null],['23','23','sto',null],['24','24','sto',null],['S33','S33','di',null],['S34','S34','di',null]]}]}),
 assumedDevice({id:'contactor',kind:'switch',family:'DC contactor',sku:'CONT-REF',ports:[{id:'vin',direction:'in',volts:[18,30],amps:0.3}],connectors:[{id:'C',label:'Terminals',pins:[['A1','A1','power','vin'],['A2','A2','return',null],['1L1','1L1','power',null],['2T1','2T1','power',null]]}]}),
 assumedDevice({id:'switch-dry-contact',kind:'switch',family:'bumper or cover switch, potential-free contact',sku:'SW-REF',connectors:[{id:'C',label:'Contact',pins:[['1','1','di',null],['2','2','return',null]]}]}),
 assumedDevice({id:'sensor-pnp-24v',kind:'sensor',family:'3-wire PNP proximity or cliff sensor, 24 V',sku:'SNS-REF',ports:[{id:'vin',direction:'in',volts:[10,30],amps:0.02}],connectors:[{id:'C',label:'Cable',pins:[['BN','BN +V','power','vin'],['BU','BU 0 V','return',null],['BK','BK out','do',null]]}]}),
 assumedDevice({id:'lamp-24v',kind:'indicator',family:'status lamp, 24 V',sku:'LAMP-REF',ports:[{id:'vin',direction:'in',volts:[18,30],amps:0.1}],connectors:[{id:'C',label:'Terminals',pins:[['1','+','power','vin'],['2','-','return',null]]}]}),
 assumedDevice({id:'buzzer-24v',kind:'indicator',family:'buzzer, 24 V',sku:'BUZ-REF',ports:[{id:'vin',direction:'in',volts:[18,30],amps:0.05}],connectors:[{id:'C',label:'Terminals',pins:[['1','+','power','vin'],['2','-','return',null]]}]})];

const DEVICES=[...REF,{component:driverComponent,profile:blvdProfile},{component:motorComponent,profile:motorProfile},{component:zlacComponent,profile:zlacProfile},{component:zllgComponent,profile:zllgProfile}];

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
