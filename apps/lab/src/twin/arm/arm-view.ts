// Arm inspector rows from telemetry and run evidence (plan 03 A05). Pure, read-only: joints actual/commanded with provenance and age,
// and the ARM03 status derived from the report's recorded checker evidence (engine, intervals, failure) — never from a viewer overlap.
// No checker evidence in the report means ARM03 is not run for that cursor, whatever the picture shows.
import {validVerification} from '../../reports/verification';
import type {RunReport} from '../../scenarios/controls';
import type {Row} from '../amr';
import {fmt} from '../amr';
import {tr} from '../../i18n';
import type {ArmJointsView} from './arm-telemetry';
export function armTelemetryRows(v:ArmJointsView|null):Row[] {
 if(!v)return [];
 const src=v.providerId==='mujoco_arm'?tr('thực (MuJoCo) · lệnh','実測(MuJoCo) · 指令','actual (MuJoCo) · commanded'):v.provenance==='physics_sim'?tr('thực (Webots) · lệnh','実測(Webots) · 指令','actual (Webots) · commanded'):v.provenance==='controller_sim'?tr('controller mô phỏng','コントローラ模擬','controller sim'):v.provenance==='mock'?tr('mock','モック','mock'):v.provenance;
 const rows:Row[]=Array.from({length:6},(_,i)=>({key:`joint-${i+1}`,label:`q${i+1}`,observed:v.jointsActualRad?`${fmt(v.jointsActualRad[i]!,4)} (${fmt(v.jointsActualRad[i]!*180/Math.PI,2)}°)`:tr('không có','なし','none'),
  commanded:v.jointsCommandedRad?`${fmt(v.jointsCommandedRad[i]!,4)} (${fmt(v.jointsCommandedRad[i]!*180/Math.PI,2)}°)`:'—',unit:'rad',source:v.jointsActualRad?(v.stale?'unknown':'observed'):v.jointsCommandedRad?'commanded':'unknown',ageMs:v.ageMs}));
 if(v.tcpM)rows.push({key:'tcp',label:'TCP x, y, z',observed:v.tcpM.map(x=>fmt(x,3)).join(', '),commanded:'—',unit:'m',source:v.stale?'unknown':'observed',ageMs:v.ageMs});
 rows.push({key:'homed',label:tr('Đã home','ホーム済み','Homed'),observed:v.homed===null?tr('chưa rõ','不明','unknown'):v.homed?tr('có','はい','yes'):tr('không','いいえ','no'),commanded:'—',unit:'',source:v.homed===null?'unknown':'observed',ageMs:v.ageMs});
 rows.push({key:'arm-source',label:tr('Nguồn / độ mới','ソース / 鮮度','Source / freshness'),observed:`${src} · ${v.providerId} · ${v.stale?tr('CŨ','古い','STALE'):tr('mới','新鮮','fresh')} ${Math.round(v.ageMs)} ms · boot ${v.bootId.slice(-6)} seq ${v.seq}`,commanded:v.observedAt??'—',unit:'',source:v.stale?'unknown':'observed',ageMs:v.ageMs});
 if(v.reasonCodes.length)rows.push({key:'arm-reasons',label:tr('Lý do','理由','Reasons'),observed:v.reasonCodes.join(', '),commanded:'—',unit:'',source:'unknown',ageMs:v.ageMs});
 return rows;
}
export interface Arm03Status {result:'pass'|'fail'|'not_run';reason:string;engine:string|null;intervals:number;geometryRevision:string|null}
/** ARM03 from the recorded evidence up to `tick`: the checker must have run (intervals retained, geometry named); a picture is never a pass. */
export function arm03Status(report:RunReport|null,tick:number):Arm03Status {
 if(report?.verification||(report?.manifest.mode==='simulation'&&!report.arm)){ // a plant arm (webots_arm) keeps its ARM03 evidence in the coffee arm trace, like the mock
  const v=report.verification,a=v?.arm,none=(reason:string):Arm03Status=>({result:'not_run',reason,engine:a?.engine??null,intervals:0,geometryRevision:a?.geometryRevision??null});
  if(!validVerification(v)||v.execution!=='ran'||!a)return none('CONTROLLER_EVIDENCE_INVALID_OR_MISSING');
  if(a.worldRevision.id!==report.manifest.world.id||a.worldRevision.revision!==report.manifest.world.revision||a.worldRevision.hash!==report.manifest.world.hash)return none('VERIFICATION_WORLD_MISMATCH');
  if(!Number.isFinite(tick)||!a.trace||!v.armTickMap?.length)return none('TRACE_OR_TICK_MAPPING_MISSING');
  const runTick=(sample:number)=>v.armTickMap!.find(m=>m.sampleTick===sample)?.runTick??Infinity;
  const collisions=a.colliding.filter(c=>runTick(c.interval.toTick)<=tick);
  if(collisions.length)return {result:'fail',reason:collisions.map(c=>`${c.reason}:${c.pair.join('/')}`).join(', '),engine:a.engine,intervals:a.coverage?.intervals??0,geometryRevision:a.geometryRevision};
  if(runTick(a.trace.toTick)>tick)return none('NO_COMPLETE_CHECKER_SPAN_AT_CURSOR');
  return {result:a.result,reason:a.reasonCodes.join(', '),engine:a.engine,intervals:a.coverage?.intervals??0,geometryRevision:a.geometryRevision};
 }
 const c=report?.coffee?.armTrace.collision;
 if(!report||!c)return {result:'not_run',reason:'CHECKER_EVIDENCE_MISSING',engine:null,intervals:0,geometryRevision:null};
 const intervals=(c.evidence?.intervals??[]).filter(i=>i.firstTick<=tick);
 if(!intervals.length)return {result:'not_run',reason:'NO_CHECKED_INTERVAL_AT_CURSOR',engine:c.last?.engine??null,intervals:0,geometryRevision:null};
 const scene=c.scene,scope=scene&&scene.tick<=tick?scene:null;
 if(!scope||!scope.available)return {result:'not_run',reason:scope?scope.reason??'SCENE_UNAVAILABLE':'SCENE_NOT_DECLARED_AT_CURSOR',engine:c.last?.engine??null,intervals:intervals.length,geometryRevision:null};
 const failure=c.evidence?.firstFailure&&c.evidence.firstFailure.tick<=tick?c.evidence.firstFailure:null;
 if(failure)return {result:'fail',reason:`${failure.result.reason??'COLLISION'}:${(failure.result.pair??[]).join('/')}`,engine:failure.result.engine,intervals:intervals.length,geometryRevision:failure.result.geometryRevision};
 if(c.evidence?.projection&&!c.evidence.projection.historyComplete)return {result:'not_run',reason:c.evidence.projection.reason??'HISTORY_INCOMPLETE',engine:c.last?.engine??null,intervals:intervals.length,geometryRevision:null};
 const last=intervals[intervals.length-1]!;
 return {result:intervals.every(i=>i.result.ok)?'pass':'fail',reason:intervals.every(i=>i.result.ok)?'':'INTERVAL_NOT_OK',engine:last.result.engine,intervals:intervals.length,geometryRevision:last.result.geometryRevision};
}
export function arm03Rows(report:RunReport|null,tick:number):Row[] {
 const s=arm03Status(report,tick),label=s.result==='pass'?tr('đạt','合格','pass'):s.result==='fail'?tr('không đạt','不合格','fail'):tr('chưa chạy','未実行','not run');
 return [{key:'arm03',label:'ARM03 · '+tr('kiểm va chạm hình học','幾何衝突チェック','geometric collision check'),observed:`${label}${s.reason?` · ${s.reason}`:''}`,commanded:s.engine?`${s.engine} · ${s.intervals} ${tr('khoảng','区間','intervals')}${s.geometryRevision?` · ${s.geometryRevision.slice(0,8)}`:''}`:'—',unit:'',source:s.result==='not_run'?'unknown':'modeled',ageMs:null}];
}

export const readArmVerdict=(report:RunReport,cursorTick:number)=>arm03Status(report,cursorTick).result;
