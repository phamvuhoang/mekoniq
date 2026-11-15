import {createHash} from 'node:crypto';
// Current R2b subject admission is separate from the frozen R2a profile.
export function currentR2bSubjectIssues(handoff,pkg){
 const s=handoff?.subject,p=handoff?.profile,r=[];
 if(p?.documents?.kind!=='mujoco_cell_v1'||p?.architecture!=='amd64'||s?.executionKind!=='mujoco_image')r.push('R2B_CURRENT_PROFILE_REQUIRED');
 if(!s?.image||s.image.platform!=='linux/amd64'||!/^sha256:[a-f0-9]{64}$/.test(s.image.configDigest??'')||!/^sha256:[a-f0-9]{64}$/.test(s.image.manifestDigest??''))r.push('R2B_IMAGE_UNBUILT');
 if(!pkg||pkg.version!==1||pkg.kind!=='r2b-payload-cell-package'||pkg.sourceCommit!==s?.sourceCommit||pkg.runtimeArtifactSha256!==s?.runtimeArtifactSha256||pkg.schemaHash!==s?.schemaHash||pkg.portableToolsDigest!==s?.portableClosureHash||! /^[a-f0-9]{64}$/.test(pkg.bundleSha256??'')||JSON.stringify(pkg.campaigns)!==JSON.stringify(['payload-v1','mj-cell-bv01-v1'])||!pkg.inputs?.length||!pkg.imageFiles?.length)r.push('R2B_CAMPAIGN_PACKAGE_MISMATCH');
 return r;
}

export function currentEngineIssues(handoff,measured){
 const r=[],engine=measured?.engine,required=handoff.profile.requiredPackages;
 if(measured?.node!=='v24.22.2'||measured?.architecture!=='x64'||engine?.version!=='3.17.0'||!/^3\.11\./.test(engine?.python??''))r.push('R2B_IMAGE_TOOLCHAIN');
 const lib=engine?.artifacts?.find(f=>f.path.includes('libmujoco')),lock=required.find(p=>p.name==='mujoco');
 if(required.length!==1||!lock||lock.version!=='3.17.0'||lock.sha256!==lib?.sha256||!Number.isInteger(lib?.bytes)||lib.bytes<1)r.push('R2B_ENGINE_LOCK');
 const normal=s=>s.toLowerCase().replace(/[-_.]+/g,'-');if(!Array.isArray(engine?.packages)||engine.packages.some(([name])=>handoff.profile.forbiddenPackages.some(x=>normal(x)===normal(name))))r.push('R2B_ENGINE_PACKAGES');
 return r;
}

export function currentPackageBindingIssues(pkgBytes,config,inspected){
 const pkg=JSON.parse(pkgBytes),r=[],digest=createHash('sha256').update(pkgBytes).digest('hex'),a=config?.config?.Labels,b=inspected?.Config?.Labels;
 if(Object.keys(pkg).sort().join(',')!==['version','kind','documentProfile','payloadRegistrySha256','cellRegistrySha256','sourceCommit','runtimeArtifactSha256','schemaHash','portableToolsDigest','engineObserverSha256','bundleSha256','campaigns','imageFiles','inputs'].sort().join(','))r.push('R2B_PACKAGE_SHAPE');
 for(const [key,expected]of [['org.mekoniq.r2b.campaign-package-sha256',digest],['org.mekoniq.r2b.campaign-bundle-sha256',pkg.bundleSha256]]){
  if(!/^[a-f0-9]{64}$/.test(expected??'')||a?.[key]!==expected)r.push('R2B_ADMITTED_CONFIG_LABEL:'+key);
  if(b?.[key]!==a?.[key]||b?.[key]!==expected)r.push('R2B_INSPECT_LABEL:'+key);
 }
 if(pkg.documentProfile!=='mujoco_cell_v1'||! /^[a-f0-9]{64}$/.test(pkg.engineObserverSha256??'')||! /^[a-f0-9]{64}$/.test(pkg.payloadRegistrySha256??'')||! /^[a-f0-9]{64}$/.test(pkg.cellRegistrySha256??''))r.push('R2B_PACKAGE_PROFILE_GRAPH');
 const paths=new Set();for(const f of pkg.inputs??[]){if(typeof f.path!=='string'||!/^[-\w.@+%/]+$/.test(f.path)||f.path.split('/').some(p=>!p||p==='..'||p==='.')||paths.has(f.path)||! /^[a-f0-9]{64}$/.test(f.sha256??'')||!Number.isSafeInteger(f.bytes)||f.bytes<0)r.push('R2B_PACKAGE_INPUT_GRAPH');paths.add(f.path);}
 for(const file of ['scripts/r2b-campaign-entry.ts','scripts/native-sim/r2b-engine-inventory.py','packages/sync/migrations/sqlite/001_journal.sql'])if(!paths.has(file))r.push('R2B_PACKAGE_INPUT_GRAPH');
 if(pkg.inputs?.find(f=>f.path==='scripts/native-sim/r2b-engine-inventory.py')?.sha256!==pkg.engineObserverSha256)r.push('R2B_OBSERVER_GRAPH');
 return [...new Set(r)];
}
