import type {DesignContext} from './design';
import type {CheckResult,IoAllocationV1,NetlistV1,SafetyRequirementsV1,WiringPolicyV1,DeviceProfileV1,ElectricalDesignV1} from './contracts';
import type {SourceRef} from '../contracts';

type Protocol=ElectricalDesignV1['buses'][number]['protocol'];
/** Signal names of the pin-level buses, in wiring order. USB, Ethernet and EtherCAT are moulded cables: one cable line, no wires. */
export const BUS_SIGNALS:Readonly<Partial<Record<Protocol,readonly string[]>>>={canopen:['CAN_H','CAN_L','CAN_GND'],modbus_rtu:['A','B','GND']};
type Node={deviceId:string;pin:string};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const nk=(n:Node)=>`${n.deviceId}.${n.pin}`;
/** Stable wire id: net id plus the two end points in sorted order, so adding an unrelated signal never renames a wire. */
export const wireId=(netId:string,a:Node,b:Node)=>{const [x,y]=[nk(a),nk(b)].sort(cmp);return `${netId}:${x}~${y}`;};
const chk=(ruleId:string,level:CheckResult['level'],path:string,detail:string,sources:SourceRef[]=[]):CheckResult=>({ruleId,level,path,detail,sources});

/** 'connector/pin' exactly, or a bare pin id when exactly one connector has it; returns the canonical 'connector/pin' or null. */
export function resolvePin(profile:DeviceProfileV1,ref:string):string|null{
 if(ref.includes('/'))return profile.connectors.some(c=>ref.startsWith(c.id+'/')&&c.pins.some(p=>`${c.id}/${p.pin}`===ref))?ref:null;
 const hits=profile.connectors.flatMap(c=>c.pins.filter(p=>p.pin===ref).map(p=>`${c.id}/${p.pin}`));
 return hits.length===1?hits[0]!:null;
}
const norm=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,'');
const pinOf=(profile:DeviceProfileV1,canonical:string)=>profile.connectors.flatMap(c=>c.pins.map(p=>({...p,canonical:`${c.id}/${p.pin}`}))).find(p=>p.canonical===canonical);

/** Port current of a power pin (continuous current of the component port the pin names), or null when the profile or component does not say. */
export function pinCurrent(context:DesignContext,deviceId:string,canonical:string){
 const p=context.profiles.get(deviceId),pin=p&&pinOf(p,canonical),port=pin?.portId?context.components?.[p!.component.digest]?.ports.find(q=>q.id===pin.portId):undefined;
 return port?.continuousCurrentA??null;
}
export function pinVoltage(context:DesignContext,deviceId:string,canonical:string):[number,number]|null{
 const p=context.profiles.get(deviceId),pin=p&&pinOf(p,canonical),port=pin?.portId?context.components?.[p!.component.digest]?.ports.find(q=>q.id===pin.portId):undefined;
 return (port?.voltageRangeV as [number,number]|undefined)??null;
}

