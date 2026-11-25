// Electrical section view model (R5.4): pure, no DOM. The server's bundle is the only authority: levels, counts and check results are copied, never recomputed here.
import type {DeviceProfileV1,ElectricalBundleV1,ElectricalDesignV1,TcoComparisonV1} from '../shared/engineering';
import hw from '../../fixtures/engineering/serve-electrical-v1/serve-hw-a-v1.json' with {type:'json'};
import hwB from '../../fixtures/engineering/serve-electrical-v1/serve-hw-b-v1.json' with {type:'json'};
import hwC from '../../fixtures/engineering/serve-electrical-v1/serve-hw-c-v1.json' with {type:'json'};

export const ELECTRICAL_CAPABILITY='electrical_bundle_v1';
export type CheckLevel='blocking'|'warning'|'unverified';
export interface ElectricalView {state:'no_runtime'|'unsupported'|'idle'|'compiling'|'compiled'|'blocked'|'rejected';
 option:{id:string;label:string}|null;
 devices:{id:string;label:string;orderCode:string|null;firmware:string|null;level:'candidate'|'documented';assumedSources:number}[];
 checks:{level:CheckLevel;ruleId:string;path:string;detail:string}[];
 counts:{blocking:number;warning:number;unverified:number};rejection:string[]}

/** Profiles of the shipped fixture, by id: the labels and order codes of the device table. Levels never come from here. */
const profileFiles=import.meta.glob('../../fixtures/engineering/serve-electrical-v1/devices/*.json',{eager:true,import:'default'}) as Record<string,DeviceProfileV1>;
export const SHIPPED_PROFILES=new Map(Object.values(profileFiles).map(p=>[p.id,p]));

const countAssumed=(p:DeviceProfileV1|undefined)=>p?JSON.stringify(p).split('"kind":"assumed"').length-1:0;
export function electricalView(input:{capabilities:readonly string[]|null;bundle:ElectricalBundleV1|null;design?:ElectricalDesignV1|null;rejection:string[]|null;busy:boolean;profiles?:ReadonlyMap<string,DeviceProfileV1>}):ElectricalView{
 const empty={option:null,devices:[],checks:[],counts:{blocking:0,warning:0,unverified:0},rejection:[]};
 if(input.capabilities===null)return {state:'no_runtime',...empty};
 if(!input.capabilities.includes(ELECTRICAL_CAPABILITY))return {state:'unsupported',...empty};
 if(input.busy)return {state:'compiling',...empty};
 if(input.rejection?.length)return {state:'rejected',...empty,rejection:[...input.rejection]};
 const b=input.bundle;if(!b)return {state:'idle',...empty};
 const profiles=input.profiles??SHIPPED_PROFILES,design=input.design??null;
 const counts={blocking:0,warning:0,unverified:0};for(const c of b.checks)counts[c.level]++;
 const devices=b.inputs.profiles.map(p=>{const pr=profiles.get(p.id),dev=design?.devices.find(d=>d.profile.id===p.id);
  return {id:dev?.id??p.id,label:pr?.component.id??p.id,orderCode:pr?.variant.orderCode??null,firmware:pr?.variant.firmware??null,level:p.evidenceLevel,assumedSources:countAssumed(pr)};});
 const checks=b.checks.map(c=>({level:c.level,ruleId:c.ruleId,path:c.path,detail:c.detail}));
 return {state:b.state,option:design?{id:design.option.id,label:design.option.label}:null,devices,checks,counts,rejection:[]};
}
export function serveOptions():{id:string;label:string;design:ElectricalDesignV1}[]{
 return ([hw,hwB,hwC] as unknown as ElectricalDesignV1[]).map(d=>({id:d.id,label:d.option.label,design:d}));
}
/** A new design with one signal pinned to a point (or unpinned with null); revision + 1; the argument is not changed. The digest is the server's to recompute. */
export function pinSignal(design:ElectricalDesignV1,signalId:string,target:{deviceId:string;pointId:string}|null):ElectricalDesignV1{
 if(!design.signals.some(s=>s.id===signalId))throw new Error('SIGNAL_UNKNOWN');
 const next=structuredClone(design);next.revision=design.revision+1;
 const s=next.signals.find(x=>x.id===signalId)!;(s as {pinned:unknown}).pinned=target?{deviceId:target.deviceId,pointId:target.pointId}:null;
 return next;
}
export interface WireRow{id:string;netId:string;kind:string;from:string;to:string;csaMm2:number;colour:string;lengthM:number|null;currentA:number|null}
export function wireRows(bundle:ElectricalBundleV1,filter:{deviceId?:string;netId?:string}):WireRow[]{
 const kind=new Map(bundle.netlist.nets.map(n=>[n.id,n.kind]));
 return bundle.netlist.wires.filter(w=>(!filter.netId||w.netId===filter.netId)&&(!filter.deviceId||w.from.deviceId===filter.deviceId||w.to.deviceId===filter.deviceId))
  .map(w=>({id:w.id,netId:w.netId,kind:kind.get(w.netId)??'signal',from:`${w.from.deviceId}:${w.from.pin}`,to:`${w.to.deviceId}:${w.to.pin}`,csaMm2:w.csaMm2,colour:w.colour,lengthM:w.lengthM?.value??null,currentA:w.currentA?.value??null}));
}
/** Cost table rows: a total is shown only when the server says the options compare; missing prices are listed, never read as zero. */
export function costRows(c:TcoComparisonV1|null):{designId:string;total:number|null;comparable:boolean;missing:number}[]{
 return c?c.options.map(o=>({designId:o.designId,total:o.comparable?o.total:null,comparable:o.comparable,missing:o.missingPriceLineIds.length})):[];
}
