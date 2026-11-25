import {checkedRuntime} from './runtime-artifact.mjs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Node.js 24 required. Use the version in .node-version, then run pnpm runtime.');
const {file}=await checkedRuntime(root);
// a local launcher never uses an access key: the runtime always prints a one-use pairing code
const {MEKONIQ_LAB_ACCESS_KEY:_key,...env}=process.env;
const child=spawn(process.execPath,[file,'--port','4176','--data-dir',`${root}runs`,...process.argv.slice(2)],{stdio:'inherit',cwd:root,env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code)=>{process.exitCode=code??1;});
