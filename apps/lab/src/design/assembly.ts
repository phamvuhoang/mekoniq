import reference from '../../fixtures/engineering/reference-catalog.json' with {type:'json'};
import serve from '../../fixtures/engineering/serve-demo-v1/serve-components.json' with {type:'json'};
import serveDesign from '../../fixtures/engineering/serve-demo-v1/serve-project.json' with {type:'json'};
import fleetDesign from '../../fixtures/engineering/serve-demo-v1/serve-fleet-project.json' with {type:'json'};
import serve3d from '../../fixtures/engineering/serve-3d-v1/serve-3d-components.json' with {type:'json'};
import serve3dDesign from '../../fixtures/engineering/serve-3d-v1/serve-3d-project.json' with {type:'json'};
import fleet3dDesign from '../../fixtures/engineering/serve-3d-v1/serve-3d-fleet-project.json' with {type:'json'};
import type {ComponentRevision,EngineeringProject,Problem} from '../shared/engineering';
import {componentDigest,requiredDigests,type EngineeringArchiveFiles} from '../project/engineering-archive';
import {canonicalJson,sha256Hex} from '../twin/hash';

/** Shared bytes plus default metadata for designs assembled from the catalog. Imported snapshots own their declarations separately. */
export interface BlobEntry {bytes:Uint8Array;mediaType:string;license:string}
export type AssemblyArchiveMetadata=Pick<EngineeringArchiveFiles['manifest'],'assets'|'recipes'|'blobs'|'missingDigests'|'migration'>;
type CatalogExtras=Pick<AssemblyArchiveMetadata,'assets'|'recipes'>&Partial<Omit<AssemblyArchiveMetadata,'assets'|'recipes'>>;
/** Metadata is owned by a design/history snapshot, never inferred from a project ID, revision or byte digest. */
export const archiveMetadata=(archive:EngineeringArchiveFiles):AssemblyArchiveMetadata=>{
  const {assets,recipes,blobs,missingDigests,migration}=archive.manifest;
  return structuredClone({assets,recipes,blobs,missingDigests,...(migration?{migration}:{})});
};
/**
 * Catalog content the page edits against: component revisions by digest, the model JSON their ModelRefs name, every blob a loaded archive carried
 * (documents, meshes, models). Loading more content only adds to it, so Undo can return to an earlier design. `extras` is a compatibility default for
 * callers editing one archive; a workspace with history passes the store's explicit snapshot metadata to archiveFor instead.
 */
export interface AssemblyCatalog {components:Record<string,ComponentRevision>;models:Record<string,unknown>;blobs:Record<string,BlobEntry>;extras:Record<string,CatalogExtras>}
export const referenceCatalog=():AssemblyCatalog=>{
  const catalog={...structuredClone({components:reference.components,models:reference.models}),blobs:{},extras:{}} as unknown as AssemblyCatalog;
  // Seed the reference's own bytes and provenance before imports add content with potentially different declarations for the same digest.
  for (const [digest,model] of Object.entries(catalog.models)) {
    const bytes=new TextEncoder().encode(canonicalJson(model));
    if (sha256Hex(bytes)===digest) catalog.blobs[digest]={bytes,mediaType:'application/json',license:'internal'};
  }
  return catalog;
};
/** Everything a validated archive holds, ready to edit against and to export again without loss. */
export function catalogFromArchive(archive:EngineeringArchiveFiles):AssemblyCatalog {
  const catalog:AssemblyCatalog={components:{},models:{},blobs:{},extras:{[archive.manifest.project.id]:archiveMetadata(archive)}};
  for (const c of archive.manifest.components) catalog.components[componentDigest(c)]=structuredClone(c);
  for (const b of archive.manifest.blobs) {
    const bytes=archive.files[b.file];if (!bytes) continue;
    catalog.blobs[b.digest]={bytes:bytes.slice(),mediaType:b.mediaType,license:b.license};
    try {catalog.models[b.digest]=JSON.parse(new TextDecoder().decode(bytes));} catch {/* a non-JSON blob is not a model, but it is still kept */}
  }
  return catalog;
}
/** Adds what `from` holds to `into`. Digests name their content, so an existing entry is never replaced. */
export function mergeCatalog(into:AssemblyCatalog,from:AssemblyCatalog):void {
  for (const [k,v] of Object.entries(from.components)) into.components[k]??=v;
  for (const [k,v] of Object.entries(from.models)) into.models[k]??=v;
  for (const [k,v] of Object.entries(from.blobs)) into.blobs[k]??=v;
  for (const [k,v] of Object.entries(from.extras)) into.extras[k]??=v;
}
export const referenceProject=():EngineeringProject=>structuredClone(reference.project) as unknown as EngineeringProject;
/** The Serve demo (portable IR-SIM 2D profile), synced byte for byte from source robotics/navigation-2d/fixtures/serve-demo-v1. Illustrative geometry. */
export const serveProject=():EngineeringProject=>structuredClone(serveDesign) as unknown as EngineeringProject;
/** The two-robot Serve fleet (robot01 Serve, robot02 wider chassis/wheels and a 180-beam LiDAR), same source fixture set; its parts are in the same catalog. */
export const fleetProject=():EngineeringProject=>structuredClone(fleetDesign) as unknown as EngineeringProject;
/** The Webots 3D demos (serve-3d-v1: the Serve robot plus two passive ball casters, all values assumed), synced byte for byte from source robotics/simulation-3d/fixtures/serve-3d-v1. */
export const serve3dProject=():EngineeringProject=>structuredClone(serve3dDesign) as unknown as EngineeringProject;
export const fleet3dProject=():EngineeringProject=>structuredClone(fleet3dDesign) as unknown as EngineeringProject;
export const serveCatalog=(source:{components:unknown;models:unknown}=serve):AssemblyCatalog=>{
  const catalog={...structuredClone({components:source.components,models:source.models}),blobs:{},extras:{}} as unknown as AssemblyCatalog;
  for (const [digest,model] of Object.entries(catalog.models)) {const bytes=new TextEncoder().encode(canonicalJson(model));if (sha256Hex(bytes)===digest) catalog.blobs[digest]={bytes,mediaType:'application/json',license:'internal'};}
  return catalog;
};
const IDENTITY={xyzM:[0,0,0] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]};
const problem=(code:string,path:string,detail:string):Problem=>({code,path,blocking:true,detail});

