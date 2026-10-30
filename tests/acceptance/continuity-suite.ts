import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import type {Lab} from '../support/lab';
import type {CommandResult,JsonObject} from '../../packages/contracts/src/index';
import {runRestaurantJourney,createSimulator} from '../support/restaurant-journey';
import {dispatchRobotEffects} from '../../packages/robot-adapters/src/dispatch';
import {authorizeVenueCommand} from '../../packages/domain/src/application';
import {command} from '../support/storage-cases';
import {coordinatorReady} from '../../packages/sync/src/coordinator-health';
import {evaluateFeature} from '../../packages/domain/src/policy/evaluate';
const require=createRequire(import.meta.url);
export type ScenarioReport={id:string;software:'passed'|'failed';android:'passed'|'failed'|'not_run';hardware:'passed'|'failed'|'not_required'|'not_run';evidence:string[];limits:string[]};
type Scenario=(lab:Lab,evidence:string[])=>Promise<void>;
const accept=(r:CommandResult)=>{assert.equal(r.status,'accepted',r.code);return r;};
const receipt=(number:string):JsonObject=>({sourceType:'paper',sourceSeries:'ACCEPTANCE',sourceNumber:number,totalMinor:'50000',paidCashMinor:'50000',fulfilled:true,occurredAt:'2026-10-29T13:00:00Z'});
async function namedTest(file:string,name:string,evidence:string[]) {
 const directory=join('.lab','continuity');await mkdir(directory,{recursive:true});
 const report=join(directory,`${file.split('/').at(-1)!.replace(/\.test\.ts$/,'')}-${name.replace(/[^a-z0-9]/gi,'_').slice(0,50)}.json`);
 const child=spawn(process.execPath,[join(dirname(require.resolve('vitest/package.json')),'vitest.mjs'),'run',file,'-t',name,'--reporter=json',`--outputFile=${report}`],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
 const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));
 assert.equal(code,0,output);
 const result=JSON.parse(await readFile(report,'utf8')) as {numPassedTests:number;numFailedTests:number};
 assert.ok(result.numPassedTests>0,'No matching behavioral tests executed');assert.equal(result.numFailedTests,0);
 evidence.push(`${file}: ${name}; ${result.numPassedTests} passed; ${report}`);
}
const scenarios:Record<string,Scenario>={
 O01:async(lab,e)=>{
  await lab.partition('wan');const result=await runRestaurantJourney(lab);
  assert.equal(result.billStatus,'closed');assert.equal(result.missionStatus,'completed');assert.equal(await lab.cloudAppliedCount(),0);
  await lab.heal();await lab.sync();assert.equal(await lab.count('CashRecorded'),1);assert.equal(await lab.pendingCount(),0);
  e.push('Production restaurant router + file SQLite + persisted fake-adapter effects; actual PostgreSQL journal ingest after WAN heal.');
 },
 O02:async(lab,e)=>{
  await lab.fault('drop-local-ack');const payload={sessionId:'ack-session',tableId:'table-1'};
  assert.equal((await lab.command('cashier','Session.Open',payload,'ack-once')).status,'unknown');
  assert.equal((await lab.command('cashier','Session.Open',payload,'ack-once')).duplicate,true);
  assert.equal(await lab.count('SessionOpened'),1);e.push('Local ACK dropped after commit; retry returns original operation receipt.');
 },
 O03:async(lab,e)=>{
  accept(await lab.command('cashier','Session.Open',{sessionId:'cloud-ack-session',tableId:'table-1'}));
  await lab.fault('drop-cloud-ack');await assert.rejects(lab.sync(),/CLOUD_ACK_LOST/);
  assert.ok(await lab.pendingCount()>0);await lab.sync();assert.equal(await lab.pendingCount(),0);assert.equal(await lab.count('SessionOpened'),1);
  e.push('Actual PostgreSQL commit precedes lost cloud receipt; file outbox survives and deduplicates resend.');
 },
 O04:async(lab,e)=>{
  await lab.partition('lan');
  assert.equal((await lab.command('cashier','Session.Open',{sessionId:'isolated-shared',tableId:'table-1'})).status,'unknown');
  accept(await lab.command('device-a','Continuity.CaptureTicket',{id:'partition-a',table:'table-1',totalMinor:'50000'}));
  assert.equal(await lab.count('IsolatedTicketRecorded'),1);assert.equal(await lab.count('SessionOpened'),0);
  await lab.heal();await lab.sync();assert.ok((await lab.state<JsonObject>('isolated-ticket','device-a:epoch-1:partition-a')).originalEntryId);
  e.push('Independent device SQLite is used during LAN partition; original signed source journal is verified during recovery.');
 },
 O05:async(lab,e)=>{
  await lab.partition('lan');
  accept(await lab.command('device-a','Continuity.CaptureTicket',{id:'partition-a',table:'table-1',totalMinor:'50000'}));
  accept(await lab.command('device-b','Continuity.CaptureTicket',{id:'partition-b',table:'table-1',totalMinor:'20000'}));
  await lab.heal();await lab.sync();assert.equal(await lab.unresolvedConflictCount(),1);assert.equal(await lab.count('IsolatedTicketRecorded'),2);
  e.push('Two real device files preserve two source IDs for the same table; manager conflict remains open after heal.');
 },
 O06:async(_lab,e)=>namedTest('tests/integration/settlement-grants.test.ts','isolated collector commits once',e),
 O07:async(_lab,e)=>namedTest('tests/integration/crash-window.test.ts','kill after real SQLite commit',e),
 O08:async(_lab,e)=>namedTest('tests/integration/storage-failure.test.ts','actual SQLite page limit',e),
 O09:async(_lab,e)=>namedTest('tests/integration/sync-replay.test.ts','commit ACK is durable',e),
 O10:async(_lab,e)=>namedTest('tests/integration/simulated-delivery.test.ts','simulator deduplicates native goals and reboot yields unknown',e),
 O11:async(lab,e)=>{
  const created=accept(await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]}));
  await lab.advance(61000);const simulator=await createSimulator(lab);
  await dispatchRobotEffects(await lab.getStore('coordinator'),lab.scope,simulator,lab.clock.nowMs);
  assert.equal(await lab.effectCount('robot.execute'),0);
  const effect=(await(await lab.getStore('coordinator')).effects(lab.scope,'robot.execute')).find(x=>x.id===created.value.commandId);
  assert.equal(effect?.status,'failed');e.push('Expired durable robot command is rejected before any adapter execution attempt.');
 },
 O12:async(lab,e)=>{
  await lab.partition('wan');const before=await lab.state<JsonObject>('configuration','applied');
  assert.equal(before.revision,1);
  assert.equal(evaluateFeature({status:'draining',intent:'new',revision:2}).reason,'FEATURE_DRAINING');
  assert.equal(evaluateFeature({status:'draining',intent:'finish_existing',revision:2}).allowed,true);
  assert.equal((await lab.state<JsonObject>('configuration','applied')).revision,1);
  e.push('Cached revision remains applied during WAN outage; shared engine blocks new work while permitting accepted-work completion. Cloud publication/ACK integration is covered by W02.');
 },
 O13:async(lab,e)=>{
  await lab.partition('wan');await lab.advance(86400000);
  const base={id:'cashier',deviceId:'device-a',scope:lab.scope,permissions:['order.write','continuity.capture'],expiresAtMs:lab.clock.nowMs,stationIds:[]};
  assert.equal(authorizeVenueCommand(base,command('expiry',{}, {...lab.scope,actorRef:'cashier',deviceId:'device-a',type:'Order.Place'}),lab.clock.nowMs),false);
  assert.equal(authorizeVenueCommand(base,command('capture',{}, {...lab.scope,actorRef:'cashier',deviceId:'device-a',type:'Continuity.CaptureTicket'}),lab.clock.nowMs),true);
  e.push('Injected-clock expiry boundary and capture-only authorization verified; this is not a 24-hour Android soak.');
 },
 O14:async(lab,e)=>{
  const a=receipt('001'),b=receipt('002');await lab.importApproved([a,b]);await lab.importApproved([b,a]);
  assert.equal(await lab.count('HistoricalReceiptRecorded'),2);assert.equal(await lab.effectCount('payment.capture'),0);
  e.push('Reordered rows/new batches preserve source-key dedup and do not repeat historical money.');
 },
 O15:async(lab,e)=>{
  const original=receipt('001');await lab.importApproved([original]);
  const validated=await lab.command('manager','Import.Validate',{rows:[{...original,totalMinor:'60000'}],incidentRef:'amended-file'});
  if(validated.status==='rejected')assert.equal(validated.code,'SOURCE_CONFLICT');
  else {
   const preview=await lab.command('manager','Import.Preview',{batchId:validated.value.batchId!});
   const approved=await lab.command('manager','Import.Approve',{batchId:validated.value.batchId!,previewHash:preview.value.previewHash!});
   assert.equal(approved.code,'SOURCE_CONFLICT');
  }
  assert.equal(await lab.count('HistoricalReceiptRecorded'),1);e.push('Changed source amount cannot overwrite the original historical receipt.');
 },
 O16:async(_lab,e)=>namedTest('tests/integration/continuity-recovery.test.ts','late source reference',e),
 O17:async(lab,e)=>{
  await lab.importApproved([{...receipt('external-done'),externalInvoiceRef:'issued-outside',paymentReference:'terminal-reference'}]);
  assert.equal(await lab.effectCount('robot.execute'),0);assert.equal(await lab.effectCount('payment.capture'),0);assert.equal(await lab.effectCount('einvoice.issue'),0);assert.equal(await lab.count('KitchenTicketCreated'),0);
  e.push('Historical completed receipt produces no KDS work or robot/payment/invoice side effects.');
 },
 O18:async(_lab,e)=>namedTest('tests/integration/continuity-recovery.test.ts','killed import resumes',e),
 O19:async(_lab,e)=>namedTest('tests/integration/sync-replay.test.ts','(commit ACK is durable|valid signed unsupported schema remains raw)',e),
 O20:async(_lab,e)=>namedTest('tests/integration/ownership-handoff.test.ts','unknown robot goal prevents replacement',e),
 O21:async(lab,e)=>{
  assert.equal(coordinatorReady({serviceUp:true,runtimeLastSeenMs:1000,nowMs:5000,storeWritable:true}),false);
  await lab.partition('lan');assert.equal((await lab.command('cashier','Session.Open',{sessionId:'suspended-runtime',tableId:'table-1'})).status,'unknown');
  e.push('Software TTL and unavailable-owner path reject ACK; real Android suspend/stop qualification remains not_run.');
 },
 O22:async(_lab,e)=>{
  await namedTest('tests/integration/archive-restore.test.ts','encrypted export restores original signed IDs',e);
  await namedTest('tests/integration/continuity-recovery.test.ts','encrypted checkpoint restores pending robot commands',e);
 },
};
const robotScenarios=new Set(['O01','O10','O11','O20','O22']);
export const mandatoryAndroidScenarios=['O01','O02','O04','O06','O07','O08','O13','O21','O22'];
export function continuityScenarioIds():string[]{return Object.keys(scenarios);}
export async function runContinuityScenario(id:string,lab:Lab):Promise<ScenarioReport> {
 const scenario=scenarios[id];if(!scenario)throw new Error('UNKNOWN_CONTINUITY_SCENARIO');
 const evidence:string[]=[],limits=['Android/physical evidence is independent of these software assertions.'];
 const report:ScenarioReport={id,software:'failed',android:'not_run',hardware:robotScenarios.has(id)?'not_run':'not_required',evidence,limits};
 if(id==='O13')limits.push('24-hour wall-clock soak has not run; injected clock verifies expiry only.');
 try{await scenario(lab,evidence);report.software='passed';}catch(error){evidence.push(error instanceof Error?error.stack ?? error.message:String(error));}
 return report;
}
export function assertContinuityGate(reports:ScenarioReport[],softwareOnly=false):void {
 assert.deepEqual(reports.map(r=>r.id).sort(),continuityScenarioIds().sort(),'Missing scenario report');
 assert.equal(reports.filter(r=>r.software!=='passed').length,0,'Software continuity scenario failed');
 if(!softwareOnly) {
  const missing=mandatoryAndroidScenarios.filter(id=>reports.find(r=>r.id===id)?.android!=='passed');
  assert.equal(missing.length,0,`PREREQUISITE: actual Android qualification/24h soak not_run: ${missing.join(', ')}`);
 }
}
export async function saveContinuityReport(reports:ScenarioReport[],softwareOnly:boolean):Promise<string> {
 const directory=join('.lab','continuity');await mkdir(directory,{recursive:true});
 const filename=join(directory,softwareOnly?'software-report.json':'gate-report.json');
 const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0;
 await writeFile(filename,JSON.stringify({generatedAt:new Date().toISOString(),commit,dirty,node:process.version,mode:softwareOnly?'software-only':'gate',reports},null,2)+'\n');return filename;
}
