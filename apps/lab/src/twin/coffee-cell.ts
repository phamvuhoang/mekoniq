// Coffee cell derivations: placement, cup location by owner, attention explanations and engineering rows. Pure, read-only.
import type {Attention,CupView,RunReport,RunView,Quantity} from '../scenarios/controls';
import type {LabProjectV2} from '../shared/types';
import {fmt,type Row} from './amr';
import {tr} from '../i18n';
import {stateLabel} from '../ui/labels';
type XY={x:number;y:number};
/** The project has no pose for cell entities: placement is derived from the coffee pickup point and labelled derived, never measured. */
export function cellLayout(project:LabProjectV2):{pickup:XY;machine:XY;arm:XY;cups:XY}|null {
 const p=project.world.points.find(x=>x.kind==='coffee_pickup');if(!p)return null;
 return {pickup:{x:p.x,y:p.y},machine:{x:p.x-0.55,y:p.y+0.8},arm:{x:p.x,y:p.y+0.7},cups:{x:p.x-1.05,y:p.y+0.8}};
}
/** Where the cup is drawn: at its owner. Unknown owner kinds return null (listed, not drawn), never a guessed spot. */
export function cupLocation(cup:CupView,project:LabProjectV2,view:RunView):XY|null {
 const l=cellLayout(project);
 if(cup.ownerKind==='cell')return l&&{x:l.machine.x+0.12,y:l.machine.y-0.2};
 if(cup.ownerKind==='arm')return l&&{x:l.arm.x,y:l.arm.y-0.3};
 if(cup.ownerKind==='robot'){const r=view.entities.find(e=>e.id===cup.ownerId);return r?{x:r.pose.x,y:r.pose.y}:null;}
 if(cup.ownerKind==='customer'){const t=project.world.points.find(p=>p.id===cup.ownerId);return t?{x:t.x+0.25,y:t.y}:null;}
 return null;
}
const FINAL=['delivered','quarantined','cancelled'];
/** The cup that matters now: the first whose job is not final, else the last one. */
export function currentCup(view:RunView|null):CupView|null {
 const c=view?.coffee;if(!c)return null;
 return c.cups.find(x=>!FINAL.includes(c.jobs.find(j=>j.cupId===x.cupId)?.status??''))??c.cups[c.cups.length-1]??null;
}
export const jobsOf=(view:RunView|null)=>view?.coffee?.jobs??[];
/** Waiting -> observed -> rule -> available action, for the reasons the mock cell and AMR raise. Unlisted codes still show the code. */
export function explain(a:Attention):{waiting:string;observed:string;rule:string;action:string;entities:string[]} {
 const s=a.subjectId??'',cup=s.startsWith('coffee-job-')?`cup-${s.slice(11)}`:'';
 const ents=[s,cup,a.robotId??''].filter(Boolean);
 const k:Record<string,[string,string,string,string]>={
  CUP_REMOVED:[tr(`Đang rót cho ${s}.`,`${s} を抽出中。`,`Dispensing for ${s}.`),tr('Cảm biến cốc báo không còn cốc dưới vòi.','カップセンサーがノズル下のカップ消失を報告。','The cup sensor reports no cup under the nozzle.'),tr('Không rót khi không có cốc; job chuyển “cần kiểm tra”, không tự rót lại.','カップなしでは抽出しない。ジョブは要確認となり自動再抽出しない。','No dispensing without a cup; the job needs attention and is never re-poured automatically.'),tr('Kiểm tra tại trạm, đối soát (loại bỏ cốc), rồi chạy lại.','現場確認後に照合(カップ破棄)し、再実行。','Check the station, reconcile (discard the cup), then run again.')],
  STEP_TIMEOUT:[tr(`Chờ thiết bị hoàn tất bước của ${s}.`,`${s} の工程完了待ち。`,`Waiting for ${s}'s step to finish.`),tr('Không có kết quả trong thời gian recipe cho phép.','レシピの制限時間内に結果なし。','No result within the recipe timeout.'),tr('Kết quả chưa rõ; không gửi lại lệnh.','結果不明。再送しない。','Outcome unknown; the command is not resent.'),tr('Đối soát với thiết bị.','機器と照合。','Reconcile with the device.')],
  STEP_UNKNOWN:[tr(`Chờ thiết bị xác nhận ${s}.`,`${s} の機器確認待ち。`,`Waiting for device confirmation of ${s}.`),tr('Thiết bị khởi động lại; lệnh đang chạy thành chưa rõ.','機器が再起動し実行中コマンドが不明に。','The device rebooted; the running command is unknown.'),tr('Không lặp tác động không thể đảo.','不可逆な動作を繰り返さない。','Irreversible actions are never repeated.'),tr('Đối soát với thiết bị.','機器と照合。','Reconcile with the device.')],
  STEP_FAILED:[tr(`Đang thực hiện bước của ${s}.`,`${s} の工程を実行中。`,`Running a step of ${s}.`),tr('Thiết bị báo thất bại (ví dụ kẹt đá, hết sữa).','機器が失敗を報告(氷詰まり、牛乳切れ等)。','The device reported failure (e.g. ice jam, milk empty).'),tr('Không tự thử lại.','自動再試行しない。','No automatic retry.'),tr('Khắc phục thiết bị rồi đối soát.','機器を復旧して照合。','Fix the device, then reconcile.')],
  MEASUREMENT_MISSING:[tr(`Chờ lượng đo của ${s}.`,`${s} の計量待ち。`,`Waiting for ${s}'s measurement.`),tr('Bước báo hoàn tất nhưng không có số đo.','完了報告に計量値なし。','The step completed without a measurement.'),tr('Không coi lệnh đã gửi là đủ lượng.','送信済みを規定量とみなさない。','A sent command is not taken as the right amount.'),tr('Đối soát.','照合。','Reconcile.')],
 };
 const e=k[a.reason];
 return e?{waiting:e[0],observed:e[1],rule:e[2],action:e[3],entities:ents}:{waiting:'—',observed:a.reason,rule:tr('Runtime giữ lần chạy ở trạng thái cần kiểm tra.','ランタイムが要確認で保持。','The runtime holds the run in attention.'),action:tr('Xem trace và đối soát nếu có thể.','トレースを確認し、可能なら照合。','Inspect the trace and reconcile when available.'),entities:ents};
}
/** Resolve only identities the view actually knows. Mission-level attention can name its robot separately. */
export function reconciliationSubject(a:Attention,view:RunView):string|null {
 if(view.controlAccess==='view')return null;// a terminal world refuses reconcile (WORLD_TERMINAL)
 if(view.run.mode==='simulation'&&view.run.status==='needs_attention')return view.run.id;
 const job=jobsOf(view).find(j=>j.jobId===a.subjectId);
 if(job)return job.status==='needs_attention'?job.jobId:null;
 const knownRobot=(id:string|undefined)=>id&&view.entities.some(r=>r.id===id)?id:null;
 const explicit=knownRobot(a.robotId)??knownRobot(a.subjectId);if(explicit)return explicit;
 const waiting=view.awaiting.find(stop=>stop.missionId===a.subjectId),mapped=knownRobot(waiting?.robotId);if(mapped)return mapped;
 return a.commandId?view.entities.find(r=>r.goal?.commandId===a.commandId)?.id??null:null;
}
export const reconcilable=(a:Attention,view:RunView)=>reconciliationSubject(a,view)!==null;
/** Canonical SI decimal string -> display unit (mL / g). Display only; the canonical value is shown alongside in the tooltip. */
export function qty(q:Quantity|null):{text:string;unit:string} {
 if(!q)return {text:'—',unit:''};
 const [f,unit]=q.unit==='m3'?[1e6,'mL']:q.unit==='kg'?[1e3,'g']:[1,q.unit],v=Number(q.amount)*f,tol=q.tolerance!==undefined?` ± ${fmt(Number(q.tolerance)*f,1)}`:'';
 return {text:`${fmt(v,1)}${tol}`,unit};
}
export function stepRows(report:RunReport|null,jobId:string|undefined):Row[] {
 const job=report?.coffee?.jobs.find(j=>j.jobId===jobId);if(!job)return [];
 return job.steps.map(s=>{const t=qty(s.target),m=qty(s.measured);
  return {key:`step-${s.id}`,label:`${stateLabel(s.kind)} · ${stateLabel(s.status)}`,observed:s.measured?`${m.text} (${s.measured.provenance})`:tr('chưa có số đo','計量なし','no measurement'),commanded:t.text,unit:t.unit||m.unit,source:s.measured?.provenance==='unknown'||!s.measured?'unknown':'observed',ageMs:null};});
}
export function cupSensorRow(view:RunView,jobId:string|undefined):Row {
 const j=jobsOf(view).find(x=>x.jobId===jobId),st=j?.status??'';
 const observed=j?.attentionReason==='CUP_REMOVED'?tr('không có cốc','カップなし','no cup'):st==='reserved'?tr('chưa xác nhận','未確認','not yet confirmed'):['cup_verified','started','dispensing','verifying','ready_for_pickup'].includes(st)?tr('có cốc','カップあり','cup present'):'—';
 return {key:'cup-sensor',label:tr('Cảm biến cốc','カップセンサー','Cup sensor'),observed,commanded:'—',unit:'',source:observed==='—'?'unknown':'derived',ageMs:null};
}
export function armRows(report:RunReport|null,tick:number):Row[] {
 const t=report?.coffee?.armTrace,s=t?.samples.filter(s=>s.tick<=tick).at(-1),age=s&&report?(tick-s.tick)*report.manifest.clock.tickMs:null;
 const rows:Row[]=Array.from({length:6},(_,i)=>({key:`joint-${i+1}`,label:`q${i+1}`,observed:tr('không có encoder (mock)','エンコーダなし(モック)','no encoder (mock)'),commanded:s?`${fmt(s.q[i]!,3)} (${fmt(s.q[i]!*180/Math.PI,1)}°)`:tr('chưa có mẫu','サンプルなし','no sample yet'),unit:'rad',source:s?'commanded':'unknown',ageMs:age}));
 if(s)rows.push({key:'tcp',label:'TCP x, y, z',observed:'—',commanded:s.tcp.map(v=>fmt(v,3)).join(', '),unit:'m',source:'modeled',ageMs:age});
 rows.push({key:'limits',label:tr('Giới hạn khớp','関節リミット','Joint limits'),observed:'—',commanded:t?(t.limitsOk?tr('trong giới hạn','範囲内','within limits'):tr('vượt giới hạn','超過','exceeded')):'—',unit:'',source:t?'modeled':'unknown',ageMs:null});
 const collision=t?.collision,scene=collision?.scene,atCursor=scene&&scene.tick<=tick;
 rows.push({key:'arm-scene',label:tr('Phạm vi va chạm mô hình','モデル衝突の範囲','Modeled collision scope'),observed:atCursor?
  `${scene.available?tr('vật cản dự án + robot','プロジェクト障害物 + ロボット','project fixtures + robots'):scene.scope==='self_injected_only'?tr('tự va chạm + vật cản chèn','自己衝突 + 挿入障害物','self + injected obstacles'):scene.reason??'unavailable'} · ${tr('minh họa','参考モデル','illustrative')} · rev ${scene.profileRevision??'—'} · ${scene.revision.slice(0,8)}`:
  tr('chưa có bằng chứng tại thời điểm này','この時点の証拠なし','no evidence at this cursor'),commanded:'—',unit:'',source:atCursor&&scene.available?'modeled':'unknown',ageMs:null});
 const projected=collision?.evidence?.projection,checkAt=projected?.lastCheckTick,recordedCheck=checkAt!==undefined&&checkAt!==null&&checkAt<=tick;
 if((atCursor||recordedCheck)&&collision?.last)rows.push({key:'arm-checker',label:tr('Bộ kiểm hình học','形状チェッカー','Geometry checker'),observed:`${collision.last.engine} · ${collision.last.geometryRevision.slice(0,8)} · ${collision.last.ok?tr('không chặn','ブロックなし','clear'):tr('đã chặn','ブロック済み','blocked')}${collision.last.pair?` · ${collision.last.pair.join(' ↔ ')}`:''}`,commanded:'—',unit:'',source:'modeled',ageMs:null});
 if(projected&&!projected.historyComplete)rows.push({key:'arm-trace',label:tr('Lịch sử kiểm hình học','形状チェック履歴','Geometry check history'),observed:tr('lịch sử lưu không đầy đủ','保存履歴が不完全','retained history incomplete'),commanded:projected.reason??'—',unit:'',source:'unknown',ageMs:null});
 return rows;
}
export function cupRows(cup:CupView,report:RunReport|null,ownerName:string,ageMs:number|null):Row[] {
 const moves=report?.coffee?.cups.find(c=>c.cupId===cup.cupId)?.movements??[],last=moves[moves.length-1];
 return [
  {key:'cup-owner',label:tr('Chủ sở hữu','所有者','Owner'),observed:`${ownerName} (${stateLabel(cup.ownerKind)})`,commanded:'—',unit:'',source:'observed',ageMs},
  {key:'cup-moves',label:tr('Lần chuyển','移動回数','Transfers'),observed:String(moves.length),commanded:'—',unit:'',source:report?'observed':'unknown',ageMs:null},
  {key:'cup-last',label:tr('Bằng chứng gần nhất','直近の根拠','Latest evidence'),observed:last?`${last.provenance} · ${last.observedBy}`:'—',commanded:'—',unit:'',source:last?'observed':'unknown',ageMs:null},
 ];
}
