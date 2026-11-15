// Docker host forwarding may allow a local bind despite an existing published port.
import {spawnSync} from 'node:child_process';
import {isIP} from 'node:net';
const idPattern=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,wanted)=>object(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify(wanted.slice().sort());
export function requireUnpublishedCiPorts(ports){
 const command=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});if(r.error||r.signal||r.status!==0)throw Error('CI_PORT_INVENTORY_COMMAND_FAILED');return r.stdout;};
 const listed=command(['ps','--quiet','--no-trunc']).trim(),ids=listed?listed.split('\n'):[];
 if(ids.length>1000||ids.some(id=>!idPattern.test(id))||new Set(ids).size!==ids.length)throw Error('CI_PORT_INVENTORY_IDS_INVALID');
 if(!ids.length)return;
 const output=command(['inspect','--format','{"id":{{json .Id}},"ports":{{json .NetworkSettings.Ports}}}',...ids]);
 let rows;try{rows=output.trim().split('\n').map(line=>JSON.parse(line));}catch{throw Error('CI_PORT_INVENTORY_JSON_INVALID');}
 if(rows.length!==ids.length||rows.some(r=>!keys(r,['id','ports'])||!ids.includes(r.id)||!object(r.ports))||new Set(rows.map(r=>r.id)).size!==ids.length)throw Error('CI_PORT_INVENTORY_CONTAINER_MISMATCH');
 for(const row of rows)for(const [containerPort,bindings]of Object.entries(row.ports)){
  const key=/^([1-9][0-9]{0,4})\/(tcp|udp|sctp)$/.exec(containerPort);if(!key||Number(key[1])>65535)throw Error('CI_PORT_INVENTORY_PORT_INVALID');
  if(bindings===null)continue;
  if(!Array.isArray(bindings)||!bindings.length)throw Error('CI_PORT_INVENTORY_BINDINGS_INVALID');
  for(const binding of bindings){
   if(!keys(binding,['HostIp','HostPort'])||typeof binding.HostIp!=='string'||!isIP(binding.HostIp)||typeof binding.HostPort!=='string'||! /^[1-9][0-9]{0,4}$/.test(binding.HostPort)||Number(binding.HostPort)>65535)throw Error('CI_PORT_INVENTORY_BINDING_INVALID');
   if(ports.includes(Number(binding.HostPort)))throw Error('CI_PORT_INVENTORY_CONFLICT:'+binding.HostPort);
  }
 }
}
