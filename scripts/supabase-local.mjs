import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const action=process.argv[2];
const config=readFileSync('supabase/config.toml','utf8');
if(!['start','stop','reset'].includes(action)||!config.includes('project_id = "mekoniq-w00-w04"')||!config.includes('port = 57422')) throw new Error('LOCAL_PROJECT_REQUIRED');
const args=action==='reset'?['db','reset','--local']:action==='start'?['start','-x','studio,imgproxy,edge-runtime,logflare,vector']:['stop'];
const result=spawnSync('pnpm',['exec','supabase',...args],{stdio:'inherit'});
process.exit(result.status??1);
