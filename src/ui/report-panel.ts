import {physicsHtml} from '../reports/physics';
import {driveHtml} from '../reports/control';
// Replay, trace, compare and export of the run report. Read-only: built on reports/replay (no runtime client), every runtime string escaped.
import {arm03Status} from '../twin/arm/arm-view';
import {validVerification} from '../reports/verification';
import type {RunReport} from '../scenarios/controls';
import type {openReplayV2} from '../reports/replay';
import {compareRuns} from '../reports/compare';
import {engineeringView} from '../reports/engineering-view';
import {engineVersionOf,navigationEvidence,navigationEvidenceView,navigationRows} from '../reports/navigation2d';
import {summarizeReportV2} from '../reports/metrics';
import {reportClock} from '../reports/clock';
import {icon,esc} from './icons';
import {tr} from '../i18n';
export interface ReplayState {rp:ReturnType<typeof openReplayV2>;tick:number;playing:boolean}
const fmt=(n:number|null,d=2)=>typeof n!=='number'||!Number.isFinite(n)?'—':Number.isInteger(n)?String(n):n.toFixed(d);
const sampleText=(s:{entityId:string;quality:string;observed:Record<string,unknown>|null;commanded:Record<string,unknown>|null;reasonCodes:string[]})=>{
 const o=s.observed,c=s.commanded;
 if(o&&typeof o.xM==='number')return `x ${fmt(o.xM as number)} m · y ${fmt(o.yM as number)} m · ${fmt(o.yawRad as number,3)} rad`;
 if(c&&Array.isArray(c.jointsRad))return `${tr('lệnh','指令','commanded')} q = [${(c.jointsRad as number[]).map(q=>fmt(q,3)).join(', ')}] rad · ${tr('quan sát','観測','observed')}: ${s.reasonCodes[0]??'—'}`;
 if(o&&'cycleState' in o)return `${o.cycleState} · ${tr('cốc','カップ','cup')} ${o.cupPresent===null?'?':o.cupPresent?tr('có','あり','present'):tr('không','なし','absent')} · ${o.machineStatus??'?'}`;
 return s.quality;
};
/** Scrubber marks: one per tick with a business event (labelled with its event types); above `max`, evenly spaced ones, first and last kept. */
export function replayMarks(report:RunReport,max=200):{tick:number;label:string}[]{
 const {eventTick}=reportClock(report),byTick=new Map<number,Set<string>>();
 for(const e of report.businessEvents){const t=eventTick(e.at);if(Number.isFinite(t))byTick.set(t,(byTick.get(t)??new Set()).add(e.type));}
 const all=[...byTick].sort((a,b)=>a[0]-b[0]).map(([tick,types])=>({tick,label:[...types].join(', ')}));
 return all.length<=max?all:Array.from({length:max},(_,i)=>all[max===1?0:Math.round(i*(all.length-1)/(max-1))]!);
}
/** Body of the replay section: re-rendered on scrub without replacing the range input. */
export function replayBody(r:ReplayState,selected:string|null):string{
 const f=r.rp.seek(r.tick),last=f.events.slice(-6).reverse(),trace=selected?r.rp.trace(selected).filter(row=>row.tick<=f.tick):[];
 return `${f.gaps.length?`<p class="unknown-text" data-testid="replay-gaps">${icon('info',14)}${f.gaps.map(g=>`${tr('Khoảng trống telemetry','テレメトリ欠落','Telemetry gap')}: ${esc(g.reason)}`).join(' · ')}</p>`:''}
<h4>${tr('Sự kiện nghiệp vụ tới thời điểm này','この時点までの業務イベント','Business events up to here')} (${f.events.length})</h4>
<ol class="replay-events" data-testid="replay-events">${last.map(e=>`<li><code>#${esc(e.sequence)}</code> ${esc(e.type)} <small>${esc(e.kind)} ${esc(e.id)}</small></li>`).join('')||`<li class="empty-inline">—</li>`}</ol>
<h4>${tr('Lỗi đã chèn tới thời điểm này','この時点までの注入障害','Injected faults up to here')}</h4><ol data-testid="replay-faults">${f.faults.map(x=>`<li>tick ${esc(x.tick)} · ${esc(x.faultId)} · ${esc(x.entityId??'—')}</li>`).join('')||'<li>—</li>'}</ol>
<h4>${tr('Trạng thái đã ghi' ,'記録された状態','Recorded state')}</h4>
<ul class="replay-entities" data-testid="replay-entities">${Object.values(f.entities).map(s=>`<li><b>${esc(s.entityId)}</b> <span class="state-text">${esc(s.quality)}</span> ${esc(sampleText(s))}</li>`).join('')||`<li class="empty-inline">${tr('Không có telemetry ghi lại','記録テレメトリなし','No recorded telemetry')}</li>`}</ul>
${selected?`<h4>${tr('Trace','トレース','Trace')}: ${esc(selected)}</h4><ol class="trace-rows" data-testid="trace-rows">${trace.map(x=>`<li><span class="source-tag ${x.layer==='command'?'commanded':x.layer==='observation'||x.layer==='telemetry'?'observed':'derived'}">${esc(x.layer)}</span> tick ${esc(x.tick)} · ${esc(x.type)} <small>${esc(x.id)}${x.detail?` · ${esc(x.detail)}`:''}</small></li>`).join('')||`<li class="empty-inline">${tr('Không có bản ghi nhắc tới đối tượng này','この対象の記録なし','No record names this object')}</li>`}</ol>`:''}`;
}
export function reportSummary(report:RunReport,business=0):string {
 const s=summarizeReportV2(report),t=s.telemetry;
 return `<p class="field-help" id="twin-report-summary" data-testid="report-streams">${tr('Sự kiện nghiệp vụ (bền, từ journal)','業務イベント(永続、ジャーナル)','Business events (durable, journal)')}: <b>${esc(s.businessEvents)}</b> · ${tr('Telemetry (có thể mất, gộp)','テレメトリ(損失可・集約)','Telemetry (lossy, coalesced)')}: ${t?`<b>${esc(t.samples)}</b> ${tr('mẫu','件','samples')} (${Object.entries(t.sampleCounts).map(([k,v])=>`${esc(k)} ${esc(v)}`).join(', ')}) · drop ${esc(t.dropped)} · gap ${esc(t.gaps)}`:tr('runtime này không ghi','このランタイムは未記録','not recorded by this runtime')}${business?` · ${tr('đã nhận qua stream','ストリーム受信','streamed')} ${esc(business)}`:''}</p>`;
}
/** Engineering assessment: blockers when the run did not pass, capability levels always. Absent on legacy reports. */
export function engineeringHtml(report:RunReport):string{
 const v=engineeringView(report);if(!v)return '';
 const label={pass:tr('Đạt','合格','Pass'),fail:tr('Không đạt','不合格','Fail'),not_run:tr('Chưa chạy','未実行','Not run')}[v.status];
 const level={unsupported:tr('không hỗ trợ','未対応','unsupported'),modeled:tr('mô hình hoá','モデル','modeled'),verified:tr('đã xác minh','検証済み','verified')};
 return `<div data-testid="engineering-evidence" data-tone="${esc(v.tone)}"><h3>${tr('Bằng chứng kỹ thuật','エンジニアリング検証','Engineering evidence')}</h3><p><b>${label}</b>${v.ref?` · <code>${esc(v.ref.bundleDigest.slice(0,12))}</code>`:''}</p>
${v.blockers.length?`<ul class="blockers" data-testid="engineering-blockers">${v.blockers.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`:''}
<ul class="capabilities">${v.capabilities.map(c=>`<li data-capability="${esc(c.id)}" data-level="${esc(c.level)}"><b>${esc(c.id)}</b> ${esc(level[c.level]??c.level)}</li>`).join('')}</ul>
<p class="source-note">${tr('Mô phỏng không phải bằng chứng phần cứng; chỉ mức "đã xác minh" dựa trên hiệu chuẩn đo thật.','シミュレーションはハード証拠ではありません。「検証済み」は実測校正のみ。','Simulation is not hardware evidence; only "verified" rests on measured calibration.')}</p></div>`;
}
/** IR-SIM 2D evidence: provider, completeness with every reason, and each assertion's own result. Reports without it say unavailable (never pass). */
export function navigationHtml(report:RunReport):string{
 if(report.navigation2d===undefined&&!report.manifest.backends.some(b=>b.id==='irsim_2d'||b.id==='webots_3d'||b.id==='mujoco_3d'))return '';
 const v=navigationEvidenceView(report),n=navigationEvidence(report),m=report.metrics.navigation,result=(r:string)=>({pass:tr('đạt','合格','pass'),fail:tr('không đạt','不合格','fail'),inconclusive:tr('chưa kết luận','判定不能','inconclusive'),not_run:tr('chưa chạy','未実行','not run'),unverified:tr('chưa xác lập (bằng chứng chưa đầy đủ)','未確立（証跡が不完全）','not established (evidence incomplete)')})[r]??r;
 return `<div data-testid="navigation-evidence" data-supported="${esc(v.supported)}" data-complete="${esc(v.complete)}"><h3>${tr('Bằng chứng điều hướng','ナビゲーション証跡','Navigation evidence')}</h3>
<p><b>${v.supported?esc(v.provider!):tr('không khả dụng','利用不可','unavailable')}</b> · ${v.complete?tr('đầy đủ','完全','complete'):tr('chưa đầy đủ','不完全','incomplete')}${v.reasons.length?`: <span data-testid="navigation-reasons">${esc(v.reasons.join(', '))}</span>`:''}</p>
${n?`<p class="field-help">tick 0–${esc(n.clock.tickHorizon)} · ${esc(n.controller.id)} ${esc(n.controller.version)} · ${esc(`${n.engine.id} ${engineVersionOf(n.engine)}`)} · Python ${esc(n.engine.pythonVersion)} · ${esc(n.engine.platform)} · seed ${esc(n.seed.runSeed)}/${esc(n.seed.engineSeed)} · trajectory <code>${esc(n.digests.trajectoryDigest.slice(0,12))}</code> · sensor <code>${esc(n.digests.sensorDigest.slice(0,12))}</code>${m?.sensorPublications?` · LiDAR ${esc(m.sensorPublications.recorded)}/${esc(m.sensorPublications.expected)}`:''}</p>
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${tr('Khẳng định điều hướng','ナビゲーションのアサーション','Navigation assertions')}"><table class="eng-table nav-assertions" data-testid="navigation-assertions"><thead><tr><th scope="col">${tr('Khẳng định','アサーション','Assertion')}</th><th scope="col">${tr('Kết quả','結果','Result')}</th><th scope="col">${tr('Chi tiết','詳細','Detail')}</th></tr></thead><tbody>${navigationRows(report).map(r=>`<tr data-result="${esc(r.result)}"><th scope="row">${esc(r.id)}</th><td><span class="state-text">${esc(result(r.result))}</span></td><td><details class="nav-assertion-detail"><summary>${tr('Xem chi tiết','詳細を見る','Inspect detail')}</summary><p>${esc(r.detail)}</p></details></td></tr>`).join('')}</tbody></table></div>`:''}
<p class="source-note">${n?.engine.id==='mujoco_3d'?tr('Mô phỏng MuJoCo 3D · chưa hiệu chuẩn · định vị ground_truth · không phải phần cứng.','MuJoCo 3D · 未校正 · ground_truth測位 · 実機ではありません。','MuJoCo 3D simulation · not_calibrated · ground_truth localization · no hardware evidence.'):n?.engine.id==='webots_3d'?tr('Mô phỏng 3D vật lý cứng (Webots R2025a); mọi tham số vật lý là giả định, chưa hiệu chuẩn (not_calibrated); không phải bằng chứng Gazebo, native hay phần cứng.','剛体物理の3Dシミュレーション(Webots R2025a)。物理パラメータはすべて仮定で未校正(not_calibrated)。Gazebo・ネイティブ・実機の証拠ではありません。','Rigid-body 3D simulation (Webots R2025a); every physical parameter is assumed and not calibrated (not_calibrated); not Gazebo, native or hardware evidence.'):tr('Mô phỏng 2D động học phẳng; không phải bằng chứng Gazebo, native hay phần cứng.','平面運動学の2Dシミュレーション。Gazebo・ネイティブ・実機の証拠ではありません。','Planar kinematic 2D simulation; not Gazebo, native or hardware evidence.')}</p></div>`;
}
/** Mobile aggregates belong to the final cursor. Other providers retain their full-run evidence policy. */
export function navigationAtCursor(report:RunReport,tick?:number):string{
 return report.navigation2d?.engine.id==='mujoco_3d'&&tick!==undefined&&tick<report.outcome.tick?`<p class="field-help">${tr('Bằng chứng điều hướng tổng hợp có ở cuối lần chạy.','ナビゲーション集計は実行末尾で表示します。','Aggregate navigation evidence is available at the final cursor.')}</p>`:navigationHtml(report);
}
/** `report` may be the replay cursor's projection (streams, verification at the cursor); `full` is the report itself: the navigation evidence verdict is a property of
 * the whole recorded run and is always derived from it, never from a cursor projection. */
export function reportPanel(report:RunReport|null,o:{replay:ReplayState|null;previous:RunReport|null;selected:string|null;business:number;full?:RunReport|null;/** an action holds the page: replay waits */busy?:boolean}):string{
 if(!report)return '';
 const s=summarizeReportV2(report),cmp=!o.replay&&o.previous?compareRuns(o.previous,report):null;
 const streams=reportSummary(report,o.business);
 const verification=controllerVerificationHtml(report,o.replay?.tick??report.outcome.tick);
 const r=o.replay;
 const replay=r?`<div class="replay" data-testid="replay-panel"><p class="source-note">${icon('lock',14)}${tr('Chỉ đọc: xem lại không gửi lệnh, không nội suy qua khoảng trống.','読み取り専用:再生はコマンドを送らず、欠落を補間しません。','Read-only: replay sends no command and never interpolates across gaps.')}</p><div id="twin-replay-body">${replayBody(r,o.selected)}</div></div>`
  :`<button class="button secondary" data-action="twin-replay"${o.busy?' disabled':''}>${icon('play',16)}${tr('Xem lại (chỉ đọc)','再生(読み取り専用)','Replay (read-only)')}</button>`;
 const compare=cmp?`<div class="compare" data-testid="compare-panel"><h3>${tr('So sánh với lần chạy trước','前回の実行と比較','Compare with the previous run')}</h3><p><b>${cmp.comparable?tr('So sánh được','比較可能','Comparable'):tr('Không so sánh được','比較不可','Not comparable')}</b>${cmp.reasons.length?`: ${esc(cmp.reasons.join(', '))}`:''} · ${esc(cmp.note)}</p>
${cmp.inputs.length?`<p class="field-help">${tr('Đầu vào khác','異なる入力','Changed inputs')}: ${cmp.inputs.map(i=>`${esc(i.field)} ${esc(String(i.a).slice(0,12))} → ${esc(String(i.b).slice(0,12))}`).join(' · ')}</p>`:''}
<table class="eng-table"><thead><tr><th scope="col">KPI</th><th scope="col">${tr('Trước','前回','Previous')}</th><th scope="col">${tr('Lần này','今回','This run')}</th><th scope="col">Δ</th><th scope="col">${tr('Đơn vị','単位','Unit')}</th></tr></thead><tbody>${cmp.kpis.map(k=>`<tr><th scope="row" title="${esc(k.definition)}">${esc(k.id)}</th><td>${k.a===null?`<span class="unknown-text">${tr('không có','なし','n/a')}</span>`:fmt(k.a)}</td><td>${k.b===null?`<span class="unknown-text">${tr('không có','なし','n/a')}</span>`:fmt(k.b)}</td><td>${k.delta===null?'—':fmt(k.delta)}</td><td>${esc(k.unit)}</td></tr>`).join('')}</tbody></table></div>`:'';
 const exports=`<div class="run-actions" role="group" aria-label="${tr('Xuất báo cáo','レポート出力','Export report')}">${['json','csv','html'].map(f=>`<button class="button quiet" data-action="twin-export" data-value="${f}">${icon('arrow',14)}${f.toUpperCase()}</button>`).join('')}</div>`;
 return `<section class="panel report-panel" data-testid="report-panel" aria-labelledby="report-title"><div class="panel-heading"><h2 id="report-title">${tr('Xem lại & báo cáo','再生とレポート','Replay & report')}</h2><span class="pill">${esc(s.evidence)}</span></div>${streams}<p class="field-help" data-testid="report-captured-horizon">${tr('Báo cáo chụp tại tick','レポート取得tick','Report captured at tick')} ${report.outcome.tick} · ${(report.outcome.tick*report.manifest.clock.tickMs/1000).toFixed(2)} s</p>${engineeringHtml(report)}<div id="twin-navigation-evidence">${navigationAtCursor(o.full??report,o.replay?.tick)}</div>${verification}${physicsHtml(report,o.replay?.tick??report.outcome.tick)}${driveHtml(o.full??report)}${armPlantHtml(report)}${replay}${compare}${exports}<button class="button quiet" data-action="twin-save-evidence">${tr('Lưu báo cáo bất biến','不変レポートを保存','Save immutable report')}</button></section>`;
}

export function controllerVerificationHtml(report:RunReport,tick:number):string{
 const v=report.verification,a=v?.arm,verdict=arm03Status(report,tick);
 const verification=v&&validVerification(v)?`<div data-testid="controller-verification"><h3>${tr('Bằng chứng controller','コントローラ検証記録','Controller evidence')}</h3><p>${esc(v.target)} · ${esc(v.execution)} · ARM03: <b>${esc(verdict.result)}</b> · ${esc(verdict.reason)}</p><p>${tr('Nguồn / độ trung thực','ソース / 忠実度','Producer / fidelity')}: ${v.aspects.map(x=>`${esc(x.producer)} / ${esc(x.fidelity)}`).join(' · ')||'—'}</p><p>${esc(a?.engine??'—')} · model ${esc(a?.modelRevision??'—')} · world ${esc(a?.worldRevision.hash??'—')} · ${tr('Khoảng kiểm tra','検査区間','Checked intervals')}: ${esc(verdict.intervals)}</p><p>${esc(v.blockers.join(', '))}</p><details><summary>${tr('Artifact và SHA256','成果物とSHA256','Artifacts and SHA256')}</summary><ul>${v.artifacts.map(x=>`<li>${esc(x.path)} · ${esc(x.bytes)} B · <code>${esc(x.sha256)}</code></li>`).join('')}</ul></details></div>`:`<p data-testid="controller-verification">${tr('Chưa có xác minh controller/tay máy; dữ liệu engine di động có phạm vi riêng.','コントローラー・アーム検証は未提供。移動エンジンの観測は別範囲です。','Controller/arm verification unavailable; mobile engine observations have their own scope.')}</p>`;
 return verification;
}

/** The arm plant block: what the arm is (engine, control, grip, dynamics, calibration), how far it was from its commands, ARM03 and the trace file's hash. Absent for a mock arm.
 * A MuJoCo plant adds its solved waypoint table, the allowed contacts (static over the whole trace), the assumed release timeout, the runtime's own statements,
 * whether the docked robot was in the arm's collision check, and a stop as the runtime reports it (codes and fixed wording only). */
export function armPlantHtml(report:RunReport):string{
 const a=report.arm;if(!a)return '';
 const mujoco=a.armPlant.engine==='mujoco_3d',rad=(v:number)=>`${fmt(v,4)} rad`,rows=a.tracking.peakRad.map((peak,i)=>`<tr><th scope="row">q${i+1}</th><td>${rad(peak)}</td><td>${rad(a.tracking.rmsRad[i]??0)}</td></tr>`).join('');
 const table=(label:string,head:string[],body:string,testid='')=>`<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${label}"><table class="eng-table"${testid?` data-testid="${testid}"`:''}><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
 const scene=report.coverage?.armSceneCollision,stop=report.coffee?.armTrace.stop;
 const cell=!mujoco?'':`${a.waypoints?`<h4>${tr('Waypoint IK đã giải (từ fixture, không giải lúc chạy)','解いたIKウェイポイント(フィクスチャから、実行時には解かない)','Solved IK waypoints (from the fixture, not solved at run time)')}</h4>${table(tr('Waypoint IK','IKウェイポイント','IK waypoints'),[tr('Waypoint','ウェイポイント','Waypoint'),'q (rad)',tr('Sai vị trí (mm)','位置誤差(mm)','Position error (mm)'),tr('Sai hướng (rad)','姿勢誤差(rad)','Orientation error (rad)'),tr('Số điều kiện','条件数','Condition')],
  a.waypoints.table.map(w=>`<tr><th scope="row">${esc(w.waypoint)}</th><td>${w.q.map(q=>fmt(q,3)).join(', ')}</td><td>${fmt(w.positionErrorM*1000,2)}</td><td>${fmt(w.orientationErrorRad,4)}</td><td>${fmt(w.condition,1)}</td></tr>`).join(''),'arm-waypoints')}<p class="field-help">digest <code>${esc(a.waypoints.digest.slice(0,12))}</code></p>`:''}
${a.allowedContacts?`<div data-testid="arm-allowed-contacts"><p>${tr('Tiếp xúc được phép','許可された接触','Allowed contacts')}: ${a.allowedContacts.map(c=>`<code>${esc(c.a)}</code>/<code>${esc(c.b)}</code>`).join(' · ')}${a.collision.coverage?` · ${tr('đã áp dụng','適用','applied')} ${esc(a.collision.coverage.allowedContactsApplied)}`:''}</p><p class="source-note">${tr('Các cặp này áp dụng trên toàn bộ vệt (từ tick đầu tới tick cuối), không theo từng pha; pha chỉ gọi tên giá đỡ mà cặp chạm tới.','これらの組はトレース全体(最初から最後のtickまで)に適用され、フェーズごとではありません。フェーズは接触する支持物の名前だけです。','These pairs apply over the whole trace (first to last tick), not within a phase; the phase only names the support the pair touches.')}</p></div>`:''}
${a.releaseTimeoutTicks!==undefined?`<p data-testid="arm-release-timeout">${tr('Thời gian chờ thả cốc','カップ解放の待ち時間','Release timeout')}: ${esc(a.releaseTimeoutTicks)} tick (${fmt(a.releaseTimeoutTicks*report.manifest.clock.tickMs/1000,2)} s) · ${tr('giá trị giả định của bộ điều khiển','コントローラの仮定値','an assumed controller value')}</p>`:''}
<p>${tr('Robot đã đỗ có trong kiểm va chạm của tay máy','停車したロボットはアームの衝突チェックに含まれる','Docked robot in the arm\'s collision check')}: <b data-testid="arm-scene-coverage" data-value="${scene===true}">${scene===true?tr('có','はい','yes'):scene===false?tr('không','いいえ','no'):tr('chưa rõ','不明','unknown')}</b></p>
${stop?.reason?`<p class="field-error" data-testid="arm-stop">${tr('Tay máy dừng','アーム停止','Arm stopped')}: <code>${esc(stop.reason)}</code>${stop.detail?` · ${esc(stop.detail)}`:''}</p>`:''}
${a.notes?.length?`<details><summary>${tr('Ghi chú của runtime (nguyên văn)','ランタイムの注記(原文)','The runtime\'s notes (verbatim)')}</summary><ul>${a.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></details>`:''}`;
 return `<div data-testid="arm-plant"><h3>${mujoco?tr('Tay máy là plant MuJoCo','MuJoCoアームプラント','MuJoCo arm plant'):tr('Tay máy là plant Webots','Webotsアームプラント','Webots arm plant')}</h3>
<p>${esc(a.armPlant.engine)}${a.armPlant.engineVersion?` ${esc(a.armPlant.engineVersion)}`:''} · ${esc(a.armPlant.control)} · ${tr('gắp','把持','grip')}: ${esc(a.armPlant.grip)} · ${tr('động lực học','動力学','dynamics')}: ${esc(a.armPlant.dynamics)} · <b data-testid="arm-calibration">${esc(a.armPlant.calibration)}</b></p>
<p>ARM03: <b>${esc(a.collision.result)}</b>${a.collision.reasonCodes.length?` · ${esc(a.collision.reasonCodes.join(', '))}`:''} · ${tr('vệt khớp','関節トレース','joint trace')} ${esc(a.trace.path)} · ${esc(a.trace.samples)} ${tr('mẫu','サンプル','samples')} · sha256 ${esc(a.trace.sha256.slice(0,12))}</p>
${table(tr('Lệch bám theo khớp','関節ごとの追従誤差','Tracking error per joint'),[tr('Khớp','関節','Joint'),tr('Lệch đỉnh','最大','Peak'),'RMS'],rows)}${cell}
<p class="source-note">${mujoco?tr('Mô phỏng MuJoCo: khối lượng, quán tính và giới hạn là giá trị danh định của nhà sản xuất; độ lợi, ma sát, tiếp xúc, đệm kẹp và bố trí trạm là giả định; chưa hiệu chuẩn (not_calibrated). Lệch bám đo độ bám của bộ truyền động mô phỏng với lệnh; gắp bằng tiếp xúc (contact) là của mô phỏng. Không điều nào ở đây nói tay máy, kẹp hay cốc thật hoạt động như vậy.','MuJoCoシミュレーション:質量・慣性・制限はメーカー公称値、ゲイン・摩擦・接触・パッド・セル配置は仮定、未校正(not_calibrated)。追従誤差は模擬アクチュエータが指令にどれだけ従ったか、接触(contact)による把持はシミュレーション内のもの。実機のアーム・グリッパー・カップがこう動くことは何も示しません。','MuJoCo simulation: masses, inertia and limits are manufacturer nominal values; gains, friction, contact, pads and the cell layout are assumed; not calibrated (not_calibrated). The tracking error is how closely the simulated actuators followed their commands; the grip by contact is the simulation\'s. Nothing here says a real arm, gripper or cup behaves this way.')
  :tr('Tham số giả định, chưa hiệu chuẩn (not_calibrated): lệch bám đo độ bám của servo mô phỏng với lệnh, không phải độ chính xác của cánh tay thật.','パラメータは仮定で未校正(not_calibrated)。追従誤差はシミュレーションのサーボが指令にどれだけ従ったかで、実機の精度ではありません。','Assumed, uncalibrated (not_calibrated) parameters: the tracking error is how closely the simulated servo followed its commands, not the accuracy of a real arm.')}</p></div>`;
}
