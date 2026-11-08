// Test-only process: one would-be writer of a navigation evidence directory. Prints "ready", opens the recorder when it reads "go" on stdin and prints
// "won" or "refused:<message>", then (when it won) holds the writer lock until it reads "exit" (closing the recorder) or is killed.
import {createInterface} from 'node:readline';
import {openNavigationRecorder} from '../../packages/lab-runtime/src/v2/navigation2d/evidence.ts';
import {navigationScene} from './navigation2d.ts';
const scene=navigationScene('serve'),lines=createInterface({input:process.stdin});
let rec;
console.log('ready');
for await(const line of lines){
 if(line==='go'){
  try{
   rec=await openNavigationRecorder({directory:process.env.MEKONIQ_TEST_EVIDENCE,scene,runId:'run-a'});
   console.log('won');
  }catch(e){console.log(`refused:${e.message}`);}
 }else if(line==='exit'){await rec?.close?.();process.exit(0);}
}
