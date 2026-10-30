import { startCoordinatorRuntime } from './coordinator-runtime';
import { Identity,Lan } from './lan-bridge';
import type { CommandEnvelope } from '../../../packages/contracts/src/index';
export async function nativeTransport() {
  const runtime=await startCoordinatorRuntime();
  let lastLevel:import('../../tablet-web/src/transport/session').AckLevel='unknown';
  return {
    async session(){
      const session=await Identity.session();
      if(!session.isCoordinator){try{await Lan.pullSnapshots();if(session.mode!=='capture-only')session.mode='coordinated';}catch{if(session.mode!=='capture-only')session.mode='isolated';}}
      return {...session,level:lastLevel};
    },
    snapshots:async()=>{
      const session=await Identity.session();
      return runtime.store.snapshots(session);
    },
    async command(command:CommandEnvelope){const result=await runtime.dispatch(command);if(result.ack!=='none')lastLevel=result.ack;return result;},
    close:()=>runtime.close(),
  };
}
