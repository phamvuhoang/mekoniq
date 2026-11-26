#!/usr/bin/env node
// The bench agent's command line (K07b; spec B1 §1, §6). One command per question the operator answers; the session flow is packages/bench/src/cli-flow.ts.
//   node scripts/bench.mjs doctor   [--kit FILE]
//   node scripts/bench.mjs identify --kit FILE --policy FILE --session FILE --out DIR [--bus sim]
//   node scripts/bench.mjs run      --kit FILE --policy FILE --session FILE --identity DIR --suite conformance|measure --out DIR [--from CASE] [--case CASE] [--bus sim]
//   node scripts/bench.mjs sensors  --kit FILE --policy FILE --session FILE --out DIR [--case CASE] [--bus sim]
//   node scripts/bench.mjs verify   --record DIR
// Exit 0: every case tested (doctor: every check ok; verify: no issue). 1: refused or failed at run time, including the refusals of `run` before any worker (session
// declarations, identity, --from) and a worker that would not close. 2: usage (options, unreadable or invalid kit/policy/session files, --bus, --out, the test answers file).
// No flag skips arming, a prompt, the identity check, a limit or the case order. The only test hooks are BENCH_TEST_ARMING=1 and BENCH_TEST_ANSWERS=<file>,
// honoured only with a kit on the simulated slave. On a terminal any key outside a question stops the run (quick stop, then enable off); while a question (the arming
// code, an operator prompt) is open, keys go into the answer and only Ctrl-C stops. SIGINT, SIGTERM and SIGHUP stop too; a repeat while stopping is ignored.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {networkInterfaces,release,version} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),PY=process.env.BENCH_PYTHON??'python3',SIM_KIT=join(root,'robotics/bench/fixtures/kit-sim-v1.json');
const OPTIONS={doctor:{kit:0},identify:{kit:1,policy:1,session:1,out:1,bus:0},run:{kit:1,policy:1,session:1,identity:1,suite:1,out:1,from:0,case:0,bus:0},
 sensors:{kit:1,policy:1,session:1,out:1,case:0,bus:0},verify:{record:1}};
const usage=(code,detail='')=>{console.error(`REFUSED ${code}${detail?` ${detail}`:''}\nusage: bench.mjs doctor|identify|run|sensors|verify (see the head of scripts/bench.mjs)`);process.exit(2);};
const [command,...args]=process.argv.slice(2),allowed=OPTIONS[command],o={};
if(!allowed)usage('INVALID_OPTION',`command ${command??'(none)'}`);
for(let i=0;i<args.length;i+=2){
 const a=args[i],k=a.startsWith('--')?a.slice(2):'';
 if(!Object.hasOwn(allowed,k)||o[k]!==undefined)usage('INVALID_OPTION',a);
 if(args[i+1]===undefined||args[i+1].startsWith('--'))usage('MISSING_OPTION',`${a} needs a value`);
 o[k]=args[i+1];
}
for(const [k,required] of Object.entries(allowed))if(required&&o[k]===undefined)usage('MISSING_OPTION',`--${k}`);
const ts=(p)=>tsImport(join(root,'packages/bench/src',p),import.meta.url);
const {spawnBenchWorker}=await ts('worker.ts'),{validateBenchKit,validateBenchPolicy,validateBenchSession}=await ts('contracts.ts');
const readJson=(f)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch(e){return {unreadable:e.message};}};

if(command==='verify'){
 const {verifyBenchRecord}=await ts('record.ts'),v=await verifyBenchRecord(resolve(o.record));
 for(const i of v.issues)console.log(`${i.code} ${i.path}`);
 console.log(v.ok?'the record reads back without an issue':`${v.issues.length} issue(s)`);
 process.exit(v.ok?0:1);
}

