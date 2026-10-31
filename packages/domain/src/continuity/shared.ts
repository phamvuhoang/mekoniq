import type {CommandEnvelope,Decision,JsonObject,JsonValue,Snapshot} from '../../../contracts/src/index';
import {stateEvent} from '../modules';
export function text(v:JsonValue|undefined,code='INVALID_FIELD'):string {
  if(typeof v!=='string'||!v.trim()||v.length>128)throw new Error(code);return v;
}
export function amount(v:JsonValue|undefined):string {
  if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,29})$/.test(v))throw new Error('INVALID_AMOUNT');return v;
}
export function object(v:JsonValue|undefined):JsonObject {
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('INVALID_OBJECT');return v;
}
export function objects(v:JsonValue|undefined):JsonObject[] {
  if(!Array.isArray(v))throw new Error('INVALID_ARRAY');return v.map(object);
}
export function find(s:Snapshot[],kind:string,id:string) {return s.find(x=>x.ref.kind===kind&&x.ref.id===id);}
export function requireState(s:Snapshot[],kind:string,id:string) {
  const state=find(s,kind,id);if(!state)throw new Error('NOT_FOUND');return state;
}
export function version(c:CommandEnvelope,s:Snapshot) {
  const expected=c.expectedVersion??c.payload.expectedVersion;
  if(expected!==undefined&&expected!==s.version)throw new Error('VERSION_CONFLICT');
}
export function change(type:string,kind:string,id:string,state:JsonObject) {return stateEvent(type,kind,id,state);}
export function ok(events:ReturnType<typeof stateEvent>[]=[],value:JsonObject={}):Decision {return {ok:true,events,value};}
export function guarded(fn:(c:CommandEnvelope,s:Snapshot[])=>Decision) {
  return (c:CommandEnvelope,s:Snapshot[]):Decision=>{try{return fn(c,s);}catch(error){return {ok:false,code:error instanceof Error?error.message:'INVALID_COMMAND'};}};
}
export function time(c:CommandEnvelope){return Date.parse(c.recordedAt);}