export function deriveNetlist(context:DesignContext,allocation:IoAllocationV1,policy:WiringPolicyV1,safety:SafetyRequirementsV1|null):{netlist:NetlistV1;checks:CheckResult[]}{
 const {design,profiles}=context,checks:CheckResult[]=[],nets=new Map<string,{kind:NetlistV1['nets'][number]['kind'];nodes:Map<string,Node>;reviewRequired:boolean}>();
 const wires=new Map<string,NetlistV1['wires'][number]>(),cables:NetlistV1['cables']=[];
 const derived=(locator:string):SourceRef=>({kind:'derived',documentId:'electrical-compiler',revision:'1',locator,contentSha256:design.digest});
 const colour=(role:string)=>policy.colours.find(c=>c.role===role)?.colour??'unspecified';
 const csaFor=(amps:number|null)=>amps===null?policy.ampacity[0]!.csaMm2:(policy.ampacity.find(r=>r.maxCurrentA.value>=amps)??policy.ampacity[policy.ampacity.length-1]!).csaMm2;
 const net=(id:string,kind:NetlistV1['nets'][number]['kind'],reviewRequired=false)=>{let n=nets.get(id);if(!n){n={kind,nodes:new Map(),reviewRequired};nets.set(id,n);}return n;};
 /** Resolves a pin of a device; an unknown pin is a blocking check and returns null. */
 const pin=(deviceId:string,ref:string,path:string):Node|null=>{
  const p=profiles.get(deviceId),c=p?resolvePin(p,ref):null;
  if(!c){checks.push(chk('ELD_PIN_UNKNOWN','blocking',path,`${deviceId} has no pin ${ref}`));return null;}
  return {deviceId,pin:c};
 };
 const wire=(netId:string,kind:NetlistV1['nets'][number]['kind'],a:Node,b:Node,role:string,csa:number,currentA:number|null,lengthM:NetlistV1['wires'][number]['lengthM']=null)=>{
  const n=net(netId,kind);n.nodes.set(nk(a),a);n.nodes.set(nk(b),b);
  const id=wireId(netId,a,b),[from,to]=[a,b].sort((x,y)=>cmp(nk(x),nk(y)));
  if(!wires.has(id))wires.set(id,{id,netId,from:from!,to:to!,csaMm2:csa,csaSource:policy.sources.ampacity,colour:colour(role),lengthM,currentA:currentA===null?null:{value:currentA,unit:'A',source:derived('sum of the continuous currents of the loads behind this wire')}});
 };

 // power and return: source -> protection -> load; one return net per rail
 for(const [ri,rail] of design.power.entries()){
  const src=pin(rail.source.deviceId,rail.source.pin,`/power/${ri}/source/pin`),srcRet=pin(rail.source.deviceId,rail.source.returnPin,`/power/${ri}/source/returnPin`);
  const behind=new Map<string,number|null>();
  const loads=rail.feeds.map((f,fi)=>({f,fi,to:pin(f.to.deviceId,f.to.pin,`/power/${ri}/feeds/${fi}/to/pin`),ret:pin(f.to.deviceId,f.to.returnPin,`/power/${ri}/feeds/${fi}/to/returnPin`),amps:pinCurrent(context,f.to.deviceId,resolvePin(profiles.get(f.to.deviceId)!,f.to.pin)??'')?.value??null}));
  for(const l of loads)if(l.f.protectionDeviceId)behind.set(l.f.protectionDeviceId,(behind.get(l.f.protectionDeviceId)??0)+(l.amps??0));
  for(const {f,fi,to,ret,amps} of loads){
   const prot=f.protectionDeviceId,pp=prot?profiles.get(prot):undefined;
   if(src&&to){
    if(prot&&pp){
     const pin_in=pin(prot,'IN',`/power/${ri}/feeds/${fi}/protectionDeviceId`),pin_out=pin(prot,'OUT',`/power/${ri}/feeds/${fi}/protectionDeviceId`);
     if(pin_in&&pin_out){wire(`pwr/${rail.railId}`,'power',src,pin_in,'power',csaFor(behind.get(prot)??null),behind.get(prot)??null);wire(`pwr/${rail.railId}`,'power',pin_out,to,'power',csaFor(amps),amps,f.lengthM);}
    }else wire(`pwr/${rail.railId}`,'power',src,to,'power',csaFor(amps),amps,f.lengthM);
   }
   if(srcRet&&ret)wire(`ret/${rail.railId}`,'return',srcRet,ret,'return',csaFor(amps),amps,f.lengthM);
  }
 }
 // buses
 for(const [bi,bus] of design.buses.entries()){
  const names=BUS_SIGNALS[bus.protocol],seen=new Map<number,string>();
  const members=bus.members.map((m,mi)=>{
   const prof=profiles.get(m.deviceId),itf=prof?.interfaces.find(i=>i.id===m.interfaceId);
   if(!itf||itf.protocol!==bus.protocol)checks.push(chk('ELD_BUS_PROTOCOL_MISMATCH','blocking',`/buses/${bi}/members/${mi}`,`${m.deviceId} has no ${bus.protocol} interface named ${m.interfaceId}`,itf?[itf.source]:[]));
   if(m.address!==null){const prev=seen.get(m.address);if(prev)checks.push(chk('ELD_BUS_ADDRESS_DUPLICATE','blocking',`/buses/${bi}/members/${mi}/address`,`${m.deviceId} and ${prev} share address ${m.address} on ${bus.id}`));else seen.set(m.address,m.deviceId);}
   return {m,mi,prof,itf};
  });
  if(!names){
   const kind=bus.protocol==='usb'?'usb':bus.protocol==='ethernet'?'ethernet':'bus';
   members.slice(1).forEach((b,i)=>cables.push({id:`bus/${bus.id}/${members[i]!.m.deviceId}~${b.m.deviceId}`,kind,from:members[i]!.m.deviceId,to:b.m.deviceId,part:null}));
   continue;
  }
  for(const sig of names){
   const nodes=members.map(x=>{
    if(!x.prof)return null;
    const hit=x.prof.connectors.flatMap(c=>c.pins.map(p=>({c:c.id,p}))).find(({p})=>norm(p.name)===norm(sig)||(sig.endsWith('GND')&&p.role==='return'&&norm(p.name).endsWith('GND')&&norm(p.name).includes(norm(sig.replace(/GND$/,'')||'X')))||(sig==='CAN_GND'&&norm(p.name)==='CANGND'));
    if(hit)return {deviceId:x.m.deviceId,pin:`${hit.c}/${hit.p.pin}`} as Node;
    checks.push(chk(sig.endsWith('GND')?'ELD_BUS_GROUND_UNKNOWN':'ELD_PIN_UNKNOWN',sig.endsWith('GND')?'warning':'blocking',`/buses/${bi}/members/${x.mi}`,`${x.m.deviceId} has no ${sig} pin for ${bus.id}`));
    return null;
   });
   for(let i=0;i+1<nodes.length;i++){const a=nodes[i],b=nodes[i+1];if(a&&b)wire(`bus/${bus.id}/${sig}`,'bus',a,b,sig==='CAN_H'?'bus_high':sig==='CAN_L'?'bus_low':sig.endsWith('GND')?'return':'signal',policy.signalMinCsaMm2,null);}
  }
 }
 // signals: one wire to the point, and the return side joined per common pin
 const byId=new Map(design.signals.map(s=>[s.id,s]));
 for(const a of allocation.assigned){
  const s=byId.get(a.signalId)!,point=profiles.get(a.deviceId)!.ioPoints.find(p=>p.pointId===a.pointId)!,path=`/signals/${s.id}`;
  const fieldPin=pin(s.field.deviceId,s.field.pin,path+'/field/pin'),pointPin=pin(a.deviceId,point.pin,`/allocation/${s.id}`);
  if(fieldPin&&pointPin)wire(`sig/${s.id}`,'signal',fieldPin,pointPin,'signal',policy.signalMinCsaMm2,s.electrical.currentA.value);
  if(s.field.returnPin!==null){
   const rp=pin(s.field.deviceId,s.field.returnPin,path+'/field/returnPin');
   if(point.commonPin===null)checks.push(chk('ELD_PIN_UNKNOWN','blocking',path+'/field/returnPin',`${a.deviceId}/${a.pointId} has no common pin to return ${s.field.returnPin} to`));
   else{const cp=pin(a.deviceId,point.commonPin,`/allocation/${s.id}/commonPin`);if(rp&&cp)wire(`sigret/${a.deviceId}.${cp.pin}`,'return',rp,cp,'return',policy.signalMinCsaMm2,s.electrical.currentA.value);}
  }
 }
 // axes: motor and encoder cables only; pins are split only when a profile declares them
 for(const ax of design.axes)if(ax.motorDeviceId){
  cables.push({id:`axis/${ax.axisId}/motor`,kind:'motor',from:ax.driveDeviceId,to:ax.motorDeviceId,part:null},{id:`axis/${ax.axisId}/encoder`,kind:'encoder',from:ax.driveDeviceId,to:ax.motorDeviceId,part:null});
  net(`axis/${ax.axisId}`,'axis').nodes.set(ax.driveDeviceId,{deviceId:ax.driveDeviceId,pin:`ch${ax.channel}`});
  net(`axis/${ax.axisId}`,'axis').nodes.set(ax.motorDeviceId,{deviceId:ax.motorDeviceId,pin:'motor'});
 }
 // safety: end points written by the people who own the register; nothing is derived, no wire exists
 for(const r of safety?.requirements??[]){
  const sigs=r.signalIds.filter(id=>byId.has(id)&&byId.get(id)!.consumer==='safety_chain');
  if(!sigs.length||r.deviceIds.some(d=>!profiles.has(d)))continue;
  const n=net(`safety/${r.id}`,'safety',true);
  for(const id of sigs){const s=byId.get(id)!;for(const ref of [s.field.pin,s.field.returnPin]){if(ref===null)continue;const p=pin(s.field.deviceId,ref,`/signals/${id}/field`);if(p)n.nodes.set(nk(p),p);}}
 }
 // a pin may belong to one net only (safety nets are listed for review and excluded)
 const owner=new Map<string,string>();
 for(const [id,n] of [...nets].sort((a,b)=>cmp(a[0],b[0]))){
  if(n.kind==='safety'||n.kind==='axis')continue;
  for(const node of n.nodes.values()){const prev=owner.get(nk(node));if(prev&&prev!==id&&!(prev.startsWith('pwr/')&&id.startsWith('pwr/')))checks.push(chk('ELD_PIN_REUSED','blocking',`/netlist/${id}`,`${nk(node)} is in ${prev} and in ${id}`));else owner.set(nk(node),id);}
 }
 const outNets=[...nets].sort((a,b)=>cmp(a[0],b[0])).map(([id,n])=>({id,kind:n.kind,nodes:[...n.nodes.values()].sort((a,b)=>cmp(nk(a),nk(b))),reviewRequired:n.reviewRequired}));
 return {netlist:{nets:outNets,wires:[...wires.values()].sort((a,b)=>cmp(a.id,b.id)),cables:cables.sort((a,b)=>cmp(a.id,b.id))},checks:checks.sort((a,b)=>cmp(a.ruleId,b.ruleId)||cmp(a.path,b.path))};
}
