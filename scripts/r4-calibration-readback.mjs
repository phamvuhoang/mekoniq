// Read a calibration self-test from an R4 input or directly with --input DIR.
import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {closureIdentity} from './lab-irsim.mjs';

const root=resolve(import.meta.dirname,'..');
const calibrationDir='inputs/calibration';
export const CALIBRATION_INPUT=calibrationDir+'/calibration-selftest.json';
export async function readCalibrationDirectory(directory,expected,sha256){
 const {verifyCalibrationSelftest}=await tsImport('./r4-calibration-evidence.ts',import.meta.url);
 return verifyCalibrationSelftest(directory,expected,sha256);
}
export async function readCalibrationInput(directory,manifest){
 const ref=manifest.inputs?.calibrationSelftest,corrupt=['CALIBRATION_SELFTEST_CORRUPT'];
 try{
  if(!lstatSync(directory).isDirectory())return corrupt;
  const inputs=lstatSync(join(directory,'inputs'),{throwIfNoEntry:false});
  if(inputs&&!inputs.isDirectory())return corrupt;
  const payload=join(directory,calibrationDir),present=inputs&&lstatSync(payload,{throwIfNoEntry:false});
  if(ref===undefined&&!present)return ['CALIBRATION_SELFTEST_MISSING'];
  if(!present?.isDirectory()||ref?.file!==CALIBRATION_INPUT||!/^[a-f0-9]{64}$/.test(ref.sha256??''))return corrupt;
  return await readCalibrationDirectory(payload,manifest.identity?.before,ref.sha256);
 }catch{return corrupt;}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [option,dir,extra]=process.argv.slice(2);
 if(option!=='--input'||!dir||dir.startsWith('--')||extra!==undefined){
  console.error('usage: r4-calibration-readback.mjs --input DIR');
  process.exitCode=2;
 }else{
  const expected={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),toolClosures:closureIdentity(root)};
  const issues=await readCalibrationDirectory(resolve(dir),expected);
  console.log(JSON.stringify({accepted:false,issues}));
  process.exitCode=issues.length?1:0;
 }
}
