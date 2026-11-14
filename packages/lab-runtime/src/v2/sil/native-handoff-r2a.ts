// Exact historical arm-only adapter. The reference was extracted from frozen Git 4f893ac,
// not inferred from caller data or the current shared-world model. Nothing here executes input.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import reference from '../../../../../scripts/native-sim/r2a-arm-baseline.json';
import type {NativeHandoffV1,HandoffDocumentBinding} from '../../../../contracts/generated/native-handoff';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const r2aDocumentBinding=()=>structuredClone(reference.binding) as HandoffDocumentBinding;
export function validateR2aDocuments(m:NativeHandoffV1,contents:ReadonlyMap<string,Buffer>):void{
 for(const [key,value]of Object.entries(reference.subject))if(m.subject[key as keyof typeof reference.subject]!==value)throw Error('R2A_SUBJECT_MISMATCH');
 if(m.subject.executionKind!=='mujoco_image'||m.profile.installation.kind!=='oci'||m.profile.modelId!=='xarm6-g2-v1')throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
 if(!same(m.profile.documents,reference.binding)||!same(m.frames,{world:'map',robotBase:'base',tool:'tcp',handedness:'right'}))throw Error('DOCUMENT_MAPPING_MISMATCH');
 const all=Object.values(m.refs).flat(),get=(path:string)=>{const rows=all.filter(r=>r.sourcePath===path);if(rows.length!==1)throw Error('R2A_DEPENDENCY_MISSING');const b=contents.get(rows[0]!.path);if(!b)throw Error('R2A_DEPENDENCY_MISSING');return b;};
 for(const f of reference.files){const b=get(f.path);if(hash(b)!==f.sha256||b.length!==f.bytes)throw Error('R2A_FROZEN_INPUT_MISMATCH');}
 const ajv=new Ajv({strict:true,discriminator:true});addFormats(ajv);
 for(const s of reference.schemas){const b=get(s.name);if(hash(b)!==s.sha256)throw Error('DOCUMENT_SCHEMA_UNSUPPORTED');ajv.addSchema(JSON.parse(b.toString()),s.name);}
 const read=(role:'project'|'world'|'model')=>JSON.parse(contents.get(m.refs[role][0].path)!.toString());
 const p=read('project'),w=read('world'),model=read('model');
 for(const [name,value]of [['lab-project-v2.schema.json',p],['engineering-component.schema.json',model],['arm-cell-scene-v1.schema.json',w]] as const)if(!ajv.getSchema(name)!(value))throw Error('R2A_DOCUMENT_INVALID');
 const root='robotics/simulation-mujoco/fixtures/xarm6-g2-v1/';
 if(!same(p,JSON.parse(get(root+'coffee-cell-project.json').toString()))||!same(model,JSON.parse(get(root+'component.json').toString()))||!same(w,reference.world))throw Error('R2A_DOCUMENT_BINDING_MISMATCH');
 // Exact manifest bytes bind model/program/physics/blobs/NOTICE; hashes above also bind the full frozen engine lock.
 const manifest=JSON.parse(get(root+'manifest.json').toString());
 for(const f of manifest.files){const b=get(root+f.path);if(hash(b)!==f.sha256||b.length!==f.bytes)throw Error('R2A_MODEL_REF_MISMATCH');}
 for(const f of manifest.blobs){const b=get(root+'blobs/'+f.sha256+'.stl');if(hash(b)!==f.sha256||b.length!==f.bytes)throw Error('R2A_MODEL_REF_MISMATCH');}
}
