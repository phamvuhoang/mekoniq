// Deterministic generator for robotics/catalog/electrical/: three hardware options for the Serve project, one wiring policy, one safety register.
// Profile digests come from robotics/catalog/devices; the project identity comes from the Serve tray fixture. Run: pnpm exec tsx scripts/generate-electrical-fixture.mts
import {createHash} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sealElectrical} from '../packages/lab-runtime/src/engineering/electrical/contracts';
import type {ElectricalDesignV1,SafetyRequirementsV1,SignalV1,WiringPolicyV1,DeviceProfileV1} from '../packages/lab-runtime/src/engineering/electrical/contracts';
import type {SourceRef} from '../packages/lab-runtime/src/engineering/contracts';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const assumed=(locator:string):SourceRef=>({kind:'assumed',documentId:'r5-assumptions',revision:'1',locator,contentSha256:sha('r5-assumptions v1')});
const sc=(value:number,unit:string,why:string)=>({value,unit,source:assumed(why)});

export async function generateElectricalFixture(outDir:string):Promise<void>{
 const devDir=join(ROOT,'robotics/catalog/devices'),profiles=new Map<string,DeviceProfileV1>();
 for(const f of (await readdir(devDir)).sort())if(f.endsWith('.json')){const p=JSON.parse(await readFile(join(devDir,f),'utf8')) as DeviceProfileV1;profiles.set(p.id,p);}
 const ref=(id:string)=>{const p=profiles.get(id);if(!p)throw new Error(`PROFILE_MISSING ${id}`);return {id:p.id,revision:p.revision,digest:p.digest};};
 const project=JSON.parse(await readFile(join(ROOT,'robotics/simulation-mujoco/fixtures/serve-tray-v1/serve-3d-project.json'),'utf8')) as {id:string;revision:number};

 const policy=sealElectrical<Omit<WiringPolicyV1,'digest'>>({schemaVersion:1,documentType:'wiring-policy',id:'wiring-policy-v1',revision:1,
  ampacity:[[0.25,2],[0.5,5],[0.75,8],[1,10],[1.5,15],[2.5,20],[4,28]].map(([c,a])=>({csaMm2:c!,maxCurrentA:sc(a!,'A',`planning table, not a standard value; to be replaced from a pinned wire datasheet (${c} mm2)`)})),
  signalMinCsaMm2:0.25,maxVoltageDropFraction:sc(0.03,'1','planning limit of 3 % on a 24 V rail'),copperResistivityOhmMm2PerM:0.0175,
  colours:[{role:'power',colour:'red'},{role:'return',colour:'black'},{role:'signal',colour:'white'},{role:'bus_high',colour:'yellow'},{role:'bus_low',colour:'green'},{role:'protective_earth',colour:'green-yellow'}],
  sources:{ampacity:assumed('ampacity table is a planning assumption'),drop:assumed('voltage drop limit is a planning assumption')}}) as WiringPolicyV1;
 const pol={id:policy.id,revision:policy.revision,digest:policy.digest};

 const manual=(await import('node:fs')).readFileSync(join(devDir,'blvd-krd-v1.json'),'utf8');
 const hp5140=(JSON.parse(manual) as DeviceProfileV1).documents.find(d=>d.id==='hp5140')!;
 const safety=sealElectrical<Omit<SafetyRequirementsV1,'digest'>>({schemaVersion:1,documentType:'safety-requirements',id:'serve-safety-requirements-v1',revision:1,requirements:[
  {id:'req-estop',function:'emergency stop removes torque from both wheels through the power-removal inputs of the two drives',trigger:'emergency stop button, two normally closed channels, through a safety relay',stopCategory:0,deviceIds:['estop-button','safety-relay','drive-left','drive-right'],signalIds:['estop-chain','sto-left','sto-right'],documents:[hp5140 as never],
   notes:'The drive manual asks for a risk assessment and a verification test of the power-removal function (HP-5140-8E p.7). No certificate for BLVD-KRD is pinned and no risk assessment exists. A person responsible for safety must complete this register.'},
  {id:'req-estop-contactor',function:'emergency stop opens the drive supply through a contactor, because the ZLAC8015D has no torque-off input',trigger:'emergency stop button, two normally closed channels, through a safety relay and a contactor',stopCategory:0,deviceIds:['estop-button','safety-relay','contactor'],signalIds:['estop-chain','sto-left','sto-right'],documents:[],
   notes:'Opening the supply of a drive that regenerates needs a bleeder resistor (ZLAC8015D manual 3.6). No document supports the contactor arrangement yet; it is a question for the hardware lead.'}]}) as SafetyRequirementsV1;
 const sref={id:safety.id,revision:safety.revision,digest:safety.digest};

 const sig=(id:string,role:SignalV1['role'],direction:SignalV1['direction'],dev:string,pin:string,ret:string|null,type:SignalV1['electrical']['type'],amps:number,consumer:SignalV1['consumer'],latency:number|null,required=true):SignalV1=>({id,label:id.replace(/-/g,' '),role,direction,field:{deviceId:dev,pin,returnPin:ret},
  electrical:{type,nominalV:24,currentA:sc(amps,'A','planning estimate until a part is chosen')},consumer,maxLatencyMs:latency,required,pinned:null});
 const commonSignals=(brake:{dev:string;pin:string;ret:string|null},sto:{left:[string,string,string];right:[string,string,string]})=>[
  sig('bumper-front','bumper','input','bumper-front-sw','1','2','relay_output',0.005,'controller',50),sig('bumper-left','bumper','input','bumper-left-sw','1','2','relay_output',0.005,'controller',50),sig('bumper-right','bumper','input','bumper-right-sw','1','2','relay_output',0.005,'controller',50),
  sig('cliff-left','cliff','input','cliff-left-sn','BK',null,'pnp_source_output',0.01,'controller',50),sig('cliff-right','cliff','input','cliff-right-sn','BK',null,'pnp_source_output',0.01,'controller',50),
  sig('dock-detect','dock_detect','input','dock-sn','BK',null,'pnp_source_output',0.01,'controller',200),sig('cover-switch','cover_switch','input','cover-sw','1','2','relay_output',0.005,'controller',200),
  sig('estop-status','estop_status','input','safety-relay','S33','S34','relay_output',0.005,'controller',100),sig('charger-present','charger_present','input','charger-sn','BK',null,'pnp_source_output',0.01,'controller',500),
  sig('lamp-status','lamp','output','lamp','1','2','pnp_sink_input',0.1,'controller',500),sig('buzzer','buzzer','output','buzzer','1','2','pnp_sink_input',0.05,'controller',500),
  sig('brake-release','brake_release','output',brake.dev,brake.pin,brake.ret,'pnp_sink_input',0.5,'drive_local',null,false),
  sig('estop-chain','safety','input','estop-button','S1','S2','relay_output',0.02,'safety_chain',null),
  sig('sto-left','safety','output',sto.left[0],sto.left[1],sto.left[2],'pnp_sink_input',0.005,'safety_chain',null),sig('sto-right','safety','output',sto.right[0],sto.right[1],sto.right[2],'pnp_sink_input',0.005,'safety_chain',null)];
 const field=[['bumper-front-sw','switch-dry-contact-v1'],['bumper-left-sw','switch-dry-contact-v1'],['bumper-right-sw','switch-dry-contact-v1'],['cover-sw','switch-dry-contact-v1'],['cliff-left-sn','sensor-pnp-24v-v1'],['cliff-right-sn','sensor-pnp-24v-v1'],['dock-sn','sensor-pnp-24v-v1'],['charger-sn','sensor-pnp-24v-v1'],['lamp','lamp-24v-v1'],['buzzer','buzzer-24v-v1']] as const;
 const feed=(id:string,device:string,pinA:string,pinB:string,fuseId:string,m:number)=>({id,to:{deviceId:device,pin:pinA,returnPin:pinB},protectionDeviceId:fuseId,lengthM:sc(m,'m','estimated from a 0.5 m chassis; measure on the first build')});
 const logicFeeds=(io:boolean,relay=true)=>[feed('f-controller','controller','PWR/VIN','PWR/GND','fuse-logic',0.4),...(io?[feed('f-io','io-module','PWR/VIN','PWR/GND','fuse-logic',0.4)]:[]),...(relay?[feed('f-safety','safety-relay','C/A1','C/A2','fuse-logic',0.4)]:[]),
  ...(['cliff-left-sn','cliff-right-sn','dock-sn','charger-sn'] as const).map(d=>feed('f-'+d,d,'C/BN','C/BU','fuse-logic',0.8))];
 const base=(id:string,label:string,rationale:string,devices:{id:string;profile:string}[],axes:ElectricalDesignV1['axes'],buses:ElectricalDesignV1['buses'],power:ElectricalDesignV1['power'],signals:SignalV1[],stops:ElectricalDesignV1['stopFunctions'])=>sealElectrical({schemaVersion:1,documentType:'electrical-design',id,revision:1,project:{id:project.id,revision:project.revision},option:{id:id.replace(/^serve-|-v1$/g,''),label,rationale},
  devices:devices.map(d=>({id:d.id,profile:ref(d.profile),assemblyInstanceId:null})),axes,buses,power,signals,stopFunctions:stops,safetyRequirementsRef:sref,wiringPolicyRef:pol}) as ElectricalDesignV1;
 const common=[{id:'controller',profile:'controller-ref-v1'},{id:'battery',profile:'battery-24v-pack-v1'},{id:'estop-button',profile:'estop-button-v1'},{id:'safety-relay',profile:'safety-relay-v1'},{id:'fuse-logic',profile:'fuse-5a-v1'},...field.map(([id,profile])=>({id,profile}))];
 const rail=(feeds:ElectricalDesignV1['power'][number]['feeds'])=>[{railId:'rail-24v',nominalV:24,source:{deviceId:'battery',pin:'OUT/POS',returnPin:'OUT/NEG'},feeds}];
 const stops=(axes:string[],requirementId:string):ElectricalDesignV1['stopFunctions']=>[{id:'normal',trigger:{kind:'operator'},axes,finalState:'hold',requirementId:null},{id:'protective',trigger:{kind:'signal',signalId:'bumper-front'},axes,finalState:'disabled',requirementId:null},{id:'emergency',trigger:{kind:'signal',signalId:'estop-chain'},axes,finalState:'torque_off_coast',requirementId}];
 const bothAxes=['amr-1/wheel-left','amr-1/wheel-right'];
 const blvdAxes:ElectricalDesignV1['axes']=[{axisId:'amr-1/wheel-left',driveDeviceId:'drive-left',channel:0,motorDeviceId:'motor-left'},{axisId:'amr-1/wheel-right',driveDeviceId:'drive-right',channel:0,motorDeviceId:'motor-right'}];
 const blvdDevices=[{id:'drive-left',profile:'blvd-krd-v1'},{id:'drive-right',profile:'blvd-krd-v1'},{id:'motor-left',profile:'blv-r-60w-v1'},{id:'motor-right',profile:'blv-r-60w-v1'},{id:'fuse-drive-left',profile:'fuse-10a-v1'},{id:'fuse-drive-right',profile:'fuse-10a-v1'}];
 const blvdFeeds=[feed('f-drive-left','drive-left','CN1/1','CN1/2','fuse-drive-left',0.6),feed('f-drive-right','drive-right','CN1/1','CN1/2','fuse-drive-right',0.6)];
 const blvdSignals=()=>commonSignals({dev:'motor-left',pin:'ENC/1',ret:null},{left:['drive-left','CN4/11','CN4/12'],right:['drive-right','CN4/26','CN4/27']});
 const bus=(members:ElectricalDesignV1['buses'][number]['members'])=>[{id:'can0',protocol:'canopen' as const,controllerDeviceId:'controller',cycleMs:10,members}];
 const optionA=base('serve-hw-a-v1','HW-A: BLV-R 60 W drives, I/O on the drives','Right-sized 60 W motors with the manufacturer drive; tests whether the drive I/O is usable for the robot signals.',
  [...common,...blvdDevices],blvdAxes,bus([{deviceId:'controller',interfaceId:'can0',address:null},{deviceId:'drive-left',interfaceId:'can0',address:1},{deviceId:'drive-right',interfaceId:'can0',address:2}]),rail([...blvdFeeds,...logicFeeds(false)]),blvdSignals(),stops(bothAxes,'req-estop'));
 const optionC=base('serve-hw-c-v1','HW-C: BLV-R 60 W drives, separate I/O module','Same drives as HW-A; every controller signal goes through one CANopen I/O module.',
  [...common,...blvdDevices,{id:'io-module',profile:'io-module-can-ref-v1'}],blvdAxes,bus([{deviceId:'controller',interfaceId:'can0',address:null},{deviceId:'drive-left',interfaceId:'can0',address:1},{deviceId:'drive-right',interfaceId:'can0',address:2},{deviceId:'io-module',interfaceId:'can0',address:3}]),rail([...blvdFeeds,...logicFeeds(true)]),blvdSignals(),stops(bothAxes,'req-estop'));
 const optionB=base('serve-hw-b-v1','HW-B: ZLAC8015D with hub wheels and an I/O module','Commodity dual-channel driver and 24 V hub wheels; no torque-off input, so an external contactor and safety relay carry the emergency stop.',
  [...common,{id:'drive',profile:'zlac8015d-v1'},{id:'hub-left',profile:'zllg65asm250-v1'},{id:'hub-right',profile:'zllg65asm250-v1'},{id:'io-module',profile:'io-module-can-ref-v1'},{id:'contactor',profile:'contactor-v1'},{id:'fuse-drive',profile:'fuse-20a-v1'}],
  [{axisId:'amr-1/wheel-left',driveDeviceId:'drive',channel:0,motorDeviceId:'hub-left'},{axisId:'amr-1/wheel-right',driveDeviceId:'drive',channel:1,motorDeviceId:'hub-right'}],
  bus([{deviceId:'controller',interfaceId:'can0',address:null},{deviceId:'drive',interfaceId:'can0',address:1},{deviceId:'io-module',interfaceId:'can0',address:2}]),
  rail([feed('f-drive','drive','PWR-L/1','PWR-L/2','fuse-drive',0.6),feed('f-contactor','contactor','C/A1','C/A2','fuse-logic',0.4),...logicFeeds(true)]),
  commonSignals({dev:'drive',pin:'J3/3',ret:'J3/1'},{left:['contactor','A1','A2'],right:['contactor','1L1','2T1']}),stops(bothAxes,'req-estop-contactor'));

 const files:Record<string,unknown>={'serve-hw-a-v1.json':optionA,'serve-hw-b-v1.json':optionB,'serve-hw-c-v1.json':optionC,'wiring-policy-v1.json':policy,'serve-safety-requirements-v1.json':safety};
 await mkdir(outDir,{recursive:true});
 const out:Record<string,string>={};
 for(const [name,doc] of Object.entries(files))out[name]=JSON.stringify(doc,null,2)+'\n';
 out['README.md']=README;
 const manifest={schemaVersion:1,note:'generated by scripts/generate-electrical-fixture.mts; do not edit by hand',files:Object.keys(out).sort().map(path=>({path,sha256:sha(out[path]!),bytes:Buffer.byteLength(out[path]!)}))};
 out['manifest.json']=JSON.stringify(manifest,null,2)+'\n';
 for(const [name,text] of Object.entries(out))await writeFile(join(outDir,name),text);
}
const README=`# Serve electrical options (R5)

Three hardware options for the Serve project, one wiring policy and one safety register. Generated by \`scripts/generate-electrical-fixture.mts\`; the device profiles are in \`../devices\`.

| File | What it is |
|---|---|
| serve-hw-a-v1.json | BLV-R 60 W drives; all controller signals expected on the drive I/O |
| serve-hw-b-v1.json | ZLAC8015D with hub wheels, a CANopen I/O module, a contactor and a safety relay |
| serve-hw-c-v1.json | Same drives as A with one CANopen I/O module |
| wiring-policy-v1.json | Cross-section and voltage-drop policy; every value is \`assumed\` |
| serve-safety-requirements-v1.json | Register of safety requirements, to be completed by a person responsible for safety |

All three designs carry the same signal ids. They are planning fixtures: nothing here is validated on hardware and nothing states a safety level. Fuses are modelled as devices whose single \`RATED\` point carries the fuse rating as its maximum current.
`;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateElectricalFixture(join(ROOT,'robotics/catalog/electrical'));
