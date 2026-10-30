import type {Handler, CommandEnvelope, Snapshot, Decision, JsonObject} from '../../contracts/src/index';
export class ModuleRegistry {
  private handlers=new Map<string,Handler>();
  register(type:string,handler:Handler) {
    if(this.handlers.has(type)) throw new Error('DUPLICATE_HANDLER');
    this.handlers.set(type,handler);
  }
  decide(command:CommandEnvelope,snapshots:Snapshot[]):Decision {
    const handler=this.handlers.get(command.type);
    if(!handler) return {ok:false,code:'UNKNOWN_COMMAND'};
    return handler(command,snapshots);
  }
}
// Events carry explicit projected state. The processor creates mutations with
// versions from the read snapshot, then the store rechecks all versions at commit.
export function stateEvent(type:string,kind:string,id:string,state:JsonObject) {
  return {type,data:{kind,id,state}};
}
