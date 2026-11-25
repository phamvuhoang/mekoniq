// One problems list for the twin page (D64): failing preflight items, run attention and a lost runtime link, each with a sentence, its
// reason codes and, when there is one, the object it is about. Notes (severity `notice`, such as an arm drawn as its joint chain) are listed in the same
// panel after the problems but are not problems: the run bar counts blockers and attention items only (problemCounts); with notes only its button is
// shown neutral and labelled as notes; the next-step strip ignores notes. The page's banner notices are separate and are not rows here.
// Pure: the counts and rows only explain, the runtime decides.
import type {RunView,TwinHealth} from '../scenarios/controls';
import type {preflight} from '../scenarios/preflight';
import type {LinkState} from '../runtime/stream';
import {explain,reconcilable} from '../twin/coffee-cell';
import type {NextAction} from './operations-panel';
import {nameOf,type TwinPreset} from '../scenarios/catalog';
import {icon,esc} from './icons';
import type {ArmMeshIssue} from '../viewer/twin3d';
import {tr} from '../i18n';
/** `entityName`: the object's display name (nameOf), shown on its button. */
export interface Problem {id:string;severity:'blocker'|'attention'|'notice';text:string;codes:string[];entityId?:string;entityName?:string;action?:{id:string;label:string}}
/** What the run bar counts: `problems` (blockers and attention items) and, apart, `notes`. */
export const problemCounts=(p:readonly Problem[])=>({problems:p.filter(x=>x.severity!=='notice').length,notes:p.filter(x=>x.severity==='notice').length});
const SEVERITIES:Problem['severity'][]=['blocker','attention','notice'];
const runtimeBox=()=>({id:'twin-runtime-toggle',label:tr('Mở hộp runtime','ランタイムを開く','Open runtime')});
/** Blockers, then attention; input order within each group. `preset` names the objects. */
export function collectProblems(i:{paired:boolean;health:TwinHealth|null;healthChecked:boolean;checks:ReturnType<typeof preflight>;view:RunView|null;linkState:LinkState;preset?:TwinPreset}):Problem[]{
 const p:Problem[]=[];
 // pairing stands between the user and a run only before one starts (no view, or a run still `ready`); a saved report or replay needs no runtime
 if(!i.paired&&(!i.view||i.view.run.status==='ready'))p.push(i.healthChecked&&!i.health
  ?{id:'runtime',severity:'blocker',text:tr('Không thấy runtime /lab/v2 trên máy này. Khởi động runtime rồi ghép nối.','このマシンで/lab/v2ランタイムが見つかりません。起動してからペアリングしてください。','No /lab/v2 runtime found on this machine. Start the runtime, then pair.'),codes:['RUNTIME_UNREACHABLE'],action:runtimeBox()}
  :{id:'runtime',severity:'blocker',text:tr('Chưa ghép nối runtime: nhập mã một lần in trong terminal của runtime.','ランタイム未ペアリング:ターミナルのワンタイムコードを入力してください。','The runtime is not paired: enter the one-time code printed by its terminal.'),codes:['NOT_PAIRED'],action:runtimeBox()});
 // paired (a session remembered) but not reached in this page load: not connected yet, which is not "cannot be reached"
 const notTried=i.paired&&!i.health&&!i.healthChecked&&(!i.view||i.view.run.status==='ready');
 if(notTried)p.push({id:'runtime',severity:'blocker',text:tr('Runtime chưa được kết nối trong lần mở trang này: bấm Kết nối trong hộp runtime.','このページではまだランタイムに接続していません。ランタイムの枠で「接続」を押してください。','The runtime is not connected yet in this page: press Connect in the runtime box.'),codes:['NOT_CONNECTED'],action:runtimeBox()});
 // the pairing (or not-connected) row stands for the items that need a paired runtime or its health answer; the rest are listed as they are
 const covered=(id:string)=>id==='paired'||(!i.paired||notTried)&&(id==='readiness'||!i.health&&id==='runtime')||!i.health&&['protocol','backend','scenario','readiness'].includes(id);
 for(const c of i.checks)if(!c.ok&&!covered(c.id))p.push({id:`check-${c.id}`,severity:'blocker',text:`${c.label}: ${c.detail}`,codes:c.codes??[],...c.entityId?{entityId:c.entityId,entityName:nameOf(i.preset,c.entityId)}:{}});
 if(['session_lost','run_lost','runtime_lost'].includes(i.linkState))p.push({id:'link',severity:'blocker',codes:[`LINK_${i.linkState.toUpperCase()}`],
  text:i.linkState==='session_lost'?tr('Runtime đã mất phiên; ghép nối lại.','ランタイムのセッションが失われました。再ペアリングしてください。','The runtime lost the session; pair again.'):i.linkState==='run_lost'?tr('Runtime không còn lần chạy này; báo cáo cuối vẫn xem được.','ランタイムにこの実行がありません。最後のレポートは閲覧できます。','The runtime no longer has this run; the last report stays viewable.'):tr('Mất kết nối tới runtime; không có mẫu mới.','ランタイムとの接続が失われました。新しいサンプルはありません。','The runtime connection is lost; no new samples arrive.'),
  ...i.linkState==='session_lost'?{action:runtimeBox()}:{}});
 const v=i.view;
 for(const [n,a] of (v?.attention??[]).entries()){const x=explain(a);
  p.push({id:`attention-${n}`,severity:'attention',text:`${x.observed} ${x.action}`,codes:[a.reason],...x.entities[0]?{entityId:x.entities[0],entityName:nameOf(i.preset,x.entities[0])}:{},...reconcilable(a,v!)?{action:{id:'twin-reconcile',label:tr('Đối soát','照合','Reconcile')}}:{}});}
 return SEVERITIES.flatMap(s=>p.filter(x=>x.severity===s));
}
/** Why the 3D view draws an arm as its joint chain instead of its meshes (D51): notices, listed after the problems; the run goes on. */
export function armMeshProblems(issues:readonly ArmMeshIssue[],preset?:TwinPreset):Problem[]{
 const short=(r?:string)=>(r??'?').slice(0,12);
 return issues.map(i=>({...i,detail:i.detail?.replace(/[0-9a-f]{64}/,short)})).map(i=>({id:`arm-mesh-${i.entityId}`,severity:'notice' as const,codes:[i.code],entityId:i.entityId,entityName:nameOf(preset,i.entityId),
  text:i.code==='ARM_MODEL_REVISION_MISMATCH'?tr(`Lab giữ mô hình tay máy bản ${short(i.lab)}, lần chạy báo bản ${short(i.run)}: 3D vẽ chuỗi khớp, không vẽ mesh.`,`Labのアームモデルは版 ${short(i.lab)}、実行の報告は版 ${short(i.run)} です。3Dはメッシュではなく関節チェーンで表示します。`,`The Lab holds arm model revision ${short(i.lab)}; the run reports revision ${short(i.run)}. The 3D view draws the joint chain, not the meshes.`)
   :tr(`Không dùng được mesh của tay máy (${i.detail??''}: ${({fetch:'không tải được file; thử lại khi mở lại khung 3D',hash:'sha256 của file khác tên của nó',parse:'file không đọc được',render:'không dựng được hình'} as const)[i.reason??'fetch']}): 3D vẽ chuỗi khớp. Lần chạy không bị ảnh hưởng.`,
    `アームのメッシュを使えません(${i.detail??''}:${({fetch:'ファイルを取得できません。3Dビューを開き直すと再試行します',hash:'ファイルのsha256が名前と一致しません',parse:'ファイルを読み取れません',render:'描画できません'} as const)[i.reason??'fetch']})。3Dは関節チェーンで表示します。実行には影響しません。`,
    `The arm meshes cannot be used (${i.detail??''}: ${({fetch:'a file could not be loaded; tried again when the 3D view is opened again',hash:'a file\'s sha256 differs from its name',parse:'a file could not be read',render:'they could not be drawn'} as const)[i.reason??'fetch']}). The 3D view draws the joint chain; the run is not affected.`)}));
}
const sevLabel=(s:Problem['severity'])=>({blocker:tr('Chặn','ブロック','Blocker'),attention:tr('Cần kiểm tra','要確認','Attention'),notice:tr('Lưu ý','注意','Notice')})[s];
/** A button to the problem's object: its display name, and the name in its accessible label. */
export const entityButton=(id:string,name:string,testid='')=>`<button class="text-button"${testid?` data-testid="${testid}"`:''} data-action="twin-select" data-value="${esc(id)}" aria-label="${tr('Xem','表示','Show')} ${esc(name)}">${icon('pin',14)}${esc(name)}</button>`;
/** The run bar's problems box. `chains` (problem id -> its attention chain) are drawn inside that problem's card, whose object buttons they carry. Closed or empty: hidden. */
export function problemsPanel(p:readonly Problem[],open:boolean,chains:Readonly<Record<string,string>>={}):string{
 // headed by what it holds: problems, notes, or both
 const n=problemCounts(p),head=n.problems&&n.notes?tr('Vấn đề và lưu ý','問題と注意','Problems and notes'):n.notes?tr('Lưu ý','注意','Notes'):tr('Vấn đề','問題','Problems');
 return `<div class="twin-popover twin-problems-box" id="twin-problems" data-testid="problems-panel" role="group" aria-label="${head}"${open&&p.length?'':' hidden'}><h3>${head}</h3><ol class="problem-list">${p.map(x=>`<li class="problem" data-testid="problem-row" data-severity="${x.severity}"><span class="problem-severity">${icon('cross',14)}${sevLabel(x.severity)}</span><span class="problem-text">${esc(x.text)}</span>${x.codes.length?`<span class="problem-codes">${x.codes.map(c=>`<code>${esc(c)}</code>`).join(' ')}</span>`:''}${chains[x.id]??''}<span class="problem-actions">${x.entityId&&!chains[x.id]?entityButton(x.entityId,x.entityName??x.entityId):''}${x.action?`<button class="text-button" data-action="${esc(x.action.id)}">${esc(x.action.label)}</button>`:''}</span></li>`).join('')}</ol></div>`;
}
/** The viewport strip: the recommended step when it needs a person, with the codes of the problem that step answers (the one whose action it is; none
 * otherwise, never another problem's). No button: its action is the run bar's primary action. */
export function nextStrip(p:readonly Problem[],next:NextAction):string{
 if(!next.action)return '';
 const codes=p.find(x=>x.severity!=='notice'&&x.action?.id===next.action!.id)?.codes??[];
 return `<div class="next-action" data-testid="next-action" role="status"><span class="eyebrow">${tr('BƯỚC TIẾP THEO','次の操作','NEXT ACTION')}</span><b>${esc(next.title)}</b>${codes.map(c=>`<code>${esc(c)}</code>`).join(' ')}<span>${esc(next.detail)}</span></div>`;
}
