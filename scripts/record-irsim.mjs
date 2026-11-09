#!/usr/bin/env node
// Records the IR-SIM qualification campaign (robotics/navigation-2d/campaigns/c02-qualification.json) into a fresh evidence directory, through the same batch runner,
// worker and oracles as scripts/lab-irsim.mjs, with the candidate identity stamped before and after:
//   node scripts/record-irsim.mjs --out DIR [--concurrency 1|2] [--campaign ID] [--irsim-python PATH]
// Refuses an existing --out (never overwrites earlier evidence) and a source tree with uncommitted changes. The record is an evidence INPUT: accepted is always false.
// Exit codes as lab-irsim.mjs: 0 complete and all pass, 1 failed/incomplete, 2 prerequisite/usage (not_run), 130/143 on a signal.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {arch,platform,release} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,sourceCommit} from './lab-irsim.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=(code,m)=>{console.error(`${code}: ${m}`);process.exit(code==='NOT_RUN'?2:1);};
const argv=process.argv.slice(2),o=parse('run',['--campaign',argv.includes('--campaign')?argv[argv.indexOf('--campaign')+1]:'c02-qualification',...argv.filter((a,i)=>a!=='--campaign'&&argv[i-1]!=='--campaign')]);
if(!o.out)fail('NOT_RUN','MISSING_OPTION:--out');
if(existsSync(o.out))fail('NOT_RUN',`OUT_EXISTS: ${o.out} (a record is written once, into a new directory)`);
const identity=()=>{const commit=sourceCommit(),lock=join(root,'robotics/navigation-2d/requirements.lock');
 return {sourceCommit:commit,dirty:commit.endsWith('-dirty'),node:process.version,os:`${platform()} ${release()}`,arch:arch(),lockSha256:existsSync(lock)?createHash('sha256').update(readFileSync(lock)).digest('hex'):null,at:new Date().toISOString()};};
const before=identity();
if(before.dirty)fail('NOT_RUN','SOURCE_DIRTY: commit the source before recording evidence');
await mkdir(o.out,{recursive:true,mode:0o700});
const args=['scripts/lab-irsim.mjs','run','--campaign',o.campaign,'--out',join(o.out,'campaign'),'--concurrency',String(o.concurrency??1),...o['irsim-python']?['--irsim-python',o['irsim-python']]:[]];
// the campaign runs as its own process (its own signal handling and worker groups); this one only stamps identities around it
// a signal to this process is forwarded (a terminal Ctrl-C reaches both); the record is still written with the campaign's latched exit code
const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{child.kill(sig);});
const exit=await new Promise(done=>child.once('close',(status,signal)=>done({status,signal})));
const after=identity(),code=exit.status??(exit.signal==='SIGINT'?130:exit.signal==='SIGTERM'?143:1);
let summary=null;try{summary=JSON.parse(await readFile(join(o.out,'campaign','summary.json'),'utf8'));}catch{summary=null;}
const record={schemaVersion:1,documentType:'irsim-qualification-record',accepted:false,note:'evidence input for review; implemented/tested/accepted stay independent and no gate status is changed here',
 before,after,identityStable:before.sourceCommit===after.sourceCommit&&!after.dirty,command:`node ${args.join(' ')}`,exitCode:code,
 summary:summary?{path:'campaign/summary.json',status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider,
  sha256:createHash('sha256').update(await readFile(join(o.out,'campaign','summary.json'))).digest('hex')}:null};
await writeFile(join(o.out,'irsim-record.json'),JSON.stringify(record,null,1)+'\n',{flag:'wx'});
if(!record.identityStable){console.error('FAILED: the source commit changed or became dirty while recording');process.exit(1);}
process.exit(code);
