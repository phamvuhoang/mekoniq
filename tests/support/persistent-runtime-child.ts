// Dedicated test child: no infrastructure or worker is adopted. Parent owns this exact PID.
import {startLabGateway} from '../../packages/lab-runtime/src/gateway';
try{
 const gateway=await startLabGateway({port:0,directory:process.argv[2]!,sourceCommit:'persistent-test',schemaHash:'a'.repeat(64),v2:{enabledBackends:['mock_amr','mock_arm','mock_coffee']}});
 process.send?.({url:gateway.url,token:gateway.pairingToken});
 process.once('message',()=>{void gateway.close().then(()=>process.exit(0));});
}catch(e){process.send?.({error:(e as Error).message});process.exitCode=1;process.disconnect?.();}
