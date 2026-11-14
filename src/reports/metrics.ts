import {physicsHtml} from './physics';
import {reportClock} from './clock';
import type {RunEvent} from '../shared/types';
interface RecordedReport {schemaVersion:1;mode:'business_sim';sourceCommit:string;snapshot:{status:string;served:string;elapsedMs:number;events:RunEvent[]};effects:{type:string;attempts?:number}[];}
function parseReport(value:unknown):RecordedReport {
 if(!value||typeof value!=='object')throw new Error('INVALID_REPORT');
 const r=value as RecordedReport;
 if(r.mode!=='business_sim')throw new Error('UNSUPPORTED_REPORT_MODE');
 if(r.schemaVersion!==1||typeof r.sourceCommit!=='string'||!r.snapshot||!Number.isFinite(r.snapshot.elapsedMs)||r.snapshot.elapsedMs<0||!/^\d+$/.test(r.snapshot.served)||!Array.isArray(r.snapshot.events)||r.snapshot.events.length>100000||!Array.isArray(r.effects))throw new Error('INVALID_REPORT');
 let last=-Infinity;
 for(const event of r.snapshot.events){const time=Date.parse(event.at);if(typeof event.type!=='string'||!Number.isFinite(time)||time<last)throw new Error('INVALID_REPORT');last=time;}
 for(const effect of r.effects)if(typeof effect.type!=='string'||(effect.attempts!==undefined&&(!Number.isSafeInteger(effect.attempts)||effect.attempts<0)))throw new Error('INVALID_REPORT');
 return structuredClone(r);
}
export function summarizeReport(value:unknown) {
 const report=parseReport(value);let start:number|undefined,arrival:number|undefined,travelMs=0,humanWaitMs=0;
 for(const event of report.snapshot.events){const now=Date.parse(event.at);
  if(event.type==='RobotCommandIssued'){start=now;arrival=undefined;}
  else if(event.type==='RobotGoalCompleted'&&start!==undefined){travelMs+=now-start;start=undefined;arrival=now;}
  else if(['CargoLoaded','DeliveryHandedOff','CargoReturned'].includes(event.type)&&arrival!==undefined){humanWaitMs+=now-arrival;arrival=undefined;}
 }
 return {evidence:'business_sim' as const,outcome:report.snapshot.status,elapsedMs:report.snapshot.elapsedMs,served:report.snapshot.served,travelMs,humanWaitMs,distanceM:null,executeAttempts:report.effects.filter(e=>e.type==='robot.execute').reduce((n,e)=>n+(e.attempts??0),0),sampleCount:1,sourceCommit:report.sourceCommit};
}
/** Read model only: replay has no dependency on a command client or executor. */
export function openReplay(value:unknown) {
 const report=parseReport(value),events=report.snapshot.events,origin=events.length?Date.parse(events[0]!.at):0;
 return {summary:()=>summarizeReport(report),seek(milliseconds:number):RunEvent[]{if(!Number.isFinite(milliseconds))throw new Error('INVALID_REPLAY_CURSOR');const limit=origin+Math.max(0,Math.min(milliseconds,report.snapshot.elapsedMs));return structuredClone(events.filter(e=>Date.parse(e.at)<=limit));}};
}

