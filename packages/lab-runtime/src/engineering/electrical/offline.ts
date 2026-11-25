import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashJson} from '../../v2/hash';
import {resolveAssembly} from '../assembly';
import {loadCatalog} from '../catalog';
import type {EngineeringProject,Problem} from '../contracts';
import {compileElectrical} from './compile';
import {ELECTRICAL_SCHEMA_HASH,problem,validateElectricalDesign,type DeviceProfileV1,type ElectricalBundleV1,type ElectricalDesignV1} from './contracts';
import {loadDriveBase,loadElectricalDocuments} from './documents-store';

export const SERVE_FIXTURE_DIR='robotics/simulation-mujoco/fixtures/serve-tray-v1';
export interface OfflineResult{problems:Problem[];bundle:ElectricalBundleV1|null;profiles:Map<string,DeviceProfileV1>;design:ElectricalDesignV1|null}
const readJson=async<T>(path:string)=>JSON.parse(await readFile(path,'utf8')) as T;

/**
 * The same compile the service runs, from files: no gateway, no session. The project defaults to the Serve tray fixture.
 * ponytail: drive axes are inferred from instances named wheel-left / wheel-right of each entity; the service reads the compiled scene's wheel bindings instead. Same answer for Serve.
 */
export async function compileDesignFile(o:{design:string;catalogRoot:string;root?:string;projectDir?:string}):Promise<OfflineResult>{
 const none:OfflineResult={problems:[],bundle:null,profiles:new Map(),design:null};
 let design:ElectricalDesignV1;
 try{design=await readJson<ElectricalDesignV1>(o.design);}catch{return {...none,problems:[problem('DESIGN_UNREADABLE','/design',o.design)]};}
 const shape=validateElectricalDesign(design);
 if(!shape.ok)return {...none,problems:shape.problems};
 const dir=o.projectDir??join(o.root??'.',SERVE_FIXTURE_DIR),project=await readJson<EngineeringProject>(join(dir,'serve-3d-project.json')),parts=await readJson<{components:Record<string,never>;models:Record<string,never>}>(join(dir,'serve-3d-components.json'));
 const cat=await loadCatalog(o.catalogRoot),{resolved,problems}=resolveAssembly(project,parts.components,{models:parts.models,quotes:cat.quotes});
 if(!resolved)return {...none,design,problems};
 const docs=await loadElectricalDocuments(o.catalogRoot),policy=docs.policies.find(p=>p.id===design.wiringPolicyRef.id&&p.revision===design.wiringPolicyRef.revision);
 const safety=design.safetyRequirementsRef?docs.registers.find(x=>x.id===design.safetyRequirementsRef!.id&&x.revision===design.safetyRequirementsRef!.revision)??null:null;
 if(!policy)return {...none,design,problems:[problem('WIRING_POLICY_UNAVAILABLE','/wiringPolicyRef',design.wiringPolicyRef.id)]};
 const driveAxisIds=project.entityBindings.flatMap(b=>(['left','right'] as const).filter(side=>b.instanceIds.some(i=>i.endsWith(`wheel-${side}`))).map(side=>`${b.entityId}/wheel-${side}`)).sort();
 const result=compileElectrical({design,resolved,project:{id:project.id,revision:project.revision,digest:hashJson(project)},catalog:cat,policy,safety,driveAxisIds,schemaHash:ELECTRICAL_SCHEMA_HASH,driveBase:await loadDriveBase(join(o.root??'.','robotics/simulation-mujoco/fixtures/drive-v1'))});
 const profiles=new Map<string,DeviceProfileV1>(),all=Object.values(cat.deviceProfiles);
 for(const d of design.devices){const p=all.find(x=>x.id===d.profile.id&&x.revision===d.profile.revision);if(p)profiles.set(d.id,p);}
 return {...result,profiles,design};
}
