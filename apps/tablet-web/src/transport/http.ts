import type {TabletTransport,TabletSession} from './session';
import {requestJson} from './session';
import type {Snapshot,CommandEnvelope,CommandResult} from '../../../../packages/contracts/src/index';
/** Only compiled into the explicitly enabled loopback development lab. */
export function developmentTransport():TabletTransport {
 let actor:string|undefined;
 const headers=():Record<string,string>=>actor?{'X-Test-Actor':actor}:{};
 return {
  async session(){const query=new URL(window.location.href).searchParams;actor=query.get('actor')??undefined;const fixture=query.get('fixture');return requestJson<TabletSession>('/session'+(fixture?'?fixture='+encodeURIComponent(fixture):''),{headers:headers()});},
  snapshots:()=>requestJson<Snapshot[]>('/snapshots',{headers:headers()}),
  command:(command:CommandEnvelope)=>requestJson<CommandResult>('/commands',{method:'POST',headers:headers(),body:JSON.stringify({type:command.type,payload:{...command.payload,...(command.expectedVersion!==undefined?{expectedVersion:command.expectedVersion}:{})},operationId:command.operationId,...(command.expectedVersion!==undefined?{expectedVersion:command.expectedVersion}:{})})}),
  async close(){},
 };
}
