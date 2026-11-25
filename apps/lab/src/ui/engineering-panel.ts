// Engineering view of the selected entity: one block per quantity (observed, commanded, then unit, source and age). Plus the runtime link detail and test faults.
import type {Inspection} from '../twin/inspector';
import type {Source} from '../twin/amr';
import {icon,esc} from './icons';
import {tr} from '../i18n';
const sourceText=(s:Source|string)=>({observed:tr('quan sát','観測','observed'),commanded:tr('lệnh','指令','commanded'),modeled:tr('mô hình','モデル','modeled'),derived:tr('suy ra','推定','derived'),unknown:tr('chưa rõ','不明','unknown')})[s]??esc(s);
const age=(ms:number|null)=>ms===null?`<span class="unknown-text">${tr('chưa rõ','不明','unknown')}</span>`:`${Math.max(0,Math.round(ms))} ms`;
/** Faults the mock backends accept; ids are runtime contract values, labels are localized. */
export const FAULTS:[string,()=>string][]=[
 ['cup-removed',()=>tr('Rút cốc khỏi vòi','ノズルからカップを外す','Remove cup from nozzle')],['ice-jam',()=>tr('Kẹt đá','氷詰まり','Ice jam')],['milk-empty',()=>tr('Hết sữa','牛乳切れ','Milk empty')],
 ['measure-missing',()=>tr('Mất số đo','計量欠落','Measurement missing')],['coffee-reboot',()=>tr('Khởi động lại máy pha','マシン再起動','Coffee machine reboot')],['arm-reboot',()=>tr('Khởi động lại arm','アーム再起動','Arm reboot')],
 ['collide',()=>tr('Va chạm AMR (mô phỏng)','AMR衝突(模擬)','AMR collision (simulated)')],['reboot',()=>tr('Khởi động lại AMR','AMR再起動','AMR reboot')],
];
export function engineeringInspection(insp:Inspection|null):string {
 const rows=insp?.rows??[];
 const table=insp?`<div class="inspector-head"><span class="eyebrow">${esc(insp.kind)} · ${sourceText(insp.source)}</span><h3 data-testid="inspector-title">${esc(insp.title)}${insp.title!==insp.id?` <small>${esc(insp.id)}</small>`:''}</h3></div>
${rows.length?`<ul class="eng-list" aria-label="${tr('Giá trị kỹ thuật của','技術値:','Engineering values for')} ${esc(insp.title)}">${rows.map(r=>`<li class="eng-row" data-testid="eng-${esc(r.key)}"><b><span class="visually-hidden">${tr('Đại lượng','項目','Quantity')}: </span>${esc(r.label)}</b><dl><div><dt>${tr('Quan sát','観測','Observed')}</dt><dd>${esc(r.observed)}</dd></div><div><dt>${tr('Lệnh','指令','Commanded')}</dt><dd>${esc(r.commanded)}</dd></div></dl><p class="eng-meta"><span><small>${tr('Đơn vị','単位','Unit')}</small> ${esc(r.unit)||'—'}</span><span><small>${tr('Nguồn','出典','Source')}</small> <span class="source-tag ${esc(r.source)}">${sourceText(r.source)}</span></span><span><small>${tr('Tuổi dữ liệu','データ経過','Data age')}</small> ${age(r.ageMs)}</span></p></li>`).join('')}</ul>`:''}<p class="field-help">${esc(insp.note)}</p>`
  :`<p class="empty-inline">${tr('Chọn một đối tượng trong cảnh hoặc danh sách để xem chi tiết.','シーンまたは一覧から対象を選択。','Select an object in the scene or list to inspect it.')}</p>`;
 return table;
}
/** The runtime link detail (transport, sample, age, reason, gaps): repainted in place every 100 ms as #twin-telemetry (`state`: the sample's freshness). */
export const telemetryLine=(text:string,state:string)=>`<p class="twin-telemetry-line"><small>${tr('Liên kết runtime','ランタイム接続','Runtime link')}</small> <span class="twin-telemetry" id="twin-telemetry" data-testid="twin-telemetry" data-state="${esc(state)}" aria-live="off">${esc(text)}</span></p>`;
export function engineeringPanel(insp:Inspection|null,o:{hasRun:boolean;busy:boolean;fault:string;coffee:boolean}):string {
 const faults=o.hasRun?`<div class="fault-actions"><label for="twin-fault">${tr('Chèn lỗi thử nghiệm (mock)','テスト障害を注入(モック)','Inject test fault (mock)')}</label><select id="twin-fault">${FAULTS.filter(([id])=>o.coffee||['collide','reboot'].includes(id)).map(([id,l])=>`<option value="${id}" ${o.fault===id?'selected':''}>${l()} · ${id}</option>`).join('')}</select><button class="button quiet" data-action="twin-fault" ${o.busy?'disabled':''}>${icon('bolt',16)}${tr('Chèn lỗi','注入','Inject')}</button></div>`:'';
 return `<section class="panel eng-panel" data-testid="engineering-panel" aria-labelledby="eng-title"><div class="panel-heading"><h2 id="eng-title">${tr('Kỹ thuật','エンジニアリング','Engineering')}</h2><span class="pill">${tr('Kỹ sư','エンジニア','Engineer')}</span></div><div id="twin-inspector">${engineeringInspection(insp)}</div>${faults}</section>`;
}
