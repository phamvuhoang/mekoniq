// Own the installed pinned runtime and Vite directly. Raw child logs never leave memory.
// Engineering compilation is an explicit opt-in; no native-config is supplied.
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const c = require('./common.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function requireFreePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error',reject); probe.listen(port,'127.0.0.1',resolve); });
  await new Promise(resolve => probe.close(resolve));
}
function own(command, args, options) {
  const child = spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
  child.stdout.resume(); child.stderr.resume();
  // Consume both streams without ever forwarding raw token-bearing logs.
  child.on('error',()=>{});
  const exited = new Promise(resolve => child.once('exit',resolve));
  return { child, exited };
}
async function stopOwned(owned) {
  await Promise.all(owned.map(async ({child,exited}) => {
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    await Promise.race([exited,delay(6000)]);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  }));
}
(async () => {
  const {checkedRuntime} = await import(pathToFileURL(path.join(c.lab,'scripts/runtime-artifact.mjs')));
  const {file,lock} = await checkedRuntime(c.lab);
  c.expect(lock).toEqual(c.runtimePin);
  await requireFreePort(4175); await requireFreePort(4176);
  const python = path.join(c.source,'.venv/bin/python');
  fs.accessSync(python,fs.constants.X_OK);
  const dataDir = fs.mkdtempSync('/tmp/mekoniq-guide-runtime-');
  const owned=[];
  let runner, stage='runtime startup', cancelled=false;
  const stop=()=>{cancelled=true;runner?.kill('SIGTERM');void stopOwned(owned);};
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  try {
    const runtime=own(process.execPath,[file,'--port','4176','--data-dir',dataDir,
      '--engineering-catalog',path.join(c.source,'robotics/catalog'),
      '--engineering-simulation',path.join(c.source,'robotics/simulation'),
      '--engineering-python',python],{cwd:c.lab,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    owned.push(runtime);
    const token=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('RUNTIME_TOKEN_TIMEOUT')),45000);
      runtime.child.stdout.on('data',chunk=>{
        output=(output+String(chunk)).slice(-65536);
        // Actual source cli.ts stdout, distinct from start-mock.mjs launcher wording.
        const match=/Pairing token \(expires in 5 minutes; one use\): ([A-Za-z0-9_-]+)\r?\n/.exec(output);
        if(match){clearTimeout(timer);resolve(match[1]);output='';}
      });
      runtime.child.once('error',()=>{clearTimeout(timer);reject(new Error('RUNTIME_START_FAILED'));});
      runtime.child.once('exit',()=>{clearTimeout(timer);reject(new Error('RUNTIME_EXITED_BEFORE_PAIRING'));});
    });
    stage='runtime identity and engineering capability';
    const healthResponse=await fetch('http://127.0.0.1:4176/lab/v2/health');
    c.expect(healthResponse.ok).toBe(true);
    const health=await healthResponse.json();
    // Actual v2 gateway fields are flat sourceCommit/schemaHash, not source.commit.
    c.expect(health.sourceCommit).toBe(lock.sourceCommit);
    c.expect(health.schemaHash).toBe(lock.schemaHash);
    c.expect(health.protocolMajors).toContain(2);
    c.expect(health.capabilities).toContain('engineering_bundle_v1');
    const enabled=(health.backends||[]).filter(b=>b.enabled).map(b=>b.id).sort();
    c.expect(enabled).toEqual(['mock_amr','mock_arm','mock_coffee']);
    if(cancelled)throw new Error('CANCELLED');
    stage='Vite startup';
    const ui=own(process.execPath,[path.join(c.lab,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4175','--strictPort'],{cwd:c.lab,env:{...process.env,LAB_RUNTIME_PORT:'4176'}});
    owned.push(ui);
    let ready=false;
    for(let n=0;n<120&&!cancelled;n++){
      if(ui.child.exitCode!==null||runtime.child.exitCode!==null)throw new Error('OWNED_SERVICE_EXITED');
      try{if((await fetch('http://127.0.0.1:4175/')).ok){ready=true;break;}}catch{}
      await delay(250);
    }
    if(!ready)throw new Error('UI_NOT_READY');
    console.log('Pinned runtime with engineering compiler and isolated Vite ready; pairing token held in memory.');
    stage='browser capture';
    runner=spawn(process.execPath,[path.join(__dirname,'lab.cjs')],{cwd:c.lab,env:{...process.env,LAB_TEST_PAIRING_TOKEN:token,LAB_TEST_PAIRING_TOKEN_FILE:''},stdio:'inherit'});
    process.exitCode=await new Promise((resolve,reject)=>{runner.once('error',reject);runner.once('exit',code=>resolve(code??1));});
    runner=undefined;
  } catch {
    console.error('Lab capture orchestration failed at '+stage+'; raw child logs suppressed to keep credentials out of artifacts.');
    process.exitCode=1;
  } finally {
    runner?.kill('SIGTERM');
    await stopOwned(owned);
    fs.rmSync(dataDir,{recursive:true,force:true});
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
})().catch(()=>{console.error('Lab preparation failed; verify pinned artifact, free ports 4175/4176, and source/.venv/bin/python.');process.exitCode=1;});
