// A/B comparison of two v2 run reports (CORE-10, UX-10): compatibility reasons first, then KPIs with unit, definition and population.
// Runs on different evidence scales (mode/access/backends/fidelity) or scenarios are not ranked: their deltas are null.
// TODO(interim-copy): same logic as source packages/lab-runtime/src/v2/comparison.ts (tests/unit/report-replay.test.ts covers it here); import from the pinned artifact (F07).
import type {RunReport} from '../scenarios/controls';
import {CAPABILITY_IDS} from './engineering-view';
export interface Kpi {id:string;unit:string;definition:string;value:number|null;available:boolean;reason?:string;samples:number}
const ms=(iso:string)=>Date.parse(iso);
/** KPIs read from one report. Missing data is unavailable with a reason, never 0. */
export function reportKpis(r:RunReport):Kpi[]{
 const ev=r.businessEvents,first=ev.find(e=>e.type==='RobotCommandIssued'),done=[...ev].reverse().find(e=>e.type==='MissionCompleted');
 const execute=r.effects.filter(e=>e.type==='robot.execute');
 let wait=0,waits=0;
 // Arrival belongs to one mission stop. Allocation confirmations may overlap across robots or arrive in parts.
 const pending=new Map<string,{stopId:string;at:number;confirmation:string|undefined;allocations:Set<string>}>();
 for(const e of ev){
  const state=e.state??{},missionId=e.kind==='mission'?e.id:typeof state.missionId==='string'?state.missionId:null;
  if(!missionId)continue;
  const stops=Array.isArray(state.stops)?state.stops as {id:string;action?:string;status?:string;allocationIds?:string[]}[]:[];
  if(e.type==='MissionArrived'){
   const stop=stops.find(s=>s.id===state.currentStopId)??stops.find(s=>s.status==='awaiting_action');
   const stopId=stop?.id??String(state.currentStopId??'');
   if(pending.get(missionId)?.stopId!==stopId)pending.delete(missionId);
   if(!pending.has(missionId))pending.set(missionId,{stopId,at:ms(e.at),confirmation:({load:'CargoLoaded',handoff:'DeliveryHandedOff',return:'CargoReturned'} as Record<string,string>)[stop?.action??''],allocations:new Set(stop?.allocationIds??[])});
   continue;
  }
  const arrival=pending.get(missionId);if(!arrival)continue;
  if(['MissionCancelled','MissionCancellationRequested','MissionFailed'].includes(e.type)||stops.some(s=>s.id===arrival.stopId&&s.status==='skipped')){pending.delete(missionId);continue;}
  if(!['CargoLoaded','DeliveryHandedOff','CargoReturned'].includes(e.type)||arrival.confirmation&&arrival.confirmation!==e.type)continue;
  if(arrival.allocations.size){if(!arrival.allocations.delete(e.id)||arrival.allocations.size)continue;}
  const elapsed=ms(e.at)-arrival.at;
  if(Number.isFinite(elapsed)&&elapsed>=0){wait+=elapsed;waits++;}
  pending.delete(missionId);
 }
 const tickets=new Map<string,number>(),commands=new Map<string,number>();
 let queue=0,queues=0,travel=0,travels=0;
 for(const e of ev){
  if(e.kind==='kitchen-ticket'&&!tickets.has(e.id))tickets.set(e.id,ms(e.at));
  if(e.type==='CoffeeJobReserved'&&typeof e.state?.lineId==='string'){
   const start=tickets.get(e.state.lineId),duration=start===undefined?NaN:ms(e.at)-start;
   if(Number.isFinite(duration)&&duration>=0){queue+=duration;queues++;}
  }
  if(e.type==='RobotCommandIssued')commands.set(e.id,ms(e.at));
  if(e.type==='RobotCommandObserved'&&e.state?.status==='completed'){
   const start=commands.get(e.id),duration=start===undefined?NaN:ms(e.at)-start;
   if(Number.isFinite(duration)&&duration>=0){travel+=duration;travels++;commands.delete(e.id);}
  }
 }
 const active=new Map<string,number>(),spans:[number,number][]=[],finished=new Set<string>();
 for(const raw of r.coffee?.plantLog??[]){
  const e=raw as {event?:string;commandId?:string;tick?:number};if(typeof e.commandId!=='string'||typeof e.tick!=='number'||!Number.isFinite(e.tick))continue;
  if(e.event==='accepted'&&!finished.has(e.commandId)&&!active.has(e.commandId))active.set(e.commandId,e.tick);
  if(e.event==='completed'&&active.has(e.commandId)){
   const start=active.get(e.commandId)!;if(e.tick>=start)spans.push([start,e.tick]);active.delete(e.commandId);finished.add(e.commandId);
  }
 }
 let busyTicks=0,end=-Infinity;
 for(const [a,b]of spans.sort((a,b)=>a[0]-b[0])){busyTicks+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 const c=r.metrics.collision,d=Object.values(r.metrics.distanceM);
 const k=(id:string,unit:string,definition:string,value:number|null,samples:number,reason?:string):Kpi=>({id,unit,definition,value,available:value!==null,...value===null?{reason:reason??'NO_DATA'}:{},samples});
 return [
  k('coffeeQueueWaitS','s','Coffee order ticket creation to successful resource reservation, summed per job; incomplete reservations excluded.',queues?queue/1000:null,queues,'NO_RESERVED_COFFEE_JOB'),
  k('travelTimeS','s','Issued navigation command to completed observation, summed by command identity; unfinished legs excluded.',travels?travel/1000:null,travels,'NO_COMPLETED_TRAVEL'),
  k('cellProcessBusyS','s','Union of accepted-to-completed mock brew/dispense intervals; excludes arm transfer and becomes unavailable if a process cycle has no terminal evidence.',spans.length&&!active.size?busyTicks*r.manifest.clock.tickMs/1000:null,spans.length,active.size?'INCOMPLETE_CELL_CYCLE':'NO_CELL_PROCESS'),
  k('served','count','Units served after the final handoff confirmation (source fulfillment), not after arrival or brew completion.',Number(r.outcome.served),1),
  k('missionTimeS','s','Sim time from the first RobotCommandIssued to the last MissionCompleted, from journal timestamps (virtual clock).',first&&done?(ms(done.at)-ms(first.at))/1000:null,first&&done?1:0,first?'MISSION_NOT_COMPLETED':'NO_ROBOT_COMMAND'),
  k('humanWaitS','s','Sim time from each MissionArrived to the final allocation confirmation for that mission/stop (CargoLoaded, DeliveryHandedOff, CargoReturned), summed once per fully confirmed stop; cancelled and incomplete stops excluded.',waits?wait/1000:null,waits,'NO_CONFIRMED_STOP'),
  k('distanceM','m','Path length travelled by all robots in the model (mock_kinematic grid path), summed.',d.length?d.reduce((a,b)=>a+b,0):null,d.length,'NO_ROBOT'),
  k('executeAttempts','count','robot.execute dispatch attempts from the source outbox (no resend after unknown).',execute.reduce((n,e)=>n+e.attempts,0),execute.length),
  k('contacts','count','Contacts between robot footprint and the world in the model; needs resolved geometry.',c.available?c.contacts:null,c.available?1:0,c.reason),
  k('minSeparationM','m','Minimum footprint separation between robots in the model; needs resolved geometry and two robots.',c.available&&d.length>=2?c.minSeparationM:null,c.available&&d.length>=2&&c.minSeparationM!==null?1:0,d.length<2?'SINGLE_ROBOT':c.reason??'NO_PAIR_SAMPLE'),
 ];
}
const key=(b:RunReport['manifest']['backends'])=>JSON.stringify([...b].map(x=>[x.id,x.version,x.model,x.dynamics]).sort());
/** Evidence-scale flags: two runs whose coverage differs on these are not on the same scale. */
const FIDELITY=['businessSimulation','kinematicModel','dynamics','nativeExecution','physicalStop','sensorEvidence'];
export function compareRuns(a:RunReport,b:RunReport){
 const ma=a.manifest,mb=b.manifest,reasons:string[]=[];
 if(ma.mode!==mb.mode)reasons.push('MODE_DIFFERS');
 if(ma.access!==mb.access)reasons.push('ACCESS_DIFFERS');
 if(ma.scenario.id!==mb.scenario.id||ma.scenario.revision!==mb.scenario.revision||ma.scenario.hash!==mb.scenario.hash)reasons.push('SCENARIO_DIFFERS');
 if(key(ma.backends)!==key(mb.backends))reasons.push('BACKENDS_DIFFER');
 if(ma.clock.tickMs!==mb.clock.tickMs)reasons.push('CLOCK_DIFFERS');
 if(FIDELITY.some(f=>!!a.coverage[f]!==!!b.coverage[f]))reasons.push('FIDELITY_DIFFERS');
 if(!ma.engineering!==!mb.engineering)reasons.push('ENGINEERING_DIFFERS');
 // a modeled and a verified actuator are different evidence scales even when every KPI looks alike; judged by capability name and value, never by key order
 else if(CAPABILITY_IDS.some(id=>a.engineeringEvidence?.capabilities?.[id]!==b.engineeringEvidence?.capabilities?.[id]))reasons.push('CAPABILITY_DIFFERS');
 // only an explicit pass unlocks engineering numbers; missing assessments, not_run and fail show blockers
 const unproven=(r:RunReport)=>(!!r.manifest.engineering||!!r.engineeringEvidence)&&r.engineeringEvidence?.status!=='pass';
 if(unproven(a)||unproven(b))reasons.push('ENGINEERING_EVIDENCE_NOT_PASSED');
 const comparable=!reasons.length;
 // changed inputs are shown, not judged: a layout or seed change is what an A/B compare is for
 const inputs=[['seed',ma.seed,mb.seed],['project.hash',ma.project.hash,mb.project.hash],['world.hash',ma.world.hash,mb.world.hash],['scenario',`${ma.scenario.id} r${ma.scenario.revision}`,`${mb.scenario.id} r${mb.scenario.revision}`],
  ['backendSetId',ma.backendSetId,mb.backendSetId],['engineering.bundleDigest',ma.engineering?.bundleDigest??'',mb.engineering?.bundleDigest??''],['sourceCommit',ma.sourceCommit,mb.sourceCommit],['assets',JSON.stringify(ma.assets),JSON.stringify(mb.assets)]]
  .filter(([,x,y])=>x!==y).map(([field,x,y])=>({field:field as string,a:x as string|number,b:y as string|number}));
 const ka=reportKpis(a).map(k=>unproven(a)?{...k,value:null,available:false,reason:'ENGINEERING_EVIDENCE_NOT_PASSED'}:k),kb=reportKpis(b).map(k=>unproven(b)?{...k,value:null,available:false,reason:'ENGINEERING_EVIDENCE_NOT_PASSED'}:k);
 const kpis=ka.map((x,i)=>{const y=kb[i]!,available=x.available&&y.available;
  return {id:x.id,unit:x.unit,definition:x.definition,a:x.value,b:y.value,available,reasons:[x.reason,y.reason].filter(Boolean) as string[],
   delta:comparable&&available?y.value!-x.value!:null,population:{runs:1,samplesA:x.samples,samplesB:y.samples},percentiles:null as null};});
 const coverage=[...new Set([...Object.keys(a.coverage),...Object.keys(b.coverage)])].map(k=>({key:k,a:!!a.coverage[k],b:!!b.coverage[k]}));
 const pop=(r:RunReport)=>({runs:1,businessEvents:r.businessEvents.length,telemetrySamples:r.telemetry?.samples.length??0,telemetryDropped:r.telemetry?.dropped??0});
 return {comparable,reasons,inputs,kpis,coverage,population:{a:pop(a),b:pop(b)},note:'One run per side: no p50/p95. Repeat with seeds for a distribution.'};
}

// Cross-engine studies are immutable downstream views. Validation establishes shape, never a physics authority.
import Ajv from 'ajv';
import studySchema from '../shared/engineering-schemas/semantic-study-v1.schema.json';
import {tr} from '../i18n';
import {esc} from '../ui/icons';
interface StudyRun {runId:string;engine:string;reportRef:{path:string;sha256:string;bytes:number};artifactRefs:{path:string;sha256:string;bytes:number}[];sceneDigest:string;modelDigest:string;firstTick:number;lastTick:number;replay:{runId:string;tick:number}}
export interface SemanticStudyView {schemaVersion:1;documentType:'semantic-study';accepted:false;status:'complete'|'failed'|'incomparable';reasonCodes:string[];equivalence:Record<string,{id:string;sha256:string}>;invariantPolicy:{id:string;revision:number};runs:StudyRun[];invariants:{runId:string;id:string;status:string;reasonCodes:string[];tick:number|null}[];differences:{runId:string;dimension:string;value:number|null;unit:string;status:string;reason:string|null}[];unsupportedDimensions:{engine:string;dimension:string;status:'unsupported';reason:string}[];percentiles:null;limitations:string[]}
const validateStudy=new Ajv({strict:true,allErrors:true}).compile(studySchema);
export function parseSemanticStudy(text:string):SemanticStudyView{
 if(text.length>8*1024*1024)throw Error('SEMANTIC_STUDY_LIMIT');
 let value:unknown;try{value=JSON.parse(text);}catch{throw Error('SEMANTIC_STUDY_INVALID');}
 if(!validateStudy(value))throw Error('SEMANTIC_STUDY_INVALID');return value as unknown as SemanticStudyView;
}
export function comparisonTabs(selected:'run'|'study',runHtml:string,studyHtml:string):string{
 return `<div class="study-tabs" role="tablist" aria-label="${tr('Phạm vi báo cáo','レポート範囲','Report scope')}">${(['run','study'] as const).map(t=>`<button class="button quiet" role="tab" id="comparison-tab-${t}" aria-selected="${selected===t}" tabindex="${selected===t?0:-1}" aria-controls="comparison-panel-${t}" data-action="twin-study-tab" data-value="${t}">${t==='run'?tr('Báo cáo lần chạy','実行レポート','Run reports'):tr('Nghiên cứu đa engine','エンジン間スタディ','Semantic study')}</button>`).join('')}</div><div role="tabpanel" id="comparison-panel-run" aria-labelledby="comparison-tab-run"${selected==='run'?'':' hidden'}>${runHtml}</div><div role="tabpanel" id="comparison-panel-study" aria-labelledby="comparison-tab-study"${selected==='study'?'':' hidden'}><label for="twin-import-study">${tr('Nhập báo cáo nghiên cứu JSON','スタディJSONを読み込む','Import study report JSON')}</label><input id="twin-import-study" type="file" accept="application/json,.json">${studyHtml}</div>`;
}
export function semanticStudyHtml(study:SemanticStudyView|null):string{
 if(!study)return `<p class="field-help">${tr('Chưa nhập nghiên cứu. Tệp nghiên cứu chỉ đọc hoạt động khi không có runtime.','スタディは未読込です。読み取り専用ファイルはランタイムなしで使えます。','No study imported. Read-only study files work without a runtime.')}</p>`;
 const engine=(runId:string)=>({irsim_2d:'IR-SIM',webots_3d:'Webots',mujoco_3d:'MuJoCo'}[study.runs.find(r=>r.runId===runId)?.engine??'']??runId.slice(0,8));
 const check=(id:string)=>({'arrival-confirmation-served':tr('Đến → xác nhận → đã giao','到着 → 確認 → 配送済み','Arrival → confirmation → served'),'unknown-no-redispatch':tr('Không gửi lại sau unknown','unknown後の再送なし','No redispatch after unknown'),'cancel-causality':tr('Quan hệ hủy','キャンセルの因果','Cancel causality'),'goal-frame-world-bindings':tr('Goal / frame / world khớp','目標・座標系・ワールド一致','Goal / frame / world bindings'),'arrival-policy-window':tr('Cửa sổ dừng khi đến','到着時の停止区間','Stopped arrival window'),'registered-navigation-constraints':tr('Ràng buộc điều hướng','登録済みナビ制約','Navigation constraints')}[id]??id);
 const status=(value:string)=>({pass:tr('đạt','合格','pass'),fail:tr('không đạt','不合格','fail'),not_run:tr('chưa chạy','未実行','not run')}[value]??value);
 const reason=(value:string)=>({NO_UNKNOWN_TRIGGER:tr('Lần chạy không có unknown','unknownケースなし','No unknown case'),NO_CANCEL_TRIGGER:tr('Lần chạy không hủy','キャンセルケースなし','No cancellation case')}[value]??value);
 const dimension=(value:string)=>({arrivalGoalErrorMaxM:tr('Sai vị trí lúc đến','到着時の位置誤差','Position error at arrival'),arrivalWindowPositionErrorMaxM:tr('Sai vị trí tối đa trong cửa sổ','停止区間の最大位置誤差','Maximum position error in window'),driveDistanceM:tr('Quãng đường drive frame','駆動座標系の距離','Drive-frame distance'),minObstacleClearanceM:tr('Khoảng hở vật cản nhỏ nhất','最小障害物距離','Minimum obstacle clearance')}[value]??value);
 const table=(caption:string,head:string[],rows:string[][])=>`<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="eng-table"><caption>${esc(caption)}</caption><thead><tr>${head.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((x,i)=>`<${i?'td':'th scope="row"'}>${esc(x)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 return `<section data-testid="semantic-study"><h3>${tr('Nghiên cứu đa engine','エンジン間スタディ','Cross-engine semantic study')}</h3><p>${esc(study.status)} · accepted:false · imported_integrity_only · not_calibrated</p><p class="field-help">${tr('So quan hệ nghiệp vụ và hình học trên đầu vào tương đương. Không có dữ liệu đo chuẩn để xếp hạng độ chính xác; mỗi engine chỉ có một lần chạy.','同等入力の業務関係と形状を比較します。実測基準がなく、各エンジン1実行のため精度順位は付けません。','Business relations and geometry use equivalent inputs. There is no measured ground truth for an accuracy ranking; each engine has one run.')}</p>${study.reasonCodes.length?`<p role="status">${study.reasonCodes.map(esc).join(' · ')}</p>`:''}
 ${study.runs.map(r=>`<details><summary>${esc(r.engine)} · ${esc(r.runId)} · tick ${r.firstTick}–${r.lastTick}</summary><p>scene <code>${esc(r.sceneDigest)}</code> · model <code>${esc(r.modelDigest)}</code></p><p>${tr('Báo cáo SHA256','レポートSHA256','Report SHA256')}: <code>${esc(r.reportRef.sha256)}</code></p><button class="button quiet" data-action="twin-study-replay" data-value="${esc(r.runId)}" data-run-id="${esc(r.runId)}" data-tick="${r.replay.tick}">${tr('Mở replay đã nhập','読み込み済み再生を開く','Open imported replay')} · tick ${r.replay.tick}</button></details>`).join('')}
 ${table(tr('Quan hệ Source','Source因果関係','Source causal relations'),[tr('Kiểm tra','検査','Check'),tr('Kết quả / phạm vi','結果・範囲','Result / scope')],study.invariants.map(i=>[`${engine(i.runId)} · ${check(i.id)}`,`${status(i.status)}${i.reasonCodes.length?' · '+i.reasonCodes.map(reason).join(', '):''}`]))}
 ${table(tr('Khác biệt quan sát','観測差分','Observed differences'),[tr('Lần chạy','実行','Run'),tr('Đại lượng','次元','Dimension'),tr('Giá trị','値','Value'),tr('Đơn vị','単位','Unit')],study.differences.map(d=>[engine(d.runId),dimension(d.dimension),d.value===null?`${tr('Không khả dụng','利用不可','Unavailable')} · ${d.reason??d.status}`:Number(d.value.toPrecision(6)).toString(),d.unit]))}
 ${table(tr('Ngoài khả năng engine','非対応の次元','Unsupported dimensions'),['Engine',tr('Đại lượng','次元','Dimension'),tr('Kết quả','結果','Result')],study.unsupportedDimensions.map(d=>[d.engine,d.dimension,'unsupported · '+tr('Engine không mô phỏng động lực tiếp xúc','接触ダイナミクス非対応','Engine has no contact dynamics')]))}
 <details><summary>${tr('Phạm vi đầu vào và giới hạn','入力範囲と制限','Input scope and limits')}</summary>${Object.entries(study.equivalence).map(([k,v])=>`<p>${esc(k)} · ${esc(v.id)} · <code>${esc(v.sha256)}</code></p>`).join('')}${study.limitations.map(l=>`<p>${esc(l)}</p>`).join('')}</details></section>`;
}
