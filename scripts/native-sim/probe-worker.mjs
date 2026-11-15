// Fresh trusted worker. Fixed allowlist; no caller-controlled module paths or checker identity override.
import {checkedCheckerIdentity} from '../native-checker-bootstrap.mjs';
import {isDeepStrictEqual} from 'node:util';
const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP','SIGALRM'])process.once(s,()=>abort.abort());
process.once('message',async({operation,input,checker:expected})=>{
 let result,error,checker;
 try{
  checker=await checkedCheckerIdentity();if(!isDeepStrictEqual(checker,expected))throw Error('CHECKER_CHANGED_DURING_ASSESSMENT');
  if(operation==='run-r2b'||operation==='verify-r2b'){const m=await import('./r2b-campaign-core.mjs');result=operation==='run-r2b'?await m.runR2bNative({...input,checker,signal:abort.signal}):await m.verifyR2bNative(input.root,checker);}
  else if(operation==='prepare'){const m=await import('./prepare-mujoco-r2a-core.mjs');result=await m.prepareR2aHandoff({...input,checker});}
  else{
   const m=await import('./mujoco-probe-core.mjs');
   if(operation==='run')result=await m.runMujocoProbe({...input,checker,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(1500000)])});
   else if(operation==='verify')result=await m.verifyMujocoProbe(input.root,checker);
   else if(operation==='read')result=await m.readMujocoProbeSupplement(input.root,checker);
   else if(operation==='copy')result=await m.copyMujocoProbeSupplement(input.input,input.out,checker);
   else throw Error('CHECKER_OPERATION_REJECTED');
  }
 }catch(e){error=e.message;}
 try{if(!checker||!isDeepStrictEqual(await checkedCheckerIdentity(),checker))throw Error('CHECKER_CHANGED_DURING_ASSESSMENT');}catch(e){error=e.message;}
 process.send(error?{error}:{result},()=>process.disconnect());
});