if(command==='doctor'){
 // read-only checks: files, /sys, os.networkInterfaces(), and a python that prints its version or opens (and closes) one raw socket
 const checks=[],check=async(id,f)=>{let r;try{const [ok,detail]=await f();r={id,ok:!!ok,detail:String(detail)};}catch(e){r={id,ok:false,detail:String(e?.message??e).slice(0,300)};}checks.push(r);console.log(JSON.stringify(r));};
 const linux=process.platform==='linux',onLinux=(f)=>linux?f():[false,'linux only'],venv=join(root,'.venv-bench/bin/python');
 const py=(exe,code)=>spawnSync(exe,['-I','-B','-c',code],{encoding:'utf8',timeout:10000});
 await check('node',()=>[process.versions.node.split('.')[0]==='24',`node ${process.versions.node} (24 required)`]);
 await check('python',()=>{const r=py(PY,'import sys;print("%d.%d.%d"%sys.version_info[:3])');if(r.error||r.status!==0)return [false,`${PY}: ${r.error?.message??r.stderr.trim()}`];
  const v=r.stdout.trim(),[a,b]=v.split('.').map(Number);return [a>3||a===3&&b>=9,`${PY} ${v} (3.9 or later)`];});
 await check('worker',async()=>{const w=await spawnBenchWorker({role:'bus',python:PY,kitPath:SIM_KIT,bus:'sim',readOnly:true,sessionId:'doctor'});
  try{const a=await w.request('describe',{},0);return [a.ok,a.ok?`bench worker ${a.result.version} answers describe on the simulated kit`:a.error.code];}finally{await w.close();}});
 await check('venv',()=>existsSync(venv)?[true,venv]:[false,'.venv-bench is missing: expected before the first hardware session (runbook, host preparation)']);
 if(o.kit){
  let kit=null;
  await check('kit',()=>{const k=validateBenchKit(readJson(resolve(o.kit)));if(k.ok)kit=k.kit;return k.ok?[true,`${k.kit.id} r${k.kit.revision}, bus ${k.kit.bus.backend}`]:[false,k.problems.map(p=>`${p.code} ${p.path}`).join('; ')];});
  if(kit?.bus.backend==='soem'){
   const ports=[kit.sensors.lidar?.port,kit.sensors.imu?.port].filter(Boolean),nic=kit.bus.interface??'';
   await check('nic',()=>onLinux(()=>{const up=existsSync(`/sys/class/net/${nic}`),ip=(networkInterfaces()[nic]??[]).filter(a=>a.family==='IPv4');
    return [up&&!ip.length,!up?`interface ${nic} not found`:ip.length?`${nic} has an IPv4 address; the EtherCAT NIC takes none`:`${nic} present, no IPv4 address`];}));
   await check('cap_net_raw',()=>onLinux(()=>{if(!existsSync(venv))return [false,'needs .venv-bench'];const r=py(venv,'import socket;socket.socket(socket.AF_PACKET,socket.SOCK_RAW).close()');
    return [r.status===0,r.status===0?'the venv python opens a raw socket':`no raw socket: ${r.stderr.trim().split('\n').at(-1)}`];}));
   await check('serial_ports',()=>{const missing=ports.filter(p=>!existsSync(p));return [!missing.length,ports.length?missing.length?`missing ${missing.join(', ')}`:`present ${ports.join(', ')}`:'the kit names no sensor port'];});
   await check('ftdi_latency',()=>onLinux(()=>{const bad=ports.map(p=>{const t=`/sys/bus/usb-serial/devices/${basename(existsSync(p)?realpathSync(p):p)}/latency_timer`;
    const v=existsSync(t)?readFileSync(t,'utf8').trim():'unreadable';return v==='1'?null:`${p} latency_timer ${v}`;}).filter(Boolean);return [!bad.length,bad.join('; ')||'every sensor port at 1 ms'];}));
   await check('kernel',()=>onLinux(()=>[true,`${release()} ${version()}; PREEMPT_RT ${existsSync('/sys/kernel/realtime')&&readFileSync('/sys/kernel/realtime','utf8').trim()==='1'?'on':'off'} (recorded; enable it only if the jitter measurement asks)`]));
  }
 }
 process.exit(checks.every(c=>c.ok)?0:1);
}