// ---- v2 reports (F06): business events are durable evidence; telemetry is lossy and coalesced. Exports are read-only documents. ----
import type {RunReport as RunReportV2} from '../scenarios/controls';
import {validVerification,safeArtifactPath} from './verification';
import {compareRuns,reportKpis} from './compare';
import {navigationEvidence,navigationEvidenceView,navigationRows} from './navigation2d';
import {esc} from '../ui/icons';
export function summarizeReportV2(r:RunReportV2){
 const t=r.telemetry;
 return {evidence:r.manifest.mode,backends:r.manifest.backends.map(b=>`${b.id}@${b.version} (${b.model})`),outcome:r.outcome.status,served:r.outcome.served,seed:r.manifest.seed,businessEvents:r.businessEvents.length,
  telemetry:t?{lossy:true as const,samples:t.samples.length,sampleCounts:{...t.sampleCounts},dropped:t.dropped,gaps:t.gaps.length}:null,kpis:reportKpis(r)};
}
const SECRET=/token|csrf|secret|password|passphrase|private|cookie|credential|^(d|directory|dir|path|dataDir)$/i,PATH=/^(\/(Users|home|tmp|var|private|root)\/|[A-Za-z]:\\)/,
 /** Absolute paths anywhere inside a string (error messages, notes): POSIX home/tmp roots or a Windows drive. */
 PATH_IN=/(?:\/(?:Users|home|tmp|var|private|root)\/|[A-Za-z]:\\)[^\s"'<>]*/g;
/** Exports never carry keys, tokens, cookies or local filesystem paths, whatever a report happens to contain. */
export function redact(v:unknown):unknown{
 if(Array.isArray(v))return v.map(redact);
 if(v&&typeof v==='object'){const a=v as Record<string,unknown>,artifact=typeof a.path==='string'&&safeArtifactPath(a.path)&&typeof a.sha256==='string'&&/^[a-f0-9]{64}$/.test(a.sha256)&&typeof a.bytes==='number';return Object.fromEntries(Object.entries(v).filter(([k])=>!SECRET.test(k)||k==='path'&&artifact).map(([k,x])=>[k,redact(x)]));}
 return typeof v==='string'?(PATH.test(v)?'[redacted path]':v.replace(PATH_IN,'[redacted path]')):v;
}
export const reportJson=(r:RunReportV2)=>JSON.stringify(redact(r),null,2);
// a text cell starting with = + - @ tab or CR would run as a spreadsheet formula: prefix ' (a finite number such as -12.5 stays as is)
const cell=(v:unknown)=>{const raw=v===null||v===undefined?'':typeof v==='string'?v:JSON.stringify(v),s=/^[=+\-@\t\r]/.test(raw)&&!(raw.trim()!==''&&Number.isFinite(Number(raw)))?`'${raw}`:raw;return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
/** One table, both streams, labelled by `stream`; business rows keep their journal sequence, telemetry rows their provider seq. */
export function reportCsv(report:RunReportV2){
 const r=redact(report) as RunReportV2,{sampleTick,eventTick}=reportClock(r);
 const rows=[['stream','sequence_or_seq','time','tick','entity_or_kind','id','type','quality','detail','raw_sim_time_ns'],
  ...r.businessEvents.map(e=>['business',e.sequence,e.at,eventTick(e.at),e.kind,e.id,e.type,'',e.state??{},'']),
  ...(r.telemetry?.samples??[]).map(s=>['telemetry',s.seq,s.observedAt,Number.isFinite(sampleTick(s))?sampleTick(s):'',s.entityId,`${s.providerId}/${s.bootId}`,'TwinSample',s.quality,{simTimeNs:s.simTimeNs,providerId:s.providerId,observed:s.observed,commanded:s.commanded,reasonCodes:s.reasonCodes},s.simTimeNs]),
  ...reportKpis(r).map(k=>['kpi','','','',k.unit,k.id,k.definition,k.available?'available':'unavailable',k.available?k.value:k.reason,'']),
  ...navigationRows(r).map(a=>['navigation_assertion','','','','irsim_2d',a.id,a.detail,a.result,a.reasons.join(' '),''])];
 return rows.map(x=>x.map(cell).join(',')).join('\n')+'\n';
}
/** Self-contained static HTML: no script, no external resource; every runtime string escaped. */
export function reportHtml(report:RunReportV2,o:{compareWith?:RunReportV2;title?:string}={}){
 const r=redact(report) as RunReportV2,b=o.compareWith?redact(o.compareWith) as RunReportV2:null,m=r.manifest,t=r.telemetry;
 const table=(head:string[],rows:unknown[][])=>`<table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr>${x.map(c=>`<td>${esc(c===null||c===undefined?'—':typeof c==='object'?JSON.stringify(c):c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const missing=[...Object.entries(r.coverage).filter(([,v])=>!v).map(([k])=>`coverage: ${k} not run`),...reportKpis(r).filter(k=>!k.available).map(k=>`KPI ${k.id}: ${k.reason}`),
  ...(t?t.gaps.map(g=>`telemetry gap: ${g.reason} (ticks ${g.fromTick??'start'}–${g.toTick})`):['telemetry: not recorded by this runtime']),...(t?.dropped?[`telemetry: ${t.dropped} samples dropped (buffer)`]:[]),...r.limitations];
 const cmp=b?compareRuns(r,b):null,v=r.verification;
 const verification=validVerification(v)?`<h2>Controller verification</h2>${table(['Target','Execution','Result'],[[v.target,v.execution,v.result]])}${table(['Producer','Fidelity','Artifact SHA256'],v.aspects.map(x=>[x.producer,x.fidelity,x.artifactSha256]))}${table(['Checker','Model','World','Coverage','Reasons'],[[v.arm?.engine,v.arm?.modelRevision,v.arm?.worldRevision.hash,v.arm?.coverage,v.arm?.reasonCodes??v.blockers]])}${table(['Artifact','Bytes','SHA256'],v.artifacts.map(a=>[a.path,a.bytes,a.sha256]))}`:'<p>Controller/arm verification unavailable; mobile engine observations have their own scope.</p>';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(o.title??`Run report ${m.scenario.id} seed ${m.seed}`)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#14213d}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #c8cfdc;padding:4px 6px;text-align:left;vertical-align:top;font-size:12px}th{background:#eef1f6}.note{color:#4a5568}</style></head><body>
<h1>${esc(m.scenario.id)} r${esc(m.scenario.revision)} · ${esc(r.outcome.status)} · served ${esc(r.outcome.served)}</h1>
<p class="note">Evidence: ${esc(m.mode)} / ${esc(m.access)}. Workflow outcome and assertions are separate; this static export cannot run or resend anything.</p>
<h2>Source manifest</h2>${table(['Field','Value'],[['runId',m.runId],['sourceCommit',m.sourceCommit],['backendSetId',m.backendSetId],['backends',m.backends.map(x=>`${x.id}@${x.version} ${x.model}${x.dynamics?' dynamics':''}`).join(', ')],['clock',`${m.clock.tickMs} ms tick`],['scenario',`${m.scenario.id} r${m.scenario.revision} ${m.scenario.hash}`],['project',`${m.project.id} r${m.project.revision} ${m.project.hash}`],['world',`${m.world.id} r${m.world.revision} ${m.world.hash}`],['assets',m.assets.map(a=>`${a.id} r${a.revision} ${a.resolved?'resolved':'unresolved'}`).join(', ')||'—']])}
${verification}
${physicsHtml(r)}${r.navigation2d!==undefined?(()=>{const v=navigationEvidenceView(r),n=navigationEvidence(r);return `<h2>Navigation evidence (${esc(n?.engine.id==='irsim_2d'?'IR-SIM 2D':n?.engine.id==='webots_3d'?'Webots 3D':n?.engine.id??'unknown')})</h2><p>${esc(v.supported?`${v.provider} · ${v.complete?'complete':'incomplete'}`:'unavailable')}${v.reasons.length?`: ${esc(v.reasons.join(', '))}`:''}</p>${n?table(['Assertion','Result','Detail'],navigationRows(r).map(a=>[a.id,a.result,a.detail]))+table(['Digest','Value'],[['trajectory',n.digests.trajectoryDigest],['sensor',n.digests.sensorDigest],['assertion',n.digests.assertionDigest]]):''}<p class="note">${n?.engine.id==='mujoco_3d'?'MuJoCo 3D · not_calibrated · ground_truth localization.':n?.engine.id==='webots_3d'?'Webots 3D · not_calibrated.':'Planar kinematic 2D simulation; not Gazebo, native or hardware evidence.'} No hardware evidence.</p>`;})():''}
<h2>Seeds</h2>${table(['Run','Seed'],[[m.runId,m.seed],...b?[[b.manifest.runId,b.manifest.seed]]:[]])}
<h2>Sample counts</h2>${table(['Stream','Entity','Count'],[['business events (durable)','all',r.businessEvents.length],...Object.entries(t?.sampleCounts??{}).map(([k,v])=>['telemetry (lossy)',k,v])])}
<h2>KPIs</h2>${table(['KPI','Value','Unit','Population','Definition'],reportKpis(r).map(k=>[k.id,k.available?k.value:`unavailable (${k.reason})`,k.unit,`1 run, ${k.samples} samples`,k.definition]))}
${cmp?`<h2>Comparison</h2><p>${cmp.comparable?'Comparable':`Not comparable: ${esc(cmp.reasons.join(', '))}`}. ${esc(cmp.note)}</p>${table(['Input','A','B'],cmp.inputs.map(i=>[i.field,i.a,i.b]))}${table(['KPI','A','B','Delta','Unit'],cmp.kpis.map(k=>[k.id,k.a,k.b,k.delta,k.unit]))}`:''}
<h2>Missing evidence</h2><ul>${missing.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
<h2>Business events (durable)</h2>${table(['Sequence','At (sim clock)','Type','Kind','Id'],r.businessEvents.map(e=>[e.sequence,e.at,e.type,e.kind,e.id]))}
<h2>Telemetry (lossy, coalesced)</h2><p class="note">${t?`${esc(t.samples.length)} samples at ${esc(t.rateHz)} Hz from ${esc(t.source)}; dropped ${esc(t.dropped)}; gaps ${esc(t.gaps.length)}. Not an audit ledger.`:'Not recorded.'}</p>
</body></html>
`;
}
