import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {chmodSync,lstatSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

// Configuration is server-owned. Never accept an alias, executable or trust file from a Lab request.
// This opens only the remote Lab channel. Remote filesystem ACLs must deny the operator channel.
export async function startArmTunnel({parentDir,alias,knownHosts,sshExecutable='/usr/bin/ssh',timeoutMs=5000}){
 if(typeof alias!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(alias))throw new Error('ARM_TUNNEL_ALIAS_INVALID');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('ARM_TUNNEL_TIMEOUT_INVALID');
 if(!isAbsolute(parentDir)||!isAbsolute(sshExecutable))throw new Error('ARM_TUNNEL_PATH_INVALID');
 try{const st=lstatSync(knownHosts);if(!isAbsolute(knownHosts)||!st.isFile()||!st.size||(st.mode&0o022))throw new Error();}catch{throw new Error('ARM_TUNNEL_TRUST_INVALID');}
 const directory=mkdtempSync(join(parentDir,'arm-'));chmodSync(directory,0o700);
 const socketPath=join(directory,'bridge.sock');
 // StreamLocal paths have a platform length limit; refuse before any child is spawned.
 if(Buffer.byteLength(socketPath)>100){rmdirSync(directory);throw new Error('ARM_TUNNEL_SOCKET_PATH_TOO_LONG');}
 const argv=['-N','-a','-x','-o','BatchMode=yes','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ExitOnForwardFailure=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${knownHosts}`,'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','KnownHostsCommand=none','-o','VerifyHostKeyDNS=no','-o','ControlPath=none','-o','ControlMaster=no','-o','ControlPersist=no','-o','ForkAfterAuthentication=no','-o','StreamLocalBindMask=0177','-o','StreamLocalBindUnlink=no','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=3','-L',`${socketPath}:/run/mekoniq-arm/bridge.sock`,alias];
 let state='starting',exited=false,failure=null,closePromise;
 const child=spawn(sshExecutable,argv,{stdio:'ignore',shell:false});
 const exit=new Promise(resolve=>{child.once('error',e=>{failure=e;exited=true;state='failed';resolve();});child.once('exit',()=>{exited=true;if(state!=='closed')state='failed';resolve();});});
 async function close(){
  if(closePromise)return closePromise;
  closePromise=(async()=>{
   state='closed';if(!exited){child.kill('SIGTERM');await Promise.race([exit,delay(500)]);if(!exited){child.kill('SIGKILL');await exit;}}
   // Directory was exclusively created by this invocation. Never unlink a replacement file/symlink.
   try{if(lstatSync(socketPath).isSocket())unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}
   try{rmdirSync(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
  })();return closePromise;
 }
 const began=performance.now();
 try{
  while(performance.now()-began<timeoutMs){
   if(exited)throw new Error(failure?'ARM_TUNNEL_SPAWN':'ARM_TUNNEL_EXIT');
   let socket=false;try{socket=lstatSync(socketPath).isSocket();}catch(e){if(e.code!=='ENOENT')throw e;}
   if(socket){
    chmodSync(socketPath,0o600);
    const connected=await new Promise(resolve=>{const c=createConnection(socketPath);const timer=setTimeout(()=>{c.destroy();resolve(false);},Math.min(100,timeoutMs));c.once('connect',()=>{clearTimeout(timer);c.destroy();resolve(true);});c.once('error',()=>{clearTimeout(timer);c.destroy();resolve(false);});});
    if(connected&&!exited){state='ready';return {socketPath,directory,argv:[...argv],status:()=>state,close};}
   }
   await delay(Math.min(20,Math.max(1,timeoutMs-(performance.now()-began))));
  }
  throw new Error('ARM_TUNNEL_TIMEOUT');
 }catch(e){await close();throw e;}
}
