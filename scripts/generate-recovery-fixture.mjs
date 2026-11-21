import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** The registered recovery policy of R4-B §7.2 (plan V13). Every number is `assumed`; deterministic, no engine. */
export async function generateRecoveryFixture(outDir){
 const {sealDriveDocument}=await tsImport('../packages/lab-runtime/src/v2/control/drive-io.ts',import.meta.url);
 const files=new Map(),json=(name,v)=>files.set(name,JSON.stringify(v,null,2)+'\n');
 json('pick-recovery-v1.json',sealDriveDocument({schemaVersion:1,documentType:'recovery-policy',id:'pick-recovery-v1',revision:1,digest:'',calibration:'not_calibrated',parameterSource:'assumed',beliefWaitTicks:250,rules:[
  {id:'grip-not-established',on:['GRIP_NOT_ESTABLISHED'],requires:['arm_state_fresh','no_unknown_command','cup_on_declared_support','cup_not_between_pads'],steps:['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'],maxAttempts:2},
  {id:'belief-not-usable',on:['BELIEF_UNAVAILABLE','BELIEF_STALE'],requires:['arm_state_fresh','no_unknown_command'],steps:['await_fresh_belief','retry_pick'],maxAttempts:2}]}));
 files.set('README.md',`# Recovery policy v1\n\nGenerate with \`node scripts/generate-recovery-fixture.mjs [out-dir]\`. \`pick-recovery-v1.json\` is the bounded recovery table of a failed pick (R4-B §7.2): two rules over a closed catalogue, at most two attempts each. All values \`assumed\`, \`not_calibrated\`. A failure the table does not name, a fact that is not observed and an exhausted bound all end in \`needs_attention\`; the gripper is opened only when the cup is observed not to be between the pads.\n`);
 json('manifest.json',{schemaVersion:1,documentType:'recovery-fixture-manifest',id:'recovery-v1',generator:'scripts/generate-recovery-fixture.mjs',calibration:'not_calibrated',files:[...files].sort(([a],[b])=>a<b?-1:1).map(([path,bytes])=>({path,sha256:hash(bytes),bytes:bytes.length}))});
 await mkdir(outDir,{recursive:true});for(const [name,bytes] of files)await writeFile(join(outDir,name),bytes);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateRecoveryFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/recovery-v1')));
