import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/**
 * Deterministically generate the R4-B perception fixtures (plan V11): modelled perception error profiles and the view/work regions. No engine runs. Every value is `assumed` and
 * `not_calibrated`: these are not the numbers of any camera. The study profiles (sigma and bias sweeps, plan V12) are written here so their digests are locked before any run.
 */
export async function generatePerceptionFixture(outDir){
 const {sealDriveDocument}=await tsImport('../packages/lab-runtime/src/v2/control/drive-io.ts',import.meta.url);
 const files=new Map(),json=(name,v)=>files.set(name,JSON.stringify(v,null,2)+'\n');
 const mm=v=>v/1000;
 const profile=(id,o)=>json(`${id}.json`,sealDriveDocument({schemaVersion:1,documentType:'perception-profile',id,revision:1,digest:'',calibration:'not_calibrated',parameterSource:'assumed',
  updateEveryTicks:10,latencyTicks:5,biasM:[0,0],sigmaM:[0,0],dropoutProbability:0,visibleRegionId:'nozzle-stand',maxAgeTicks:50,...o}));
 profile('perception-ground-truth-v1',{updateEveryTicks:1,latencyTicks:0});
 profile('perception-nominal-v1',{sigmaM:[mm(2),mm(2)],dropoutProbability:0.05});
 profile('perception-lossy-v1',{sigmaM:[mm(2),mm(2)],dropoutProbability:0.9});
 profile('perception-short-age-v1',{sigmaM:[mm(2),mm(2)],maxAgeTicks:12});
 profile('perception-bias-out-of-region-v1',{biasM:[mm(30),0]});
 for(const s of [2,5,10,15])profile(`perception-sigma-${s}mm-v1`,{sigmaM:[mm(s),mm(s)]});
 for(const b of [5,10]){profile(`perception-bias-x-${b}mm-v1`,{biasM:[mm(b),0],sigmaM:[mm(2),mm(2)]});profile(`perception-bias-y-${b}mm-v1`,{biasM:[0,mm(b)],sigmaM:[mm(2),mm(2)]});}
 // The regions a profile may name and the work region a believed position must lie in (R4-B §6 gate 2). Centres come from the cell layout at run time (the cup's birth centre); only extents are registered.
 json('perception-regions-v1.json',{schemaVersion:1,documentType:'perception-regions',id:'perception-regions-v1',provenance:'assumed',
  viewRegions:[{id:'nozzle-stand',supportId:'nozzle-stand',halfExtentM:[0.05,0.05]}],workRegions:[{id:'cell-pick',viewRegionId:'nozzle-stand',halfExtentM:[0.02,0.02]}]});
 files.set('README.md',`# Perception fixtures v1\n\nGenerate with \`node scripts/generate-perception-fixture.mjs [out-dir]\`. Each \`perception-*.json\` is a modelled perception error (bias, noise, latency, dropout, view region, maximum age) for the simulated pose estimator of R4-B: it is a parameter model, not camera data, and every value is \`assumed\`, \`not_calibrated\`. \`perception-ground-truth-v1\` has no error at all (the comparison point). \`perception-regions-v1.json\` registers the view region (the nozzle stand top) and the work region a believed cup position must lie in before a grasp is planned.\n`);
 json('manifest.json',{schemaVersion:1,documentType:'perception-fixture-manifest',id:'perception-v1',generator:'scripts/generate-perception-fixture.mjs',calibration:'not_calibrated',files:[...files].sort(([a],[b])=>a<b?-1:1).map(([path,bytes])=>({path,sha256:hash(bytes),bytes:Buffer.byteLength(bytes)}))});
 await mkdir(outDir,{recursive:true});for(const [name,bytes] of files)await writeFile(join(outDir,name),bytes);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generatePerceptionFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/perception-v1')));
