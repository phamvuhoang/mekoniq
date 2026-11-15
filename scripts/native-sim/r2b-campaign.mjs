#!/usr/bin/env node
import {invokeCheckedProbe} from './probe-bootstrap.mjs';
const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--handoff','--out','--verify'].includes(args[i])||!args[i+1]||o[args[i]])throw Error('R2B_ARGUMENT');o[args[i]]=args[i+1];}
const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.once(s,()=>abort.abort());
const v=o['--verify']&&Object.keys(o).length===1?await invokeCheckedProbe('verify-r2b',{root:o['--verify']},abort.signal):o['--handoff']&&o['--out']&&Object.keys(o).length===2?await invokeCheckedProbe('run-r2b',{handoff:o['--handoff'],out:o['--out']},abort.signal):null;
if(!v)throw Error('R2B_ARGUMENT');console.log(JSON.stringify(v,null,2));process.exitCode=v.passed||v.qualification==='passed'?0:2;
