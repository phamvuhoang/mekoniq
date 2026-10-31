import {randomBytes,createHmac} from 'node:crypto';
const endpoint=process.env.JOBS_URL??'http://127.0.0.1:3400/internal/jobs/run';
const secret=process.env.JOB_HMAC_SECRET;
if(!secret||secret.length<32||!process.env.ORGANIZATION_ID||!process.env.VENUE_ID){console.error('PREREQUISITE: JOB_HMAC_SECRET, ORGANIZATION_ID and VENUE_ID required');process.exit(2);}
const body=JSON.stringify({organizationId:process.env.ORGANIZATION_ID,venueId:process.env.VENUE_ID});const timestamp=String(Date.now());const nonce=randomBytes(24).toString('base64url');
const signature=createHmac('sha256',secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-job-timestamp':timestamp,'x-job-nonce':nonce,'x-job-signature':signature},body});
console.log(await response.text());if(!response.ok)process.exit(1);
