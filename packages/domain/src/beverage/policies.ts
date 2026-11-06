// Optional, revisioned recipe policies. These are declared models, never implicit food-safety or physical-cup guarantees.
import type {CommandEnvelope,JsonObject,Snapshot} from '../../../contracts/src/index';
import {fail,record,text} from '../restaurant-context';
import {decimal} from '../shared/exact-decimal';
import type {CoffeeRecipe} from './recipe';
import type {CoffeeJob,Measured} from './job';
interface Policy {revision:number;provenance:'measured'|'vendor_spec'|'assumed'|'illustrative'}
export interface CoffeePolicies {
 cup?:Policy&{capacityM3:string;headspaceM3:string;iceVolumeM3PerKg:string};
 milk?:Policy&{maxOpenMs:number;minTemperatureK:string;maxTemperatureK:string;temperatureMaxAgeMs:number};
 measurement?:Policy&{maxTargetMultiplier:string};
}
const DEC=/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/,SCALE=10n**18n;
const q=(s:string)=>decimal(s,18).units;
const positive=(v:unknown)=>typeof v==='string'&&DEC.test(v)&&q(v)>0n;
const period=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
export function validatePolicies(value:unknown):void {
 if(value===undefined)return;
 const policies=record(value as JsonObject);
 if(Object.keys(policies).some(k=>!['cup','milk','measurement'].includes(k)))fail('RECIPE_INVALID');
 for(const [kind,value] of Object.entries(policies)){
  const p=record(value);
  if(!period(p.revision)||!['measured','vendor_spec','assumed','illustrative'].includes(String(p.provenance)))fail('RECIPE_INVALID');
  if(kind==='cup'&&(!positive(p.capacityM3)||!positive(p.headspaceM3)||!positive(p.iceVolumeM3PerKg)||q(String(p.headspaceM3))>=q(String(p.capacityM3))))fail('RECIPE_INVALID');
  if(kind==='milk'&&(!period(p.maxOpenMs)||!period(p.temperatureMaxAgeMs)||!positive(p.minTemperatureK)||!positive(p.maxTemperatureK)||q(String(p.minTemperatureK))>q(String(p.maxTemperatureK))))fail('RECIPE_INVALID');
  if(kind==='measurement'&&(!positive(p.maxTargetMultiplier)||q(String(p.maxTargetMultiplier))<SCALE))fail('RECIPE_INVALID');
 }
}
/** Sum liquid upper targets and explicitly modelled ice displacement; no generic mass-to-volume conversion. */
export function checkCupCapacity(recipe:CoffeeRecipe,job?:CoffeeJob):void {
 const p=recipe.policies?.cup;if(!p)return;
 let volume=0n;
 for(const step of recipe.steps){
  if(!['brew','add_water','add_milk','add_ice'].includes(step.kind))continue;
  const actual=job?.steps.find(s=>s.id===step.id&&s.status==='completed')?.measured;
  const amount=actual?.unit===step.target?.unit?q(actual!.amount):step.target?q(step.target.amount)+q(step.target.tolerance):fail('CUP_FILL_UNKNOWN');
  if(step.kind==='add_ice'){
   if(step.target?.unit!=='kg')fail('CUP_FILL_UNKNOWN');
   volume+=(amount*q(p.iceVolumeM3PerKg)+SCALE-1n)/SCALE;
  }else{
   if(step.target?.unit!=='m3')fail('CUP_FILL_UNKNOWN');
   volume+=amount;
  }
 }
 if(volume>q(p.capacityM3)-q(p.headspaceM3))fail('CUP_CAPACITY_EXCEEDED');
}
/** The bound observer may report a replacement batch. Rebooting cannot rewrite this batch's opening time or erase a broken cold chain. */
export function observeMilkBatch(c:CommandEnvelope,d:Snapshot,value:unknown):JsonObject {
 if(d.state.role!=='milk')return fail('INVALID_OBSERVATION');
 const b=record(value as JsonObject),id=text(b.batchId),opened=Date.parse(String(b.openedAt)),now=Date.parse(c.recordedAt);
 if(!Number.isFinite(opened)||opened>now||typeof b.coldChainIntact!=='boolean')return fail('INVALID_MILK_BATCH');
 const old=d.state.milkBatch as JsonObject|undefined;
 if(old?.batchId===id&&old.openedAt!==b.openedAt)return fail('MILK_BATCH_OPEN_TIME_CHANGED');
 if(b.temperature!==null){
  const t=record(b.temperature),at=Date.parse(String(t.observedAt));
  if(!positive(t.amount)||t.unit!=='K'||!['measured','modelled','unknown'].includes(String(t.provenance))||!Number.isFinite(at)||at>now)return fail('INVALID_MILK_TEMPERATURE');
 }
 return {...b,batchId:id,coldChainIntact:old?.batchId===id&&old.coldChainIntact===false?false:b.coldChainIntact,observedBy:c.actorRef,observedAt:c.recordedAt};
}
export const simulatedEvidenceAllowed=(s:Snapshot[],d:Snapshot)=>((s.find(x=>x.ref.kind==='configuration'&&x.ref.id==='applied')?.state.beverage as JsonObject|undefined)?.allowModelledMeasurements===true)&&d.state.validation==='simulated';
export function checkMilkPolicy(c:CommandEnvelope,d:Snapshot,recipe:CoffeeRecipe,simulation=false):void {
 const p=recipe.policies?.milk;if(!p)return;
 const b=d.state.milkBatch as JsonObject|undefined;if(!b)return fail('MILK_BATCH_REQUIRED');
 const now=Date.parse(c.recordedAt),opened=Date.parse(String(b.openedAt));
 if(!Number.isFinite(opened)||opened>now||now-opened>p.maxOpenMs)fail('MILK_BATCH_EXPIRED');
 if(b.coldChainIntact!==true)fail('MILK_COLD_CHAIN_BROKEN');
 const t=b.temperature as JsonObject|null;
 if(!t||(t.provenance!=='measured'&&!(simulation&&t.provenance==='modelled'))||t.unit!=='K')return fail('MILK_TEMPERATURE_UNKNOWN');
 const at=Date.parse(String(t.observedAt));if(!Number.isFinite(at)||at>now||now-at>p.temperatureMaxAgeMs)fail('MILK_TEMPERATURE_STALE');
 if(q(String(t.amount))<q(p.minTemperatureK)||q(String(t.amount))>q(p.maxTemperatureK))fail('MILK_TEMPERATURE_OUT_OF_RANGE');
}
export function implausibleMeasurement(recipe:CoffeeRecipe,stepId:string,m:Measured|null):boolean {
 const p=recipe.policies?.measurement,t=recipe.steps.find(s=>s.id===stepId)?.target;
 return !!p&&!!m&&!!t&&m.unit===t.unit&&q(m.amount)*SCALE>q(t.amount)*q(p.maxTargetMultiplier);
}
