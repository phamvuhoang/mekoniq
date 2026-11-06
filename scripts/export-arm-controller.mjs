#!/usr/bin/env node
// Export the arm controller package (integrations/arm-controller) as an installable SIM artifact: revision, per-file sha256, SBOM/licence
// inventory (reviewed:false until the licence review happens), the model lock, the contract schemas the bridge validates against, and a
// canonical manifest signed with the Ed25519 release key the CI/offline signing station holds (--signing-key PEM, --key-id). The artifact
// carries only the key id and the signature; private keys never enter it. Without a key the artifact is UNSIGNED and the installer refuses
// it (fail closed): --allow-unsigned only marks it for development. Clean checkout required unless --allow-dirty (also marked).
//   node scripts/export-arm-controller.mjs OUT_DIR [--signing-key release.pem --key-id KEY] [--allow-dirty] [--allow-unsigned]
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),PKG=join(root,'integrations/arm-controller');
const sha=b=>createHash('sha256').update(b).digest('hex');
/** Canonical JSON for signing: sorted keys, no whitespace, UTF-8 (JCS-equivalent for this manifest: no floats, no non-BMP text). */
export const canonical=v=>JSON.stringify(sort(v));
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
export const publicKeyBase64url=k=>{const key=typeof k==='object'&&k.type==='public'?k:createPublicKey(k);return Buffer.from(key.export({type:'spki',format:'der'}).subarray(-32)).toString('base64url');};
/** Every file under the artifact except the root manifest/signature (a nested manifest.json, e.g. the model's, is content and gets hashed). */
export function listFiles(dir){const out=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){const p=join(d,e.name);if(e.name==='__pycache__'||(d===dir&&(e.name==='manifest.json'||e.name==='manifest.sig.json')))continue;if(e.isDirectory())walk(p);else if(e.isFile())out.push(relative(dir,p));}};walk(dir);return out;}
/** Pure: the manifest of an artifact directory (every file hashed). `root` holds the copied package; nothing outside it is referenced. */
export function buildManifest(o){
 const files=listFiles(o.root).map(path=>{const b=readFileSync(join(o.root,path));return {path,sha256:sha(b),bytes:b.length};});
 if(!files.length)throw new Error('ARTIFACT_EMPTY');
 const profile=files.find(f=>f.path===o.profilePath);if(!profile)throw new Error('PROFILE_MISSING');
 return {schemaVersion:1,artifact:'mekoniq-arm-controller',version:o.version,sourceCommit:o.sourceCommit,dirty:Boolean(o.dirty),signed:true,exportedAt:o.exportedAt,nodeVersion:o.nodeVersion,mode:'simulation',hardwareEnabled:false,
  profile:{id:o.profileId??'puma560-sim-1',path:o.profilePath,sha256:profile.sha256},model:o.model,files,dependencies:o.dependencies,sbom:{format:'mekoniq-sbom-v1',components:o.sbom},schemas:o.schemas,
  compatibleCalibrationSchemas:o.compatibleCalibrationSchemas??[1],machineOverlay:{path:'machine/',note:'per-machine identity and calibration are provisioned on the IPC, never shipped in the artifact; the installer keeps them across releases'},
  trust:{keyId:o.keyId,algorithm:'Ed25519',signatureFile:'manifest.sig.json',canonicalization:'sorted-keys compact JSON (JCS-equivalent for this manifest)'},
  claims:{softwareSil:'not_run_until_linux_smoke',hardware:'not_accepted',note:'simulation install; LinuxCNC smoke, HMI acceptance and every hardware gate are recorded separately; this artifact carries no production claim'}};
}
export function signManifest(manifest,privateKey,keyId,signedAt=new Date().toISOString()){
 const body=Buffer.from(canonical(manifest));const key=typeof privateKey==='string'?createPrivateKey(privateKey):privateKey;
 return {schemaVersion:1,algorithm:'Ed25519',keyId,signedAt,manifestSha256:sha(body),signature:sign(null,body,key).toString('base64url'),publicKey:publicKeyBase64url(key)};
}
const LICENSES={linuxcnc:'GPL-2.0-only',python3:'PSF-2.0','python3-pyqt5':'GPL-3.0-only','python3-pyqt5.qsci':'GPL-3.0-only',qtvcp:'GPL-2.0-only','virtual-hal':'MEKONIQ (this repository)',model:'LinuxCNC sample (GPL-2.0-only); MEKONIQ manifest',jsonschema:'MIT',referencing:'MIT',rfc8785:'MIT'};
async function main(){
 const args=process.argv.slice(2),out=resolve(args.find(a=>!a.startsWith('--'))??''),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
 if(!out||out===root||out.startsWith(PKG))throw new Error('UNSAFE_OUTPUT_DIRECTORY');
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
 const dirty=git('status','--porcelain','--untracked-files=all','--',PKG,'scripts/export-arm-controller.mjs','packages/contracts/schemas');
 if(dirty&&!args.includes('--allow-dirty'))throw new Error('CLEAN_SOURCE_CHECKOUT_REQUIRED');
 const keyPath=opt('--signing-key'),keyId=opt('--key-id');
 if(!keyPath&&!args.includes('--allow-unsigned'))throw new Error('SIGNING_KEY_REQUIRED (or --allow-unsigned for a development artifact the installer refuses)');
 // never empty a directory that is not ours: it must be absent, empty, or hold a previous artifact of this exporter
 if(existsSync(out)&&readdirSync(out).length){let previous=null;try{previous=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));}catch{previous=null;}
  if(previous?.artifact!=='mekoniq-arm-controller')throw new Error(`OUTPUT_DIRECTORY_NOT_EMPTY: ${out} is not an empty directory or a previous arm controller artifact`);}
 rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
 for(const d of ['bridge','hmi','configs','models','programs','packaging','docs','scripts'])cpSync(join(PKG,d),join(out,d),{recursive:true,filter:p=>!/__pycache__|\.pyc$/.test(p)});
 cpSync(join(PKG,'README.md'),join(out,'README.md'));
 mkdirSync(join(out,'schemas'));const schemas=[];
 for(const n of ['arm-command.schema.json','arm-observation.schema.json','cell-command.schema.json','cell-observation.schema.json']){const b=readFileSync(join(root,'packages/contracts/schemas',n));writeFileSync(join(out,'schemas',n),b);schemas.push({name:n,sha256:sha(b)});}
 const lockBytes=readFileSync(join(PKG,'packaging/dependencies.lock.json')),lock=JSON.parse(lockBytes),modelBytes=readFileSync(join(PKG,'models/puma560-reference/manifest.json')),model=JSON.parse(modelBytes);
 const sourceCommit=git('rev-parse','HEAD'),profileRaw=JSON.parse(readFileSync(join(PKG,'configs/sim/puma560/profile.json'),'utf8'));
 const manifest=buildManifest({root:out,version:`${readFileSync(join(PKG,'VERSION'),'utf8').trim()}+${sourceCommit.slice(0,7)}${dirty?'.dirty':''}`,sourceCommit,dirty:Boolean(dirty),exportedAt:new Date().toISOString(),nodeVersion:process.version,profilePath:'configs/sim/puma560/profile.json',profileId:profileRaw.machineId,
  model:{id:model.id,revision:model.revision,manifestSha256:sha(modelBytes)},dependencies:{lockSha256:sha(lockBytes),status:lock.status,components:lock.components.map(c=>({id:c.id,version:String(c.version??c.candidateRelease?.tag??''),status:c.status}))},
  sbom:[...lock.components.map(c=>({name:c.id,version:String(c.version??c.candidateRelease?.tag??''),source:c.repository??c.debianPackage?.name??'debian',license:LICENSES[c.id]??'UNKNOWN',licenseReviewed:false})),...['jsonschema','referencing','rfc8785'].map(name=>({name,version:'per packaging/dependencies.lock.json / requirements',source:'pypi',license:LICENSES[name],licenseReviewed:false}))],
  schemas,compatibleCalibrationSchemas:[1],keyId:keyId??'unsigned'});
 if(keyPath){if(!keyId)throw new Error('KEY_ID_REQUIRED');const sig=signManifest(manifest,readFileSync(keyPath,'utf8'),keyId);writeFileSync(join(out,'manifest.sig.json'),JSON.stringify(sig,null,1)+'\n');}
 else{manifest.signed=false;manifest.trust.keyId='unsigned';}
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');
 console.log(JSON.stringify({output:out,version:manifest.version,files:manifest.files.length,signed:manifest.signed,dirty:manifest.dirty,keyId:manifest.trust.keyId},null,2));
}
if(process.argv[1]&&/export-arm-controller\.mjs$/.test(process.argv[1]))main().catch(e=>{console.error(e.message);process.exit(2);});
