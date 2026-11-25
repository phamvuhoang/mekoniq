import type {CatalogResult} from '../catalog';
import type {Problem,ResolvedAssembly} from '../contracts';
import {admitElectricalDesign} from './design';
import {allocateIo} from './allocate';
import {deriveNetlist} from './netlist';
import {checkElectrical,sortChecks} from './rules';
import {deviceEvidenceLevel} from './profiles';
import {problem,sealElectrical,validateElectricalBundle,validateElectricalDesign,validateSafetyRequirements,validateWiringPolicy,type ElectricalBundleV1,type ElectricalDesignV1,type SafetyRequirementsV1,type WiringPolicyV1} from './contracts';

export const ELECTRICAL_COMPILER_VERSION='electrical-compiler/1' as const;
export const ELECTRICAL_LIMITS={devices:64,signals:128,wires:512,jsonBytes:2*1024*1024} as const;

/**
 * Pure and deterministic: no clock, no environment, no file system; only +, -, *, / and comparisons on finite numbers, so the digest is the same on arm64 and x86-64.
 * Problems from steps 1 to 3 (shape, catalog, project) are refusals and return no bundle; from step 4 on they are checks inside a sealed bundle.
 */
export function compileElectrical(input:{design:ElectricalDesignV1;resolved:ResolvedAssembly;project:{id:string;revision:number;digest:string};
 catalog:Pick<CatalogResult,'components'|'deviceProfiles'|'quotes'|'descriptions'>;policy:WiringPolicyV1;safety:SafetyRequirementsV1|null;driveAxisIds:readonly string[];schemaHash:string}):{problems:Problem[];bundle:ElectricalBundleV1|null}{
 const {design,policy,safety}=input;
 // 1. shape
 const shape=[...validateElectricalDesign(design).problems,...validateWiringPolicy(policy).problems,...(safety?validateSafetyRequirements(safety).problems:[])];
 if(shape.length)return {problems:shape,bundle:null};
 if(design.devices.length>ELECTRICAL_LIMITS.devices||design.signals.length>ELECTRICAL_LIMITS.signals)return {problems:[problem('ELECTRICAL_TOO_LARGE','/design','device or signal count over the limit')],bundle:null};
 const refs=[['wiringPolicyRef',policy] as const,...(design.safetyRequirementsRef&&safety?[['safetyRequirementsRef',safety] as const]:[])];
 const refProblems:Problem[]=refs.flatMap(([f,doc])=>{const r=design[f]!;return r.id===doc.id&&r.revision===doc.revision&&r.digest===doc.digest?[]:[problem('DOCUMENT_REF_MISMATCH','/'+f,`${r.id}@${r.revision} is not the supplied document`)];});
 if(design.safetyRequirementsRef&&!safety)refProblems.push(problem('DOCUMENT_REF_MISMATCH','/safetyRequirementsRef','the register named by the design was not supplied'));
 // 2-3. catalog and project
 const admitted=admitElectricalDesign(design,{resolved:input.resolved,project:input.project,deviceProfiles:input.catalog.deviceProfiles,driveAxisIds:input.driveAxisIds,components:input.catalog.components});
 if(refProblems.length||admitted.problems.length||!admitted.context)return {problems:[...refProblems,...admitted.problems],bundle:null};
 const context=admitted.context;
 // 4-6. allocation, netlist, rules
 const alloc=allocateIo(context),net=deriveNetlist(context,alloc.allocation,policy,safety);
 if(net.netlist.wires.length>ELECTRICAL_LIMITS.wires)return {problems:[problem('ELECTRICAL_TOO_LARGE','/netlist','more than 512 wires')],bundle:null};
 const rules=checkElectrical(context,alloc.allocation,net.netlist,policy,safety,input.catalog.descriptions);
 const checks=sortChecks([...alloc.checks,...net.checks,...rules,...priceChecks(input.resolved)]);
 const profiles=[...new Map([...context.profiles.values()].map(p=>[p.digest,p])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:a.revision-b.revision).map(p=>({id:p.id,revision:p.revision,digest:p.digest,evidenceLevel:deviceEvidenceLevel(p).level}));
 // 7. BOM (E10 extends it) and the draft drive model (E11)
 const bundle=sealElectrical({schemaVersion:1,documentType:'electrical-bundle',state:checks.some(c=>c.level==='blocking')?'blocked' as const:'compiled' as const,
  inputs:{project:input.project,assemblyDigest:input.resolved.assemblyDigest,design:{id:design.id,revision:design.revision,digest:design.digest},profiles,safetyRequirementsDigest:safety?.digest??null,wiringPolicyDigest:policy.digest,compilerVersion:ELECTRICAL_COMPILER_VERSION,schemaHash:input.schemaHash},
  allocation:alloc.allocation,netlist:net.netlist,checks,bom:input.resolved.bom,driveModelDraft:null,hardwareValidated:false as const,controlAuthority:false as const}) as ElectricalBundleV1;
 if(Buffer.byteLength(JSON.stringify(bundle))>ELECTRICAL_LIMITS.jsonBytes)return {problems:[problem('ELECTRICAL_TOO_LARGE','/bundle','bundle over 2 MiB')],bundle:null};
 const valid=validateElectricalBundle(bundle);
 if(!valid.ok)throw new Error(`ELECTRICAL_BUNDLE_INVALID ${valid.problems.map(p=>`${p.code}@${p.path}`).slice(0,5).join(',')}`);
 return {problems:[],bundle};
}
/** A price is only ever a quotation; every line without one is listed so the total is never mistaken for complete. */
const priceChecks=(resolved:ResolvedAssembly)=>resolved.bom.lines.filter(l=>l.price===null).map(l=>({ruleId:'UNVERIFIED_PRICE',level:'unverified' as const,path:`/bom/${l.lineId}`,detail:`${l.componentId} has no quotation`,sources:[]}));
