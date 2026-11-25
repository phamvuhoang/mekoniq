// Inspector model for the selected entity: values with unit, source (observed / commanded / modeled / derived / unknown) and age. Pure.
import {amrRows,runtimeResolved,type Row} from './amr';
import {isMobilePreset} from './payload';
import {armRows,cupRows,cupSensorRow,jobsOf,stepRows} from './coffee-cell';
import {armJointsView} from './arm/arm-telemetry';
import {arm03Rows,armTelemetryRows} from './arm/arm-view';
import {sceneEntities,kindLabel,type TwinFrame} from './scene';
import {nameOf} from '../scenarios/catalog';
import {tr} from '../i18n';
import {driveRows} from '../reports/control';
import {stateLabel} from '../ui/labels';
import type {RunReport,RunView,AmrView} from '../scenarios/controls';
/** Locked-run identity, only from what the runtime reported (snapshot + report manifest/jobs); a value it has not reported shows '?'.
 * A mock-only run reads as before (`model <tag>`). A run with any other backend names each backend's own model, and the run-level tag only as what it is:
 * the scenario runner's tag for the mock parts (or of the run, without mock parts), never as the model of the run. */
export function identityItems(v:RunView,report:RunReport|null):string[] {
 const r=v.run,m=report?.manifest,ids=m?.backends.map(b=>b.id)??r.backends,mockOnly=ids.every(id=>id.startsWith('mock_'));
 const recipes=[...new Set((report?.coffee?.jobs??[]).map(j=>`${j.recipeId} r${j.recipeRevision}`))];
 const backends=(m?.backends??r.backends.map(id=>({id,version:'?',model:''}))).map(b=>`${b.id}@${b.version}${!mockOnly&&b.model?` · ${b.model}`:''}`).join(', ');
 const tag=mockOnly?`model ${v.model}`:`${ids.some(id=>id.startsWith('mock_'))?tr('thẻ mô hình của phần mock','モック部分のモデルタグ','model tag of the mock parts'):tr('thẻ mô hình của lần chạy','実行のモデルタグ','model tag of the run')}: ${v.model}`;
 return [r.backendSetId,backends,tag,`${r.scenarioId} r${r.scenarioRevision}`,`seed ${r.seed}`,
  `project ${m?`${m.project.id} r${m.project.revision}`:'?'}`,`world ${m?`r${m.world.revision}`:'?'}`,...(v.coffee?[`recipe ${recipes.length?recipes.join(' / '):'?'}`]:[]),`source ${r.sourceCommit.slice(0,7)}`];
}
export interface Inspection {id:string;title:string;kind:string;source:string;rows:Row[];note:string}
/** `seen`: tick at which the Lab first saw an entity's current value (owner etc.), for an age that is honest about polling. */
export function inspect(f:TwinFrame,entityId:string|null,seen:Record<string,number>={}):Inspection|null {
 const e=sceneEntities(f).find(x=>x.id===entityId);if(!e)return null;
 const v=f.view,report=f.report,tick=v?.tick??0,tickMs=report?.manifest.clock.tickMs??20;
 const base={id:e.id,title:`${e.name}`,kind:kindLabel(e.kind),source:e.source};
 const noRun=tr('Chưa có lần chạy: chỉ có dữ liệu mô hình của preset.','未実行:プリセットのモデル値のみ。','No run yet: preset model data only.');
 if(e.kind==='payload'&&e.payload){const q=e.payload,s=f.samples?.[e.id];return {...base,rows:[{key:'payload-quality',label:tr('Chất lượng quan sát','観測品質','Observation quality'),observed:`${s?.quality??'unknown'} · ${(s?.reasonCodes??[]).join(', ')}`,commanded:'—',unit:'',source:s?.quality==='valid'?'observed' as const:'unknown' as const,ageMs:null},{key:'payload-position',label:tr('Vị trí map','map位置','Map position'),observed:q.positionM.map(v=>v.toFixed(4)).join(', '),commanded:'—',unit:'m',source:'observed' as const,ageMs:null},{key:'payload-geometry',label:tr('Hình học cốc','カップ形状','Cup geometry'),observed:`r ${q.geometry.radiusM} · h ${q.geometry.heightM}`,commanded:'—',unit:'m',source:'derived' as const,ageMs:null},{key:'payload-reference',label:tr('Khung tham chiếu','参照座標系','Declared reference'),observed:q.supportId,commanded:'—',unit:'',source:'observed' as const,ageMs:null}],note:`MuJoCo · not_calibrated · ground_truth · ${tr('Khung dây chỉ quan sát cũ; hình học vẫn là mô hình đã tiếp nhận.','ワイヤーフレームは古い観測を示します。形状は受け入れ済みモデルです。','Wireframe marks a stale observation; geometry remains the admitted model.')} · ${q.loadProfileSha256} · ${tr('Tải tự do, không phải chuyển giao cốc đã xác nhận.','自由荷物。確認済みカップ受渡ではありません。','Free load; no confirmed cup custody.')}`};}
 if(e.kind==='amr'){const a=v?.entities.filter((r):r is AmrView=>r.kind==='amr').find(r=>r.id===e.id);return {...base,rows:a?[...amrRows(a,a.sampleAgeMs??v!.run.ageMs,runtimeResolved(report,f.preset.project,e.id)),...driveRows(report,e.id,tick)].map(row=>isMobilePreset(f.preset.id)&&row.key==='lidar'?{...row,observed:tr('Luồng quét không khả dụng trong khung nhìn này','この表示ではスキャンストリームを利用できません','Scan stream unavailable in this view'),source:'unknown' as const}:row):[],note:a&&isMobilePreset(f.preset.id)?'MuJoCo · physics_sim · not_calibrated · localization: ground_truth':a?tr('Pose quan sát từ backend mock (mô hình động học), không phải cảm biến.','姿勢はモック(運動学モデル)の観測でセンサーではありません。','Pose is observed from the mock backend (kinematic model), not a sensor.'):noRun};}
 if(e.kind==='arm'){
  const sample=f.samples?.[e.id],live=sample?armJointsView(sample,f.nowMs??sample.receivedAtMs):null;
  // which arm this is: the live sample's provider, else the report's plant (a MuJoCo run without a sample yet is never described as the mock)
  const engine=report?.arm?.armPlant.engine,plant=live?.providerId==='mujoco_arm'||!live&&engine==='mujoco_3d'?'mujoco':live?.providerId==='webots_arm'||!live&&engine==='webots_3d'?'webots':null;
  // telemetry rows first (actual/commanded apart, provenance and age), then the report's commanded trace, then ARM03 from recorded checker evidence
  return {...base,rows:v?[...armTelemetryRows(live),...armRows(report,tick).filter(r=>!live||!r.key.startsWith('joint-')),...arm03Rows(report,tick),...driveRows(report,e.id,tick)]:[],note:plant==='mujoco'?tr('Khớp thực là vị trí MuJoCo báo (cột Quan sát), khớp lệnh là của chương trình tay máy (cột Lệnh); kẹp G2 gắp bằng tiếp xúc trong mô phỏng, không có cảm biến kẹp hay lực đo. Mô phỏng với khối lượng và giới hạn danh định của nhà sản xuất, tham số khác giả định, chưa hiệu chuẩn (not_calibrated).','実測関節はMuJoCoの報告位置(観測列)、指令関節はアームプログラム(指令列)。グリッパーG2はシミュレーション内の接触で把持し、把持センサや実測の力はありません。質量と制限はメーカー公称値、他のパラメータは仮定で未校正(not_calibrated)のシミュレーション。','Actual joints are the positions MuJoCo reported (Observed column), commanded joints come from the arm program (Commanded column); the G2 gripper grips by contact inside the simulation, with no gripper sensor or measured force. Simulation with manufacturer nominal masses and limits, other parameters assumed, not calibrated (not_calibrated).'):plant==='webots'?tr('Khớp thực là vị trí Webots R2025a báo (cột Quan sát), khớp lệnh là của máy trạng thái chương trình (cột Lệnh); gắp là sự kiện, không có cảm biến kẹp hay lực. Tham số giả định, chưa hiệu chuẩn.','実測関節はWebots R2025aの報告位置(観測列)、指令関節はプログラム状態機械(指令列)。把持はイベントで、把持センサ・力なし。パラメータは仮定で未校正。','Actual joints are the positions Webots R2025a reported (Observed column), commanded joints come from the program state machine (Commanded column); gripping is an event, with no gripper sensor or force. Assumed, uncalibrated parameters.'):live?.provenance==='controller_sim'?tr('Khớp thực tế từ controller mô phỏng (LinuxCNC sim); không có cảm biến kẹp hay lực.','関節実測は模擬コントローラ(LinuxCNC sim)から。把持センサ・力なし。','Actual joints from the simulated controller (LinuxCNC sim); no gripper sensor or force.'):tr('Góc khớp là quỹ đạo lệnh của mock_kinematic; không có encoder hay lực kẹp.','関節角はmock_kinematicの指令軌道。エンコーダ・把持力なし。','Joint angles are the mock_kinematic commanded trace; no encoder or grip force.')};
 }
 const job=e.kind==='job'?e.id:jobsOf(v).find(j=>!['delivered','quarantined','cancelled'].includes(j.status))?.jobId??jobsOf(v).at(-1)?.jobId;
 if(e.kind==='coffee_machine'||e.kind==='job'){
  const j=jobsOf(v).find(x=>x.jobId===job);
  const head=j?[{key:'job-status',label:`Job ${j.jobId}`,observed:`${stateLabel(j.status)}${j.attentionReason?` · ${j.attentionReason}`:''}`,commanded:`${j.recipeId}`,unit:'',source:'observed' as const,ageMs:null}]:[];
  return {...base,rows:v?[...head,...stepRows(report,job),cupSensorRow(v,job)]:[],note:v?tr('Lượng đo của mock_process là mô hình, không phải phép đo máy pha.','mock_processの計量はモデルで、実測ではありません。','mock_process amounts are modelled, not a machine measurement.'):noRun};
 }
 if(e.kind==='cup'){
  const c=v!.coffee!.cups.find(x=>x.cupId===e.id)!,since=seen[`${c.cupId}:${c.ownerKind}:${c.ownerId}`];
  return {...base,rows:cupRows(c,report,nameOf(f.preset,c.ownerId),since===undefined?null:(tick-since)*tickMs),note:tr('Chủ sở hữu đổi chỉ khi chuyển giao được xác nhận. Tuổi tính từ lần Lab thấy giá trị này (≤ chu kỳ đọc).','所有者は確認済みの受渡でのみ変わります。経過は最初に観測した時点から(読取周期以内)。','Owner changes only on a confirmed transfer. Age counts from when the Lab first saw this value (within one read).')};
 }
 return {...base,rows:[],note:tr('Vị trí suy ra; không có telemetry cho đối tượng này.','推定配置。この対象のテレメトリなし。','Derived placement; no telemetry for this object.')};
}
