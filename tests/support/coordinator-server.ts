// Test/development fixture server. This file is never bundled in the APK/cloud app.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRestaurantLab} from './restaurant-lab';
import {actors} from './actors';
import {createSimulator,completeSimulatedTravel} from './restaurant-journey';
import {parseJsonStrict} from '../../packages/contracts/src/index';
import type {JsonObject} from '../../packages/contracts/src/index';
export async function startCoordinatorServer(port=3451) {
  if(process.env.MEKONIQ_DEV_LAB!=='1')throw new Error('EXPLICIT_TEST_LAB_REQUIRED');
  // X-Test-Lab names a separate fixture coordinator (its own SQLite lab) so a spec can run without inheriting other specs' orders and shifts.
  const labs=new Map<string,Promise<{lab:Awaited<ReturnType<typeof createRestaurantLab>>;simulator:Awaited<ReturnType<typeof createSimulator>>}>>();
  const open=(id:string)=>{
    let entry=labs.get(id);
    if(!entry){if(labs.size>=16)throw new Error('TOO_MANY_TEST_LABS');entry=createRestaurantLab().then(async lab=>({lab,simulator:await createSimulator(lab)}));labs.set(id,entry);}
    return entry;
  };
  const {lab}=await open('');
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      const labId=String(req.headers['x-test-lab']??'');if(!/^[A-Za-z0-9-]{0,64}$/.test(labId))throw new Error('INVALID_TEST_LAB');
      const {lab,simulator}=await open(labId);
      const actor=String(req.headers['x-test-actor']??'manager'),principal=actors[actor];
      if(!principal){res.writeHead(401);res.end(JSON.stringify({code:'UNAUTHENTICATED'}));return;}
      const path=new URL(req.url??'/','http://localhost').pathname;
      if(req.method==='GET'&&path==='/session') {
        const localOnly=new URL(req.url??'/','http://localhost').searchParams.get('fixture')==='local-only';
        if(localOnly){await lab.partition('lan');await lab.command('device-a','Continuity.CaptureTicket',{id:'status-local',table:'table-1',totalMinor:'0'},'device-status-fixture');await lab.heal();}
        res.end(JSON.stringify({actorId:actor,role:principal.role,permissions:principal.permissions,...lab.scope,deviceId:principal.deviceId,deviceEpoch:'epoch-1',coordinatorEpoch:1,policyRevision:lab.policyRevision,level:localOnly?'local':'venue',mode:localOnly?'isolated':'coordinated',pendingCount:localOnly?await lab.pendingCount('device-a'):await lab.pendingCount(),lastSyncAt:null,ownerEndpoint:`http://127.0.0.1:${port}`}));return;
      }
      if(req.method==='GET'&&path==='/snapshots') {
        let snapshots=await(await lab.getStore('coordinator')).snapshots(lab.scope);
        if(principal.role==='chef')snapshots=snapshots.filter(s=>['station','kitchen-ticket','kitchen-delta','kitchen-cancellation','fulfillment'].includes(s.ref.kind)&&(!s.state.stationId||s.state.stationId==='kitchen'));
        if(principal.role==='guest')snapshots=[];
        // Same visibility as LanService.kt for guest-facing devices: menu, tables and robots only, never another session's orders, bills, calls or tokens.
        if(['kiosk','robot-display'].includes(principal.role))snapshots=snapshots.filter(s=>['configuration','catalog','table','robot','mission','robot-display'].includes(s.ref.kind));
        res.end(JSON.stringify(snapshots));return;
      }
      if(req.method==='POST') {
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413);res.end(JSON.stringify({code:'PAYLOAD_TOO_LARGE'}));return;}chunks.push(chunk);}
        const body=parseJsonStrict(Buffer.concat(chunks).toString('utf8')) as JsonObject;
        if(path==='/commands') {
          if(typeof body.type!=='string'||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload)||typeof body.operationId!=='string')throw new Error('INVALID_COMMAND');
          if(typeof body.expectedVersion==='number')body.payload.expectedVersion=body.expectedVersion;
          const result=await lab.command(actor,body.type,body.payload,body.operationId);
          if(result.status==='accepted'&&['Mission.Create','Mission.ConfirmStop','Mission.Cancel'].includes(body.type)) {
            const missionId=String(result.value.missionId??body.payload.missionId);
            const mission=await lab.state<{status:string}>('mission',missionId);
            if(['assigned','executing'].includes(mission.status))await completeSimulatedTravel(lab,simulator,missionId);
          }
          res.end(JSON.stringify(result));return;
        }
        if(path==='/test/advance'){
          await lab.advance(Number(body.ms??5000));
          for(const s of await(await lab.getStore('coordinator')).snapshots(lab.scope))if(s.ref.kind==='mission'&&['assigned','executing'].includes(String(s.state.status)))await completeSimulatedTravel(lab,simulator,s.ref.id);
          res.end('{}');return;
        }
        if(path==='/test/partition'){if(body.mode==='heal')await lab.heal();else if(body.mode==='wan'||body.mode==='lan')await lab.partition(body.mode);res.end('{}');return;}
        if(path==='/test/reset'){res.writeHead(409);res.end(JSON.stringify({code:'PENDING_JOURNAL'}));return;}
      }
      res.writeHead(404);res.end(JSON.stringify({code:'NOT_FOUND'}));
    }catch(error){res.writeHead(400);res.end(JSON.stringify({code:error instanceof Error?error.message:'INVALID_REQUEST'}));}
  });
  await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,lab,url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,async close(){await new Promise<void>(resolve=>server.close(()=>resolve()));for(const entry of labs.values())await (await entry).lab.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const coordinator=await startCoordinatorServer(Number(process.env.COORDINATOR_PORT??3451));
  console.log(`Development fixture coordinator: ${coordinator.url}`);
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,async()=>{await coordinator.close();process.exit(0);});
}
