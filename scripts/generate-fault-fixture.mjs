import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/**
 * Deterministically generate the R4 fault oracle (plan V08) from the committed nominal drive model. No engine runs. The detector, code and deadline of each fault are locked here, before any
 * campaign, and the campaign verifier reads them from the sealed document: a deadline is never loosened after a run has been seen. Every value is `assumed` and `not_calibrated`.
 */
export async function generateFaultFixture(outDir){
 const {sealDriveDocument}=await tsImport('../packages/lab-runtime/src/v2/control/drive-io.ts',import.meta.url);
 const {DRIVE_FAULTS}=await tsImport('../packages/lab-runtime/src/v2/control/drive-faults.ts',import.meta.url);
 const nominal=await readFile(join(root,'robotics/simulation-mujoco/fixtures/drive-v1/serve-drive-nominal-v1.json'));
 const source=locator=>({kind:'assumed',documentId:'robotics/simulation-mujoco/fixtures/drive-v1/serve-drive-nominal-v1.json',revision:'1',locator,contentSha256:hash(nominal)});
 const files=new Map(),json=(name,v)=>files.set(name,JSON.stringify(v,null,2)+'\n');
 // deadlines in ticks after the application tick, with one tick of slack over the nominal drive: feedbackLossSubsteps 25 trips in the third tick, watchdogTicks 5 in the fifth, the controller
 // reads a trip from the feedback of the tick after it
 const fault=(faultId,required,detector,codes,deadlineTicks)=>({faultId,required,detector,codes,deadlineTicks});
 // the bounds the server admits a schedule against, in one file the worker reads to check them again before it applies anything (one source, two readers)
 json('fault-catalog-v1.json',{schemaVersion:1,documentType:'fault-catalog',id:'fault-catalog-v1',faults:DRIVE_FAULTS});
 json('fault-oracle-v1.json',sealDriveDocument({schemaVersion:1,documentType:'fault-oracle',id:'fault-oracle-v1',revision:1,digest:'',calibration:'not_calibrated',
  faults:[fault('encoder-dropout',true,'drive',['FEEDBACK_LOSS'],3),fault('motor-weak',false,'controller',['TRACKING_DEGRADED'],null),fault('drive-trip',true,'controller',['DRIVE_FAULT'],2),
   fault('command-delay',false,null,[],null),fault('command-loss',true,'drive',['COMMAND_TIMEOUT'],5),fault('grip-weak',true,'arm_program',['ARM_GRIP_NOT_ESTABLISHED'],null),
   fault('lidar-noise',false,null,[],null),fault('drive-reset',false,null,[],null)],
  invariantPolicy:{holdToleranceRad:0.02,torqueEpsNm:1e-9,timeoutSettleTicks:2},source:source('feedbackLossSubsteps and watchdogTicks of the nominal drive: oracle deadlines are test policy, not safety parameters')}));
 files.set('README.md',`# Fault fixtures v1\n\nGenerate with \`node scripts/generate-fault-fixture.mjs [out-dir]\`. \`fault-oracle-v1.json\` names, for each fault of the R4 catalog, who must detect it, by which code and within how many ticks of its application receipt, and the thresholds of the six invariants. It is locked here and hashed in the campaign record before any run: a deadline is not loosened after a failure.\n\n- \`required:false\` faults (motor-weak, command-delay, lidar-noise, drive-reset) do not have to be detected; the report still states what the plant did.\n- Every value is \`assumed\` and the document \`not_calibrated\`; none is a safety parameter or a vendor number.\n`);
 json('manifest.json',{schemaVersion:1,documentType:'fault-fixture-manifest',id:'fault-v1',generator:'scripts/generate-fault-fixture.mjs',calibration:'not_calibrated',files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,sha256:hash(bytes),bytes:Buffer.byteLength(bytes)}))});
 await mkdir(outDir,{recursive:true});for(const [name,bytes] of files)await writeFile(join(outDir,name),bytes);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateFaultFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/fault-v1')));
