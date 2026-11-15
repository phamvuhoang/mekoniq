// R92: local export association; no registry observation or signature is implied.
import {lstat,readFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=x=>/^sha256:[a-f0-9]{64}$/.test(x??'');
const INDEX='application/vnd.oci.image.index.v1+json',MANIFEST='application/vnd.oci.image.manifest.v1+json',CONFIG='application/vnd.oci.image.config.v1+json';
async function safe(root,path,max){let p=root;const base=await lstat(p);if(!base.isDirectory()||base.isSymbolicLink())throw Error('OCI_PATH');for(const part of path.split('/')){if(!/^[\w.-]+$/.test(part)||part==='..'||part==='.')throw Error('OCI_PATH');p=join(p,part);if((await lstat(p)).isSymbolicLink())throw Error('OCI_SYMLINK');}const st=await lstat(p);if(!st.isFile()||st.size>max)throw Error('OCI_SIZE');return {path:p,size:st.size};}
export async function readLocalOciLayout(root){
 const read=async p=>readFile((await safe(root,p,4*1024*1024)).path),layout=JSON.parse(await read('oci-layout'));if(layout.imageLayoutVersion!=='1.0.0')throw Error('OCI_LAYOUT_VERSION');
 let total=0;const blobs=[];const blob=async(d,metadata=false)=>{if(!d||!digest(d.digest)||!Number.isSafeInteger(d.size)||d.size<1||d.size>1024**3)throw Error('OCI_DESCRIPTOR');total+=d.size;if(total>8*1024**3||blobs.length>=256)throw Error('OCI_TOTAL_LIMIT');const f=await safe(root,'blobs/sha256/'+d.digest.slice(7),metadata?4*1024*1024:1024**3);if(f.size!==d.size)throw Error('OCI_BLOB_SIZE');const h=createHash('sha256'),handle=await open(f.path);try{for await(const chunk of handle.createReadStream())h.update(chunk);}finally{await handle.close();}if('sha256:'+h.digest('hex')!==d.digest)throw Error('OCI_BLOB_HASH');blobs.push({digest:d.digest,size:d.size,mediaType:d.mediaType});return metadata?JSON.parse(await readFile(f.path,'utf8')):null;};
 const indexBytes=await read('index.json');let index=JSON.parse(indexBytes),descriptor,manifest;
 for(let depth=0;depth<4;depth++){if(index.schemaVersion!==2||index.mediaType!==INDEX||index.manifests?.length!==1)throw Error('OCI_INDEX_PLATFORM');descriptor=index.manifests[0];if(descriptor.platform&&(descriptor.platform.os!=='linux'||descriptor.platform.architecture!=='amd64'||descriptor.platform.variant))throw Error('OCI_PLATFORM');const doc=await blob(descriptor,true);if(descriptor.mediaType===MANIFEST){manifest=doc;break;}if(descriptor.mediaType!==INDEX)throw Error('OCI_UNSUPPORTED_MEDIA');index=doc;}
 if(!manifest||manifest.schemaVersion!==2||manifest.mediaType!==MANIFEST||manifest.config?.mediaType!==CONFIG||!Array.isArray(manifest.layers)||!manifest.layers.length)throw Error('OCI_MANIFEST');const config=await blob(manifest.config,true);
 if(config.os!=='linux'||config.architecture!=='amd64'||config.rootfs?.type!=='layers'||!Array.isArray(config.rootfs.diff_ids)||config.rootfs.diff_ids.length!==manifest.layers.length||config.rootfs.diff_ids.some(x=>!digest(x)))throw Error('OCI_CONFIG');
 for(const layer of manifest.layers){if(!['application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.oci.image.layer.v1.tar+zstd'].includes(layer.mediaType))throw Error('OCI_UNSUPPORTED_LAYER');await blob(layer);}
 return {version:1,kind:'verified_local_oci_export',registryObservation:false,indexSha256:sha(indexBytes),manifestDigest:descriptor.digest,configDigest:manifest.config.digest,platform:'linux/amd64',blobs,manifest,config};
}
export function localImageAssociationIssues(oci,inspected){const r=[],image=inspected;
 if(oci?.kind!=='verified_local_oci_export'||oci.registryObservation!==false||image?.Id!==oci.configDigest||image?.Os!=='linux'||image?.Architecture!=='amd64'||JSON.stringify(image?.RootFS?.Layers)!==JSON.stringify(oci.config?.rootfs?.diff_ids))r.push('OCI_LOADED_CONFIG_ASSOCIATION');
 if(!image?.Config?.Labels||JSON.stringify(Object.entries(image.Config.Labels).sort())!==JSON.stringify(Object.entries(oci.config?.config?.Labels??{}).sort()))r.push('OCI_LOADED_LABELS');
 if(image?.RepoDigests!==undefined&&(!Array.isArray(image.RepoDigests)||image.RepoDigests.some(x=>typeof x!=='string'||!x.endsWith('@'+oci.manifestDigest))))r.push('OCI_REPODIGEST_CONFLICT');return r;
}
export function localBuilderIssues(context,version,inspection,env={}){const r=[],nodes=[...inspection.matchAll(/^\s*Endpoint:\s*(.+)$/gm)].map(m=>m[1].trim()),v=/\bv(\d+)\.(\d+)\./.exec(version),kit=[...inspection.matchAll(/^\s*BuildKit(?: version)?:\s*v?(\d+)\.(\d+)\./gm)],name=/^Name:\s*([-\w.]+)\s*$/m.exec(inspection)?.[1];
 if(env.DOCKER_HOST||env.DOCKER_CONTEXT||env.BUILDX_BUILDER||context?.length!==1||!context[0]?.Endpoints?.docker?.Host?.startsWith('unix://'))r.push('LOCAL_BUILDER_CONTEXT');
 if(!v||Number(v[1])===0&&Number(v[2])<13||!kit.length||kit.some(m=>Number(m[1])===0&&Number(m[2])<13))r.push('LOCAL_BUILDER_VERSION');
 if(!name||!/^Driver:\s*docker-container\s*$/m.test(inspection)||nodes.length!==1||!nodes.every(x=>x===context?.[0]?.Name||x===context?.[0]?.Endpoints?.docker?.Host)||!/^\s*Status:\s*running\s*$/m.test(inspection))r.push('LOCAL_BUILDER_REQUIRED');return {issues:r,name};
}
