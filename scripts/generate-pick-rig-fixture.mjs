import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const seal=(v,key)=>({...v,[key]:hash(JSON.stringify(canonical(Object.fromEntries(Object.entries(v).filter(([k])=>k!==key)))))});
/** Rig policy (R4-B §8.1): the real cup of a rig run is born up to 30 mm off the nominal centre (the cell keeps ±5 mm) and the grasp work region of the belief gate is ±45 mm, inside the ±50 mm view region of the nozzle stand. */
const RIG={maxBirthOffsetXYM:0.03,workHalfExtentM:[0.045,0.045]};
/** Derive pick-rig-v1 from coffee-delivery-cell-v1: every model, physics, program, load and project file keeps its bytes; only the birth-offset limit of the handoff policy (and so the scene digest) differs. No engine run. */
export async function generatePickRigFixture(outDir,cellDir=join(root,'robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1')){
 const files=new Map();
 for(const name of await readdir(cellDir)){if(['manifest.json','README.md','NOTICE','lab-world-scene.json'].includes(name))continue;files.set(name,await readFile(join(cellDir,name)));}
 const policy=JSON.parse(files.get('handoff-policy.json').toString());
 files.set('handoff-policy.json',Buffer.from(JSON.stringify({...policy,birth:{...policy.birth,maxOffsetXYM:RIG.maxBirthOffsetXYM},note:'pick-rig-v1: the birth offset limit is the rig policy (rig-policy.json); everything else is the cell policy.'},null,2)+'\n'));
 const rigPolicy=Buffer.from(JSON.stringify({schemaVersion:1,id:'pick-rig-policy-v1',revision:1,provenance:'assumed',calibration:'not_calibrated',...RIG,derivedFrom:'coffee-delivery-cell-v1'},null,2)+'\n');files.set('rig-policy.json',rigPolicy);
 const scene=JSON.parse(await readFile(join(cellDir,'lab-world-scene.json'),'utf8')),entry=scene.files.find(f=>f.path==='handoff-policy.json'),bytes=files.get('handoff-policy.json');
 entry.sha256=hash(bytes);entry.bytes=bytes.length;scene.handoffPolicyRef={...scene.handoffPolicyRef,sha256:entry.sha256};scene.id='pick-rig-v1';
 files.set('lab-world-scene.json',Buffer.from(JSON.stringify(seal({...scene,sceneDigest:''},'sceneDigest'),null,2)+'\n'));
 files.set('README.md',Buffer.from(`# Pick rig (R4.4)\n\nSoftware-only, \`accepted:false\`, \`not_calibrated\`. Derived from \`coffee-delivery-cell-v1\` by \`scripts/generate-pick-rig-fixture.mjs\`: every model, physics, program, load and project file keeps the cell's bytes. Only \`handoff-policy.json\` differs (the birth offset limit is ${RIG.maxBirthOffsetXYM} m instead of 0.005 m) and so the scene digest. \`rig-policy.json\` also declares the rig's grasp work region (±${RIG.workHalfExtentM[0]} m). The rig is a campaign-only scenario of the Source; the browser cannot select it.\n`));
 files.set('NOTICE',await readFile(join(cellDir,'NOTICE')));
 const listed=[...files].filter(([n])=>n!=='manifest.json').sort(([a],[b])=>a<b?-1:1).map(([path,b])=>({path,sha256:hash(b),bytes:b.length}));
 files.set('manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,id:'pick-rig-v1',accepted:false,files:listed},null,2)+'\n'));
 await mkdir(outDir,{recursive:true});for(const [name,b] of files)await writeFile(join(outDir,name),b);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generatePickRigFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/pick-rig-v1')));
