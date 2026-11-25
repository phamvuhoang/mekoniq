import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedRuntime} from './runtime-artifact.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),{file}=await checkedRuntime(root);
for(const name of ['lab-run-verification','lab-arm-collision-evidence','lab-transfer-evidence']){
 const path=`${name}.schema.json`,a=await readFile(join(root,'src/reports/contracts',path)),b=await readFile(join(dirname(file),'schemas',path));
 if(!a.equals(b))throw new Error(`VERIFICATION_SCHEMA_PIN_MISMATCH:${path}`);
}
const fault='lab-fault-schedule.schema.json';if(!(await readFile(join(root,'src/scenarios/contracts',fault))).equals(await readFile(join(dirname(file),'schemas',fault))))throw new Error('FAULT_SCHEMA_PIN_MISMATCH');
console.log('Verification schemas match the installed source pin.');
