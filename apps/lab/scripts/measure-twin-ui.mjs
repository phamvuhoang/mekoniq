// Reproducible renderer benchmark, not business/hardware evidence. Runs the actual workspace and 3D/2D renderer on a synthetic visual load.
// node scripts/measure-twin-ui.mjs [--duration-ms 60000] [--output path]
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import os from 'node:os';
import {validateUiCapture} from './ui-performance-validation.mjs';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const durationMs=Number(arg('--duration-ms')??60000),output=resolve(arg('--output')??'docs/implementation/evidence/digital-twin-v2/plan01-ui-performance.json');
if(!Number.isFinite(durationMs)||durationMs<60000)throw new Error('INVALID_CAPTURE_DURATION: at least 60000 ms required');
const server=await createServer({configFile:false,plugins:[{name:'benchmark-entry',configureServer(server){server.middlewares.use('/benchmark.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="app"><div class="app-layout"><aside class="sidebar"></aside><main id="workspace"></main></div></div></body></html>');});}}],server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
let browser;
try{
 await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results=[];
 for(const profile of [{id:'desktop-3d',width:1440,height:900,deviceScaleFactor:1,view:'3d',limitMs:33},{id:'tablet-2d-emulated',width:1024,height:768,deviceScaleFactor:2,view:'2d',limitMs:50}]){
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.deviceScaleFactor,reducedMotion:profile.view==='2d'?'reduce':'no-preference'}),page=await context.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`${url}/benchmark.html`);
  await page.evaluate(async profile=>{
   const {TwinWorkspace}=await import('/src/ui/workspace.ts'),{presetById}=await import('/src/scenarios/catalog.ts'),{TwinStore}=await import('/src/twin/store.ts');
   const original=presetById('coffee'),project=structuredClone(original.project),amr=project.entities.find(e=>e.kind==='amr');
   project.world.width=12;project.world.height=8;project.entities.push({...structuredClone(amr),id:'amr-2'});
   project.world.points=project.world.points.filter(p=>p.kind!=='table');for(let i=0;i<6;i++)project.world.points.push({id:`table-${i+1}`,name:`T${i+1}`,kind:'table',x:6+(i%3)*2,y:2+Math.floor(i/3)*3});
   // inside the app's own frame (#app > .app-layout > main), which gives the twin page its height since the viewport-first layout (U01): on a bare <main>
   // the viewport row is 0 px high and the 3D canvas is never visible
   const workspace=new TwinWorkspace(()=>{}, {paired:false}),root=document.querySelector('#app main');
   Object.assign(workspace,{runPreset:{...original,project,names:{...original.names,'amr-2':'AMR-2'}},healthChecked:true,vs:{...workspace.vs,view:profile.view},store:new TwinStore(),view:{run:{schemaVersion:2,id:'visual-benchmark',mode:'mock',access:'simulated',backendSetId:'mock-default',backends:['mock_amr','mock_arm','mock_coffee'],status:'running',runRevision:1,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'0'.repeat(40),scenarioId:'BV01',scenarioRevision:1,seed:42},tick:0,simTimeNs:'0',model:'mock_kinematic',entities:['amr-1','amr-2'].map((id,i)=>({id,kind:'amr',pose:{x:1+i,y:1,yawRad:0},quality:'valid',moving:true,hold:null,goal:null,path:[],distanceM:0})),workload:[],awaiting:[],attention:[],served:'0',coffee:{jobs:[],cups:[]}}});
   root.innerHTML=workspace.html();workspace.mounted();window.__benchmark={workspace,root};
  },profile);
  if(profile.view==='3d')await page.waitForSelector('#twin-stage canvas');
  await page.waitForTimeout(2000);
  console.log(`Capturing ${profile.id}: ${durationMs/1000}s; 2 AMRs + 1 arm + 6 tables, 10 Hz samples.`);
  const capture=await page.evaluate(async durationMs=>{
   const {workspace}=window.__benchmark,frames=[],draws=[],tasks=[],started=performance.now();let last=null,active=true,seq=0,renderedPaints=0,nativeDraws=0;
   const canvas=document.querySelector('#twin-stage canvas'),gl=canvas?.getContext('webgl2'),originals={};
   if(gl)for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){originals[name]=gl[name];gl[name]=function(...args){const result=originals[name].apply(this,args);nativeDraws++;return result;};}
   const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({entryTypes:['longtask']});
   const raf=t=>{if(!active)return;if(last!==null)frames.push(t-last);last=t;requestAnimationFrame(raf);};requestAnimationFrame(raf);
   const feed=setInterval(()=>{seq++;const time=performance.now(),phase=seq/20;
    workspace.link={state:'live',lastHeartbeatMs:time,paused:false};
    for(let i=0;i<2;i++)workspace.store.apply({schemaVersion:2,runId:'visual-benchmark',entityId:`amr-${i+1}`,providerId:'mock_amr',bootId:'benchmark',seq:String(seq),simTimeNs:String(seq*100000000),observedAt:new Date().toISOString(),receivedMonotonicNs:String(Math.round(time*1e6)),frameId:'map',origin:'mock',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:3+i*2+Math.sin(phase),yM:3+Math.cos(phase),yawRad:phase,moving:true,hold:null},estimated:null,causationId:null});
    // 2D: the plan is updated in place (morph, N03), so a paint is the AMRs' drawn poses changing, not a new <svg> node
    const poses=()=>['amr-1','amr-2'].map(id=>document.querySelector(`#twin-stage [data-entity="${id}"]`)?.getAttribute('transform')).join('|');
    const previousPoses=poses(),previousDraws=nativeDraws,before=performance.now();workspace.tick();const paintMs=performance.now()-before;
    const svg=document.querySelector('#twin-stage svg');
    if(canvas?nativeDraws===previousDraws||!canvas.width||!canvas.height:!svg||poses()===previousPoses||!['amr-1','amr-2','arm-1'].every(id=>svg.querySelector(`[data-entity="${id}"]`)))throw new Error('NO_RENDERED_WORKSPACE_PAINT');
    renderedPaints++;draws.push(paintMs);
   },100);
   await new Promise(resolve=>setTimeout(resolve,durationMs));active=false;clearInterval(feed);observer.disconnect();
   const summary=values=>{const ordered=[...values].sort((a,b)=>a-b);return {samples:values.length,p50Ms:ordered[Math.ceil(ordered.length*.5)-1]??null,p95Ms:ordered[Math.ceil(ordered.length*.95)-1]??null,maxMs:ordered.at(-1)??null};};
   if(gl)for(const [name,original] of Object.entries(originals))gl[name]=original;
   const ext=gl?.getExtension('WEBGL_debug_renderer_info');
   const result={elapsedMs:performance.now()-started,frameIntervals:summary(frames),workspacePaint:summary(draws),renderedPaints,longTasks:summary(tasks),userAgent:navigator.userAgent,devicePixelRatio,visibilityState:document.visibilityState,renderedView:canvas?'3d':'2d',webglRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,entities:workspace.view.entities.length,armCount:workspace.runPreset.project.entities.filter(e=>e.kind==='arm').length,tableCount:workspace.runPreset.project.world.points.filter(p=>p.kind==='table').length};
   workspace.leave();return result;
  },durationMs);
  const validation=validateUiCapture({...capture,pageErrors},profile,durationMs);
  results.push({...profile,...capture,pageErrors,...validation});console.log(`${profile.id}: p95 frame ${capture.frameIntervals.p95Ms?.toFixed(2)} ms, paint ${capture.workspacePaint.p95Ms?.toFixed(2)} ms; ${validation.valid?'valid':validation.errors.join(', ')}.`);await context.close();
 }
 const report={capturedAt:new Date().toISOString(),durationMs,browser:browser.version(),host:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,memoryGiB:os.totalmem()/2**30},workload:'Synthetic visual telemetry into actual TwinWorkspace: 2 AMRs, 1 arm, 6 tables; 10 Hz input; no runtime execution or physical tablet claim.',minimumDurationMet:durationMs>=60000,results};
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(`Saved ${output}`);
 if(!report.minimumDurationMet||results.some(r=>!r.meetsTarget))process.exitCode=1;
}finally{await browser?.close();await server.close();}
