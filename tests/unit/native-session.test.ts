import {expect,test,vi} from 'vitest';
const native=vi.hoisted(()=>({revision:1,fail:false}));
vi.mock('../../apps/tablet-android/src/lan-bridge',()=>({
 Identity:{session:async()=>({policyRevision:native.revision,isCoordinator:false,mode:'coordinated'})},
 Lan:{pullSnapshots:async()=>{if(native.fail)throw new Error('OWNER_UNREACHABLE');native.revision=2;}},
}));
vi.mock('../../apps/tablet-android/src/coordinator-runtime',()=>({startCoordinatorRuntime:async()=>({store:{snapshots:async()=>[]},close:async()=>{}})}));
import {nativeTransport} from '../../apps/tablet-android/src/ui-entry';
test('peer UI stamps the policy revision installed by the same signed LAN refresh',async()=>{
 native.revision=1;native.fail=false;const transport=await nativeTransport();
 try{expect((await transport.session()).policyRevision).toBe(2);}finally{await transport.close();}
});
