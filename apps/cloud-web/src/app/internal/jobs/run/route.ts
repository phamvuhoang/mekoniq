import {authorizeJobRequest,runJobBatch} from '../../../../server/jobs/outbox-worker';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
export async function POST(request:Request){
 const text=await request.text();if(Buffer.byteLength(text)>4096)return Response.json({code:'PAYLOAD_TOO_LARGE'},{status:413});
 if(!await authorizeJobRequest(request,text))return Response.json({code:'UNAUTHORIZED'},{status:401});
 try{const scope=JSON.parse(text);if(typeof scope.organizationId!=='string'||typeof scope.venueId!=='string')throw new Error();return Response.json(await runJobBatch(scope),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({code:'BATCH_FAILED'},{status:503});}
}
