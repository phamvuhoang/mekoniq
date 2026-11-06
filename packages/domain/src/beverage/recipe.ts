// Coffee recipes: versioned, immutable, content-hashed (mekoniq.coffee-recipe.v2). Quantities are canonical SI decimal strings (kg, m3, K, s);
// arithmetic is ExactDecimal only. A recipe's order of brew/ice/milk is its own; nothing here assumes one sequence for every drink.
import {hashPayload} from '../../../contracts/src/canonical';
import type {JsonObject,JsonValue} from '../../../contracts/src/index';
import {fail,record} from '../restaurant-context';
import {compare,convertPow10,decimal,abs,subtract,rescale,DecimalError,type ExactDecimal} from '../shared/exact-decimal';
import {UNITS} from '../inventory/uom';
import {validatePolicies,type CoffeePolicies} from './policies';
export interface Amount {amount:string;tolerance:string;unit:'kg'|'m3'|'K'|'s';provenance:string}
export interface RecipeStep {id:string;kind:string;target:Amount|null;requires:string[];timeoutMs:number}
export interface RecipeResource {resourceId:string;kind:string;requiredAmount:Amount|null;allocations?:{stepId:string;amount:string}[]}
export interface CoffeeRecipe {schemaVersion:2;id:string;revision:number;hash:string;outputType:string;cupType:string;steps:RecipeStep[];resources:RecipeResource[];recovery:{onTimeout:string;autoRetry:false};policies?:CoffeePolicies}
const ID=/^[A-Za-z0-9_.:-]{1,200}$/,DEC=/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/,KINDS=['grind','brew','add_ice','add_milk','add_water','stir','clean'],RES=['water','coffee_beans','ice','milk','cup','machine'];
const PROV=['measured','vendor_spec','vendor_cad','assumed','illustrative'],UNIT=['kg','m3','K','s'];
/** Ingredients drawn from stock and eligible consuming step kinds; repeated steps reserve their own target quantities. */
export const STOCK_STEP:Record<string,string[]>={coffee_beans:['grind','brew'],water:['add_water','brew'],ice:['add_ice'],milk:['add_milk']};
/** Device role that executes each step kind inside one cell. */
export const STEP_DEVICE:Record<string,string>={grind:'machine',brew:'machine',add_water:'machine',add_ice:'ice',add_milk:'milk'};
export const recipeHash=(r:JsonObject)=>{const rest={...r};delete rest.hash;return hashPayload(rest as JsonValue);};
export const recipeKey=(id:string,revision:number)=>`${id}@${revision}`;
const amount=(v:JsonValue|undefined):Amount|null=>{
 if(v===null)return null;const a=record(v);
 if(!DEC.test(String(a.amount))||!DEC.test(String(a.tolerance))||!UNIT.includes(String(a.unit))||!PROV.includes(String(a.provenance))||Object.keys(a).length!==4)return fail('RECIPE_INVALID');
 return a as unknown as Amount;
};
/** Shape and identity check (the JSON schema's constraints that matter for execution, plus the content hash). */
export function parseRecipe(v:JsonValue|undefined):CoffeeRecipe {
 const r=record(v),steps=Array.isArray(r.steps)?r.steps.map(record):[],resources=Array.isArray(r.resources)?r.resources.map(record):[],recovery=record(r.recovery);
 if(r.schemaVersion!==2||!ID.test(String(r.id))||!Number.isSafeInteger(r.revision)||Number(r.revision)<1||!ID.test(String(r.outputType))||!ID.test(String(r.cupType)))return fail('RECIPE_INVALID');
 if(!steps.length||steps.length>50||resources.length>20||recovery.autoRetry!==false||!['hold_and_reconcile','quarantine'].includes(String(recovery.onTimeout)))return fail('RECIPE_INVALID');
 const ids=new Set<string>();
 for(const s of steps){
  if(!ID.test(String(s.id))||ids.has(String(s.id))||!KINDS.includes(String(s.kind))||!Number.isSafeInteger(s.timeoutMs)||Number(s.timeoutMs)<1||!Array.isArray(s.requires))return fail('RECIPE_INVALID');
  ids.add(String(s.id));amount(s.target);
 }
 const resourceIds=new Set<string>();
 for(const x of resources){
  if(!ID.test(String(x.resourceId))||resourceIds.has(String(x.resourceId))||!RES.includes(String(x.kind)))return fail('RECIPE_INVALID');
  resourceIds.add(String(x.resourceId));
  const need=amount(x.requiredAmount);
  if(need&&STOCK_STEP[String(x.kind)]&&!steps.some(s=>STOCK_STEP[String(x.kind)]!.includes(String(s.kind))))return fail('RECIPE_INVALID');
  if(x.allocations!==undefined){
   if(!need||!Array.isArray(x.allocations)||!x.allocations.length||x.allocations.length>steps.length)return fail('RECIPE_INVALID');
   const allocated=new Set<string>();
   for(const value of x.allocations){const a=record(value);if(!ids.has(String(a.stepId))||allocated.has(String(a.stepId))||!DEC.test(String(a.amount)))return fail('RECIPE_INVALID');allocated.add(String(a.stepId));}
  }
 }
 validatePolicies(r.policies);
 if(!/^[0-9a-f]{64}$/.test(String(r.hash))||recipeHash(r)!==r.hash)return fail('RECIPE_HASH_MISMATCH');
 return r as unknown as CoffeeRecipe;
}
const scaleOf=(s:string)=>(s.split('.')[1]??'').length;
/** Exact decimal of a canonical string at its own scale. */
export const exactOf=(s:string):ExactDecimal=>decimal(s,scaleOf(s));
/** |actual - target| <= tolerance, at the widest scale of the three; never a binary float. */
export function withinTolerance(actual:string,target:Amount):boolean {
 const scale=Math.max(scaleOf(actual),scaleOf(target.amount),scaleOf(target.tolerance)),at=(s:string)=>rescale(exactOf(s),scale);
 return compare(abs(subtract(at(actual),at(target.amount))),at(target.tolerance))<=0;
}
/** Canonical SI quantity -> whole stock base units (kg -> g/kg, m3 -> ml/l). Inexact or cross-dimension conversions are refused, never rounded. */
export function toStockBase(amountText:string,unit:string,item:JsonObject):bigint {
 const base=UNITS[String(item.baseUnit)],canonical:Record<string,{dimension:string;exp:number}>={kg:{dimension:'mass',exp:3},m3:{dimension:'volume',exp:6}};
 const from=canonical[unit];
 if(!from||!base||base.dimension!==from.dimension)return fail('UOM_CONVERSION_MISSING');
 try{return convertPow10(exactOf(amountText),from.exp-(String(base.factor).length-1),0,'exact').units;}
 catch(e){if(e instanceof DecimalError)return fail('INEXACT_QUANTITY');throw e;}
}
