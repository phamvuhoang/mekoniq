import type {JsonObject} from '../../../packages/contracts/src/index';
import type {CloudRequest} from './cloud-sync';
export type NativeCloudClient={
 cloudRequest(input:{requestId:string;method:'GET'|'POST';path:string;body?:JsonObject}):Promise<{status:number;body:JsonObject}>;
 cancelNetworkRequest(input:{requestId:string}):Promise<{cancelled:boolean}>;
};
/** Correlate JS cancellation with the native socket, never serialize an AbortSignal over the bridge. */
export function nativeCloudRequest(client:NativeCloudClient):CloudRequest {
 return async({signal,...input})=>{
  if(signal?.aborted)throw signal.reason ?? new Error('CLOUD_REQUEST_CANCELLED');
  const requestId=crypto.randomUUID();
  const cancel=()=>{void client.cancelNetworkRequest({requestId}).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{return await client.cloudRequest({...input,requestId});}
  finally{signal?.removeEventListener('abort',cancel);}
 };
}