export const serve3dCatalog=():AssemblyCatalog=>serveCatalog(serve3d);

export function uniqueInstanceId(project:EngineeringProject,base:string):string {
  const taken=new Set(project.assembly.instances.map(i=>i.id));
  if (!taken.has(base)) return base;
  for (let n=2;;n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
export function addInstance(project:EngineeringProject,digest:string,id:string,entityId?:string):EngineeringProject {
  const next=structuredClone(project);
  next.assembly.instances.push({id,componentDigest:digest,pose:structuredClone(IDENTITY)});
  const target=next.entityBindings.find(b=>b.entityId===entityId);
  if (target) target.instanceIds.push(id);
  return next;
}
/** Removing an instance also removes its connections and bindings, so nothing dangles. */
export function removeInstance(project:EngineeringProject,id:string):EngineeringProject {
  const next=structuredClone(project);
  next.assembly.instances=next.assembly.instances.filter(i=>i.id!==id);
  next.assembly.connections=next.assembly.connections.filter(c=>!c.from.startsWith(`${id}/`)&&!c.to.startsWith(`${id}/`));
  for (const b of next.entityBindings) b.instanceIds=b.instanceIds.filter(i=>i!==id);
  return next;
}
export function connect(project:EngineeringProject,from:string,to:string,kind:'mount'|'power'|'data'):EngineeringProject {
  const next=structuredClone(project);
  if (!next.assembly.connections.some(c=>c.from===from&&c.to===to&&c.kind===kind)) next.assembly.connections.push({from,to,kind});
  return next;
}
export function disconnect(project:EngineeringProject,index:number):EngineeringProject {
  const next=structuredClone(project);next.assembly.connections.splice(index,1);return next;
}
export const portsOf=(project:EngineeringProject,catalog:AssemblyCatalog,instanceId:string)=>catalog.components[project.assembly.instances.find(i=>i.id===instanceId)?.componentDigest??'']?.ports??[];

/**
 * Offline preview of the structural problems a person can fix by clicking. It is NOT the resolver: it knows nothing about geometry, inertia, voltage or penetration,
 * so a clean preview never means "valid"; only a server compile produces a receipt.
 */
export function previewProblems(project:EngineeringProject,catalog:AssemblyCatalog):Problem[] {
  const out:Problem[]=[],ports=(inst:string,port:string)=>portsOf(project,catalog,inst).find(p=>p.id===port);
  for (const i of project.assembly.instances) {
    if (!catalog.components[i.componentDigest]) out.push(problem('COMPONENT_UNAVAILABLE',`/assembly/instances/${i.id}`,i.componentDigest));
    else if (!project.entityBindings.some(b=>b.instanceIds.includes(i.id))) out.push(problem('INSTANCE_UNBOUND',`/assembly/instances/${i.id}`,'no entity owns this instance'));
  }
  for (const e of project.runtimeProject.entities) if (!project.entityBindings.find(b=>b.entityId===e.id)?.instanceIds.length) out.push(problem('UNBOUND_ENTITY',`/entityBindings/${e.id}`,`entity ${e.id} has no parts`));
  const usedMounts=new Map<string,number>(),parents=new Map<string,string>();
  project.assembly.connections.forEach((c,n)=>{
    const [fi='',fp='']=c.from.split('/'),[ti='',tp='']=c.to.split('/'),a=ports(fi,fp),b=ports(ti,tp);
    if (!a||!b) {out.push(problem('DANGLING_CONNECTION',`/assembly/connections/${n}`,`${c.from} → ${c.to}`));return;}
    if (c.kind!=='power') for (const end of [c.from,c.to]) {usedMounts.set(end,(usedMounts.get(end)??0)+1);if (usedMounts.get(end)!>1) out.push(problem('PORT_REUSED',`/assembly/connections/${n}`,end));}
    if (c.kind==='mount') {
      if (a.mate!==b.mate) out.push(problem('MOUNT_MISMATCH',`/assembly/connections/${n}`,`${a.mate} does not mate with ${b.mate}`));
      if (parents.has(ti)) out.push(problem('MULTIPLE_PARENT',`/assembly/connections/${n}`,ti));
      parents.set(ti,fi);
    }
  });
  return out;
}

/** The archive the repository stores/exports for this design: only the components it uses, their model JSON as content-addressed blobs; documents we do not hold are listed as missing. */
export function archiveFor(project:EngineeringProject,catalog:AssemblyCatalog,metadata:CatalogExtras|null|undefined=catalog.extras[project.id]):EngineeringArchiveFiles {
  const used=new Map<string,ComponentRevision>();
  for (const i of project.assembly.instances) {const c=catalog.components[i.componentDigest];if (c) used.set(componentDigest(c),c);}
  const files:Record<string,Uint8Array>={},blobs:EngineeringArchiveFiles['manifest']['blobs']=[],needed=requiredDigests([...used.values()]);
  const declarations=new Map(metadata?.blobs?.map(b=>[b.digest,b]));
  // Keep supplemental imported files too: an edit must not silently discard documents outside the component closure.
  for (const digest of new Set([...needed,...declarations.keys()])) {
    if (metadata?.missingDigests?.includes(digest)) continue;
    const held=catalog.blobs[digest];
    if (held&&sha256Hex(held.bytes)===digest) {files[`blobs/${digest}`]=held.bytes;blobs.push({...declarations.get(digest)??{digest,file:`blobs/${digest}`,mediaType:held.mediaType,license:held.license,sizeBytes:held.bytes.length}});continue;}
    const model=catalog.models[digest];if (!model) continue;
    const bytes=new TextEncoder().encode(canonicalJson(model));
    if (sha256Hex(bytes)!==digest) continue;                        // never store a model under a digest it does not have
    files[`blobs/${digest}`]=bytes;blobs.push({digest,file:`blobs/${digest}`,mediaType:'application/json',license:'internal',sizeBytes:bytes.length});
  }
  const have=new Set(blobs.map(b=>b.digest));
  return {manifest:{documentType:'engineering-project-archive',schemaVersion:1,project:structuredClone(project),components:[...used.values()],assets:structuredClone(metadata?.assets??[]),recipes:structuredClone(metadata?.recipes??[]),...(metadata?.migration?{migration:structuredClone(metadata.migration)}:{}),blobs,missingDigests:needed.filter(d=>!have.has(d))},files};
}
/** Wire form of an archive for download: JSON with the blob bytes as base64. */
export function serializeArchive(a:EngineeringArchiveFiles):string {
  return JSON.stringify({manifest:a.manifest,files:Object.fromEntries(Object.entries(a.files).map(([k,v])=>{
    const chunks:string[]=[];
    for (let offset=0;offset<v.length;offset+=8192) chunks.push(String.fromCharCode(...v.subarray(offset,offset+8192)));
    return [k,btoa(chunks.join(''))];
  }))});
}
export function parseArchive(text:string):EngineeringArchiveFiles {
  const raw=JSON.parse(text) as {manifest?:unknown;files?:Record<string,string>};
  if (!raw||typeof raw!=='object'||!raw.manifest||!raw.files||typeof raw.files!=='object') throw new Error('ARCHIVE_SHAPE_INVALID');
  return {manifest:raw.manifest as EngineeringArchiveFiles['manifest'],files:Object.fromEntries(Object.entries(raw.files).map(([k,v])=>[k,Uint8Array.from(atob(v),c=>c.charCodeAt(0))]))};
}
