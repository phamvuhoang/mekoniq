// Deterministic generator for robotics/simulation-mujoco/fixtures/stop-v1: drive models and a control profile derived from the HW-C hardware option,
// for the stop-behaviour campaign. HW-A and HW-C use the same drives (BLVD-KRD with BLV-R 60 W); HW-C is the one that compiles, so it is the source.
// Nothing is calibrated; every value that no document supports keeps the assumed source of the R4 drive fixture. Run: pnpm exec tsx scripts/generate-stop-fixture.mts
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileDesignFile} from '../packages/lab-runtime/src/engineering/electrical/offline';
import {deriveControlProfile,deriveDriveModel} from '../packages/lab-runtime/src/engineering/electrical/drive-derivation';
import {sealDriveDocument,type ControlProfileV1,type DriveModelV1} from '../packages/lab-runtime/src/v2/control/drive-io';
import type {DesignContext} from '../packages/lab-runtime/src/engineering/electrical/design';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),OUT='robotics/simulation-mujoco/fixtures/stop-v1';
const sha=(b:string)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';

export async function generateStopFixture(outDir:string):Promise<void>{
 const r=await compileDesignFile({design:join(ROOT,'robotics/catalog/electrical/serve-hw-c-v1.json'),catalogRoot:join(ROOT,'robotics/catalog'),root:ROOT});
 if(!r.bundle||r.bundle.state!=='compiled')throw new Error('HW_C_NOT_COMPILED');
 const dir=join(ROOT,'robotics/simulation-mujoco/fixtures/drive-v1'),base=JSON.parse(await readFile(join(dir,'serve-drive-nominal-v1.json'),'utf8')) as DriveModelV1,baseControl=JSON.parse(await readFile(join(dir,'serve-control-v2.json'),'utf8')) as ControlProfileV1;
 const ctx={design:r.design!,profiles:r.profiles} as unknown as DesignContext;
 const derived=deriveDriveModel(base,ctx,deriveControlProfile(baseControl,ctx,[]));
 if(derived.checks.some(c=>c.level==='blocking'))throw new Error('DERIVATION_BLOCKED');
 const variant=(onDisable:'brake'|'coast')=>sealDriveDocument({...derived.model,id:`serve-drive-hw-c-${onDisable}-v1`,revision:1,axes:derived.model.axes.map(a=>({...a,onDisable,brakeTorqueNm:onDisable==='coast'?null:a.brakeTorqueNm}))}) as DriveModelV1;
 const brake=variant('brake'),coast=variant('coast');
 const control=deriveControlProfile(baseControl,ctx,[brake.digest,coast.digest]);
 const sealed=sealDriveDocument({...control,id:'serve-control-hw-c-v1',revision:1,digest:undefined});
 const files:Record<string,string>={'serve-drive-hw-c-brake-v1.json':json(brake),'serve-drive-hw-c-coast-v1.json':json(coast),'serve-control-hw-c-v1.json':json(sealed)};
 files['README.md']=README(brake,coast);
 await mkdir(outDir,{recursive:true});
 for(const [n,t] of Object.entries(files))await writeFile(join(outDir,n),t);
 await writeFile(join(outDir,'manifest.json'),json({schemaVersion:1,documentType:'drive-fixture-manifest',id:'stop-v1',generator:'scripts/generate-stop-fixture.mts',calibration:'not_calibrated',files:Object.keys(files).sort().map(path=>({path,sha256:sha(files[path]!),bytes:Buffer.byteLength(files[path]!)}))}));
}
const README=(brake:DriveModelV1,coast:DriveModelV1)=>`# stop-v1

Drive models and a control profile for the stop-behaviour campaign, derived from the HW-C hardware option (BLVD-KRD drives with BLV-R 60 W motors; HW-A has the same drives but does not compile). Nothing here is calibrated.

- \`serve-drive-hw-c-brake-v1.json\`: the derived model with \`onDisable: brake\`. The BLV-R 60 W profile documents no brake output, so the brake torque (${brake.axes[0]!.brakeTorqueNm} N m) is the R4 fixture's assumed value and stands for an external brake.
- \`serve-drive-hw-c-coast-v1.json\`: the same model with \`onDisable: coast\` and no brake torque. It differs from the brake variant in exactly those two fields.
- \`serve-control-hw-c-v1.json\`: the R4 control profile with the acceleration limit a pv-only drive ramps with, taken from the profile (1000 (r/min)/s, HP-5143-3E p.103). It lists both drive models.

The encoder counts and the watchdog range of the BLVD-KRD are not documented in a way that changes the R4 model, so the derived model equals the R4 nominal model apart from id and revision (coast digest ${coast.digest.slice(0,12)}).
`;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateStopFixture(join(ROOT,OUT));
