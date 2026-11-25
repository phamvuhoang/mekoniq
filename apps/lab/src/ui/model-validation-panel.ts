// Model validation (LinkForge shadow) on the Assembly page: run it for one robot of the compiled bundle, show what ran and what did not, and trace every
// issue to the assembly item that owns its graph id. A result belongs to one bundle/project digest: after any edit it is stale, never "still valid".
// Shadow status never blocks saving or exporting a draft.
import type {EngineeringProject,EngineeringRef} from '../shared/engineering';
import type {ModelValidationReportV1} from '../shared/navigation2d';
import {tr} from '../i18n';
import {esc} from './icons';
export interface ValidationState {ref:EngineeringRef;robotId:string;report:ModelValidationReportV1}
type Issue=ModelValidationReportV1['issues'][number];
export interface IssueTarget {kind:'instance'|'entity';id:string;graphId:string|null}
/** Graph ids are `<instanceId>/<local id>`: the first segment names the assembly instance when the design has it; otherwise the issue stays on its entity. */
export function issueTarget(issue:Issue,project:EngineeringProject):IssueTarget{
 const graphId=issue.linkId??issue.jointId??null,instance=graphId?.split('/')[0];
 return instance&&graphId!.includes('/')&&project.assembly.instances.some(i=>i.id===instance)?{kind:'instance',id:instance,graphId}:{kind:'entity',id:issue.entityId,graphId};
}
export interface ValidationView {state:'none'|'stale'|'current';tone:'ok'|'fail'|'blocked';label:'pass'|'fail'|'not_run'|'inconclusive'|'failed';issues:(Issue&{target:IssueTarget})[]}
/** pass only for execution ran + result pass; stale when the design digest or the compiled bundle is no longer the one validated. */
export function validationView(v:ValidationState|null,current:{projectDigest:string;ref:EngineeringRef|null},project:EngineeringProject):ValidationView{
 if(!v)return {state:'none',tone:'blocked',label:'not_run',issues:[]};
 const r=v.report,stale=v.ref.projectDigest!==current.projectDigest||!current.ref||current.ref.bundleDigest!==v.ref.bundleDigest||current.ref.projectDigest!==v.ref.projectDigest;
 const label=r.execution==='ran'?r.result:r.execution,tone=label==='pass'?'ok':label==='fail'?'fail':'blocked';
 return {state:stale?'stale':'current',tone,label,issues:r.issues.map(i=>({...i,target:issueTarget(i,project)}))};
}
const resultText=(l:ValidationView['label'])=>({pass:tr('Đạt','合格','Pass'),fail:tr('Không đạt','不合格','Fail'),not_run:tr('Chưa chạy','未実行','Not run'),inconclusive:tr('Chưa kết luận','判定不能','Inconclusive'),failed:tr('Worker lỗi','ワーカー失敗','Worker failed')})[l];
export function modelValidationPanel(o:{v:ValidationState|null;view:ValidationView;robots:string[];canValidate:boolean;busy:boolean;error:string}):string{
 const r=o.v?.report,view=o.view;
 const buttons=o.robots.map(id=>`<button class="button secondary" data-action="asm-validate" data-value="${esc(id)}" ${o.canValidate&&!o.busy?'':'disabled'}>${tr('Kiểm tra mô hình','モデル検証','Validate model')} · ${esc(id)}</button>`).join(' ');
 const head=`<p class="field-help">${tr('Kiểm tra bóng (shadow) bằng LinkForge trên runtime: không sửa mô hình, không chặn lưu bản nháp; không phải chứng nhận tải, ổn định hay an toàn.','ランタイム上のLinkForgeシャドー検証。モデルは変更せず、下書き保存を妨げません。荷重・安定性・安全の証明ではありません。','LinkForge shadow check on the runtime: it never edits the model or blocks saving the draft; it is not a load, stability or safety proof.')}</p>`;
 const body=!r?`<p data-testid="model-validation" data-state="none">${o.canValidate?tr('Chưa kiểm tra bundle này.','このバンドルは未検証です。','This bundle has not been validated yet.'):tr('Compile thành công trên runtime trước khi kiểm tra.','検証の前にランタイムでコンパイルしてください。','Compile on the runtime before validating.')}</p>`
  :`<div data-testid="model-validation" data-state="${esc(view.state)}" data-tone="${esc(view.tone)}">
<p><span class="chip ${view.state==='stale'?'warn':view.tone==='ok'?'':'warn'}">${view.state==='stale'?tr('đã cũ: thiết kế đã đổi, chạy lại kiểm tra','古い: 設計変更済み、再検証が必要','stale: the design changed, validate again'):esc(resultText(view.label)??view.label)}</span> ${esc(r.robotId)} · ${tr('báo cáo','レポート','report')} <code data-testid="validation-digest">${esc(r.reportDigest.slice(0,12))}</code> · ${r.engine?`${esc(r.engine.package)} ${esc(r.engine.packageVersion)} · Python ${esc(r.engine.pythonVersion)}`:tr('không có engine','エンジンなし','no engine')} · ${tr('chế độ','モード','mode')} ${esc(r.mode)}</p>
<table class="eng-table"><caption class="visually-hidden">${tr('Các bước kiểm tra','検査項目','Checks')}</caption><thead><tr><th scope="col">${tr('Kiểm tra','検査','Check')}</th><th scope="col">${tr('Nguồn','出典','Source')}</th><th scope="col">${tr('Kết quả','結果','Result')}</th><th scope="col">${tr('Phạm vi','範囲','Scope')}</th></tr></thead><tbody>${r.checks.map(c=>`<tr data-check="${esc(c.id)}"><th scope="row">${esc(c.id)}</th><td>${esc(c.source)}</td><td><span class="state-text">${esc(c.result)}</span></td><td>${esc(c.coverageScope)}</td></tr>`).join('')}</tbody></table>
<h4>${tr('Vấn đề theo linh kiện / link / khớp','部品・リンク・関節ごとの問題','Issues by part / link / joint')} (${esc(r.issues.length)})</h4>
<ul class="asm-problems" data-testid="validation-issues">${view.issues.map(i=>`<li data-code="${esc(i.code)}" data-severity="${esc(i.severity)}" data-target="${esc(i.target.id)}"><b>${esc(i.code)}</b> <span class="state-text">${esc(i.severity)}</span> ${i.target.kind==='instance'?tr('linh kiện','部品','part'):tr('thực thể','エンティティ','entity')} <code>${esc(i.target.id)}</code>${i.target.graphId?` · <code>${esc(i.target.graphId)}</code>`:''} · ${esc(i.source)} · <code>${esc(i.path)}</code> ${esc(i.detail)}</li>`).join('')||`<li>${tr('Không có vấn đề được báo.','報告された問題はありません。','No issues reported.')}</li>`}</ul>
<p class="field-help">${tr('Giả định (nguồn chưa đo)','仮定(未計測の出典)','Assumptions (unmeasured sources)')}: ${r.assumptions.map(a=>`<span class="chip">${esc(a.kind)}</span> ${esc(a.documentId)}`).join(' ')||'—'} · ${tr('Giới hạn','制限','Limitations')}: ${r.limitations.map(esc).join('; ')||'—'}</p></div>`;
 return `<section data-testid="model-validation-panel"><h3>${tr('Kiểm tra mô hình','モデル検証','Model validation')}</h3>${head}<div class="asm-toolbar">${buttons}${o.busy?` <span role="status">${tr('đang kiểm tra…','検証中…','validating…')}</span>`:''}</div>${o.error?`<p role="status" data-testid="validation-error">${esc(o.error)}</p>`:''}${body}</section>`;
}
