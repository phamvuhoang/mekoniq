import {parseJsonStrict} from '../../../../packages/contracts/src/index';
import {registerWave02Routes,type CloudRoute} from './modules/routes';
import {resolveActor} from './modules/identity/session';
const routes:CloudRoute[]=[];
registerWave02Routes(route=>routes.push(route));
export async function dispatchRequest(request:Request) {
  const path=new URL(request.url).pathname;
  for(const route of routes) {
    if(route.method!==request.method) continue;
    const names:string[]=[];
    const pattern=route.path.split('/').map(segment=>{
      if(segment.startsWith(':')) {names.push(segment.slice(1));return '([^/]+)';}
      return segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    }).join('/');
    const match=path.match(new RegExp(`^${pattern}$`)); if(!match) continue;
    try {
      const actor=await resolveActor(request);
      if(route.permission&&!actor) return Response.json({code:'UNAUTHENTICATED'},{status:401});
      if(route.permission&&actor&&!actor.permissions.includes(route.permission)&&!actor.permissions.includes('*')) return Response.json({code:'FORBIDDEN'},{status:403});
      const reader=request.body?.getReader(); let bytes=0;const chunks:Uint8Array[]=[];
      if(reader) while(true) {
        const {value,done}=await reader.read();if(done)break;
        bytes+=value.byteLength;if(bytes>route.bodyLimit) {await reader.cancel();return Response.json({code:'PAYLOAD_TOO_LARGE'},{status:413});}
        chunks.push(value);
      }
      const text=Buffer.concat(chunks).toString('utf8');
      const body=text?parseJsonStrict(text,route.bodyLimit):null;
      const params=Object.fromEntries(names.map((n,i)=>[n,decodeURIComponent(match[i+1])]));
      const response=await route.handler(request,{actor,params,body});
      response.headers.set('Cache-Control','no-store');return response;
    } catch(error) {
      const code=error instanceof Error?error.message:'INTERNAL_ERROR';
      const status=code.includes('FORBIDDEN')?403:code.includes('PAYLOAD_TOO_LARGE')?413:code.startsWith('INVALID')||code==='DUPLICATE_JSON_KEY'?400:503;
      return Response.json({code:status===503?'SERVICE_UNAVAILABLE':code},{status,headers:{'Cache-Control':'no-store'}});
    }
  }
  return Response.json({code:'NOT_FOUND'},{status:404});
}
