// Test-process-only transport/probe doubles. The public CLI parser, admission and
// orchestration run unchanged; the canonical Python compiler executes for real.
import childProcess from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original=childProcess.spawnSync,calls=[];
const result=stdout=>({status:0,stdout,stderr:'',signal:null});
const digest='a'.repeat(64);
const inventory={id:'engineering-amd64',available:true,reasonCodes:[],installation:'native_apt',image:null,headless:true,profileSha256:digest,inventorySha256:digest,actual:{platform:'linux',arch:'amd64',os:'ubuntu24.04',packages:{'portable-probe-double':'1'},digests:{'/portable-double/plugin':digest},aptProvenance:{sources:{'/portable-double/source':digest}},runtime:{rosDistro:'jazzy',amentPrefixes:[],overlayManifests:{},pythonPath:'',libraryPath:'',gazeboPluginPath:'',executables:Object.fromEntries(['ros2','gz','python3'].map(k=>[k,{path:'/portable-double/'+k,sha256:digest}]))}}};
Object.defineProperty(process,'platform',{value:'linux'});
childProcess.spawnSync=(command,args,options)=>{
 if(command==='git'||args[1]==='preflight')return original(command,args,options);
 if(command==='python3'&&args[1]==='compiler.engineering_native'){
  calls.push({kind:'compiler',command,args,cwd:options.cwd});
  return original(process.env.ENGINEERING_PYTHON,args,options);
 }
 if(args[1]==='run'){
  calls.push({kind:'runtime',command,args});writeFileSync(process.env.ENGINEERING_CLI_TRACE,JSON.stringify(calls));return result('');
 }
 if(command==='python3'&&args[1]==='bridge.native_profile')return result(JSON.stringify(inventory));
 if(command==='python3'&&(args[0]==='-c'||args[0]==='--version')||command==='ros2'||command==='gz')return result('portable probe double');
 throw Error('Unexpected subprocess: '+JSON.stringify([command,args]));
};
syncBuiltinESMExports();
