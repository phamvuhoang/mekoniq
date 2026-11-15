// HTTP action persistence shared by the container writer and portable writer-to-reader tests.
import {performance} from 'node:perf_hooks';
export function createActionRecorder({runId,revision,requests,httpMs,save,api,memory}){
 let action=0;
 return async(kind,payload={})=>{
  const actionId='native-'+(++action),r={actionId,kind,payload,received:false},t=performance.now();
  requests.push(r);await save('requests.json',requests);
  const next=await api('/runs/'+runId+'/actions','POST',{actionId,expectedRevision:revision,kind,payload});
  r.received=true;httpMs.push(performance.now()-t);revision=next.run.runRevision;
  // Persist attempts before dispatch and successful completion before returning.
  await save('requests.json',requests);
  await memory();return next;
 };
}
