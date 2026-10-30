import {readFile} from 'node:fs/promises';
const profile=JSON.parse(await readFile(new URL('../deploy/profiles/supabase-free.json',import.meta.url),'utf8'));
let supplied={};const fixture=process.argv.indexOf('--measurements');if(fixture>=0){if(!process.argv[fixture+1])throw new Error('MEASUREMENT_FILE_REQUIRED');supplied=JSON.parse(await readFile(process.argv[fixture+1],'utf8'));}
const report={profile:profile.id,quotaSnapshotAt:profile.snapshotAt,generatedAt:new Date().toISOString(),hostedStatus:'not_verified',metrics:profile.quotas.map(q=>{
 const m=supplied[q.metric];const measured=typeof m?.used==='number'&&Number.isFinite(m.used)&&m.used>=0&&typeof m.source==='string'&&typeof m.measuredAt==='string'&&Number.isFinite(Date.parse(m.measuredAt));
 const used=measured?m.used:null;return {...q,used,source:measured?m.source:null,measuredAt:measured?m.measuredAt:null,state:used===null?'unknown':used>=q.limit*.85?'critical':used>=q.limit*.7?'warning':'normal'};
})};console.log(JSON.stringify(report,null,2));
