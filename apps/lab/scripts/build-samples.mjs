// Builds public/samples/ with the product's own tools; no file is edited by hand. Usage:
//   node scripts/build-samples.mjs --stop-archive <stop-v1 campaign dir>
// hardware-candidate: `lab-hardware.mjs package` on serve-hw-c-v1 (HW-A compiles to blocked, so it has no package). stop-report: the four S1 stop-report.json files of the archive.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const lab=resolve(dirname(fileURLToPath(import.meta.url)),'..'),source=resolve(lab,'../..'),out=join(lab,'public/samples');
const i=process.argv.indexOf('--stop-archive'),archive=i>0?process.argv[i+1]:undefined;
if(!archive){console.error('usage: build-samples.mjs --stop-archive DIR');process.exit(2);}
const sha=b=>createHash('sha256').update(b).digest('hex');
await rm(out,{recursive:true,force:true});await mkdir(join(out,'stop-report'),{recursive:true});
const pkg=spawnSync(process.execPath,[join(source,'scripts/lab-hardware.mjs'),'package','--design',join(source,'robotics/catalog/electrical/serve-hw-c-v1.json'),'--out',join(out,'hardware-candidate')],{stdio:'inherit'});
if(pkg.status!==0)process.exit(pkg.status??1);
const files=[];
for(const c of ['s1-normal','s1-protective','s1-emergency-coast','s1-emergency-brake']){
 const bytes=await readFile(join(archive,c,'stop-report.json'));await writeFile(join(out,'stop-report',`${c}.json`),bytes);files.push({path:`${c}.json`,sha256:sha(bytes)});
}
const stopManifest=JSON.stringify({schemaVersion:1,documentType:'stop-report-sample',accepted:false,calibration:'not_calibrated',files},null,2)+'\n';
await writeFile(join(out,'stop-report/manifest.json'),stopManifest);
const hw=await readFile(join(out,'hardware-candidate/manifest.json'));
const entry=(id,kind,manifest,bytes)=>({id,kind,manifest,sha256:sha(bytes),calibration:'not_calibrated',accepted:false});
await writeFile(join(out,'catalog.json'),JSON.stringify([entry('hardware-candidate','hardware_candidate','samples/hardware-candidate/manifest.json',hw),entry('stop-report','stop_report','samples/stop-report/manifest.json',Buffer.from(stopManifest))],null,2)+'\n');
console.log('wrote public/samples');