const kitPath=resolve(o.kit),k=validateBenchKit(readJson(kitPath)),p=validateBenchPolicy(readJson(resolve(o.policy))),s=validateBenchSession(readJson(resolve(o.session)));
for(const [what,v] of [['BENCH_KIT_INVALID',k],['BENCH_POLICY_INVALID',p],['BENCH_SESSION_INVALID',s]])if(!v.ok)usage(what,v.problems.map(x=>`${x.code} ${x.path} ${x.detail}`).join('; '));
const bus=o.bus??k.kit.bus.backend;
if(bus!==k.kit.bus.backend)usage('BENCH_BUS_MISMATCH',`--bus ${bus}, the kit's bus is ${k.kit.bus.backend}`);
if(bus!=='sim')usage('BENCH_BUS_UNAVAILABLE','the soem bus arrives with the first hardware session');
const flow=await ts('cli-flow.ts'),out=resolve(o.out),bad=flow.outProblem(out,command==='run'&&o.from!==undefined);
if(bad)usage(bad,out);
const log=(x)=>console.log(x),l={kit:k.kit,kitPath,policy:p.policy,session:s.session};
for(const line of flow.describeSession(s.session))log(line);

// the terminal: one readline for the arming code and the prompts; outside a question any key aborts (the runner then stops the axes and disarms)
const tty=process.stdin.isTTY===true,ac=new globalThis.AbortController();let rl,asking=false;
const stop=(why)=>{if(!ac.signal.aborted){ac.abort();log(`\n${why}: stopping (quick stop, then enable off); the suite will not continue`);}};
// a signal is an abort too: the case stops, the part is still written. The handler stays: a repeat never cuts the stop sequence (only the worker deadlines bound it)
let waitSaid=false;
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>{if(!ac.signal.aborted)stop(sig);else if(!waitSaid){waitSaid=true;log('stopping; wait');}});
if(tty){rl=createInterface({input:process.stdin,output:process.stdout,terminal:true});rl.on('SIGINT',()=>stop('Ctrl-C'));process.stdin.on('keypress',()=>{if(!asking)stop('key pressed');});}
// an aborted arming question answers '' (a wrong code: not armed); an aborted prompt never answers, so the runner's hold ends it OPERATOR_ABORT
const question=async(q,hang)=>{asking=true;try{return await rl.question(q,{signal:ac.signal});}catch{return hang?new Promise(()=>{}):'';}finally{asking=false;}};
let prompter;try{prompter=flow.prompterFor(k.kit,process.env,{isTTY:tty,question:(q)=>question(q,true)},log);}catch(e){rl?.close();usage(e.code??'BENCH_TEST_ANSWERS_INVALID',e.message);}
const io={spawn:(role,readOnly)=>spawnBenchWorker({role,python:PY,kitPath,bus,readOnly,sessionId:randomUUID()}),clock:(await ts('clock.ts')).systemClock,
 arming:flow.armingFor(k.kit,process.env,{isTTY:tty,question:(q)=>question(q,false)},log),prompter,abort:ac.signal,log};
if(!tty&&command!=='identify'&&flow.testHook('BENCH_TEST_ARMING',k.kit,process.env,()=>{})!=='1')log('stdin is not a terminal: no arming, no prompts; torque cases and prompt cases will be not_run.');
let code;
try{
 code=command==='identify'?await flow.identify(l,out,io)
  :command==='run'?await flow.run(l,{identity:resolve(o.identity),suite:o.suite,out,from:o.from,only:o.case},io)
  :await flow.sensors(l,{out,only:o.case},io);
}catch(e){console.error(`REFUSED ${e?.message??e}`);code=e?.code==='INVALID_OPTION'?2:1;}
rl?.close();
process.exit(code);
