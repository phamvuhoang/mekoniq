// The two static samples (R5.5), shown without any runtime after their bytes are read back. A mismatch shows the file names and nothing of the sample.
import type {StopReportV1} from '../shared/navigation2d';
import {stopRows} from '../reports/stop';
import {electricalPanel} from './electrical-panel';
import {electricalView,ELECTRICAL_CAPABILITY} from '../design/electrical';
import type {HardwareSample,SampleEntry} from '../reports/samples';
import {tr} from '../i18n';
import {esc} from './icons';

export interface SamplesState {entries:SampleEntry[]|null;error:string;open:SampleEntry['id']|null;verify:{ok:boolean;mismatched:string[]}|null;hardware:HardwareSample|null;stop:StopReportV1[]|null}
const fmt=(n:number|null,unit:string)=>n===null?`<span class="unknown-text">${tr('không có dữ liệu','データなし','no data')}</span>`:`${+n.toFixed(3)} ${unit}`;
export function stopSampleHtml(reports:readonly StopReportV1[]):string{
 const rows=stopRows(reports);
 return `<table data-testid="sample-stop-table"><thead><tr><th>${tr('Kiểu dừng','停止の種類','Stop')}</th><th>${tr('Quãng đường','停止距離','Distance')}</th><th>${tr('Thời gian','時間','Time')}</th><th>${tr('Giảm tốc đỉnh','最大減速','Peak decel')}</th><th>${tr('Trượt cốc','カップ滑り','Cup slip')}</th><th>${tr('Đổ cốc','転倒','Tipped')}</th></tr></thead><tbody>${rows.map(r=>`<tr data-function="${r.function}"><td>${r.function}${r.function==='emergency'&&r.onDisable?` · ${esc(r.onDisable)}`:''}</td><td>${fmt(r.distanceM,'m')}${r.why?` <small>${esc(r.why)}</small>`:''}</td><td>${fmt(r.timeMs,'ms')}</td><td>${fmt(r.peakDecelMps2,'m/s²')}</td><td>${fmt(r.cupSlipMm,'mm')}</td><td>${r.cupTipped===null?'—':r.cupTipped?tr('có','あり','yes'):tr('không','なし','no')}</td></tr>`).join('')}</tbody></table>
<p data-testid="sample-calibration"><b>not_calibrated</b> · accepted: false</p><ul>${[...new Set(reports.flatMap(r=>r.limits))].map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`;
}
export function samplesPanel(s:SamplesState):string{
 const names:Record<string,string>={'hardware-candidate':tr('Gói ứng viên phần cứng','ハードウェア候補パッケージ','Hardware candidate package'),'stop-report':tr('Báo cáo dừng','停止レポート','Stop report')};
 const buttons=(s.entries??[]).map(e=>`<button class="button ${s.open===e.id?'primary':'quiet'}" data-action="el-sample" data-value="${e.id}" aria-pressed="${s.open===e.id}">${names[e.id]}</button>`).join('');
 let body='';
 if(s.open&&s.verify&&!s.verify.ok)body=`<p role="alert" data-testid="sample-verify" data-ok="false">${tr('Mẫu không khớp checksum, không hiển thị:','サンプルがチェックサム不一致のため表示しません:','The sample does not match its checksum and is not shown:')} <code>${s.verify.mismatched.map(esc).join(', ')}</code></p>`;
 else if(s.open&&s.verify){
  const ok=`<p data-testid="sample-verify" data-ok="true"><small>${tr('Đã đọc lại từng byte và khớp checksum.','全バイトを読み戻しチェックサム一致。','Every byte read back and matched.')}</small></p>`;
  if(s.open==='hardware-candidate'&&s.hardware){const h=s.hardware;body=ok+`<p data-testid="sample-readiness">${h.manifest.status} · hardwareValidated: ${h.manifest.hardwareValidated} · controlAuthority: ${h.manifest.controlAuthority}</p>`+
   electricalPanel({view:electricalView({capabilities:[ELECTRICAL_CAPABILITY],bundle:h.bundle,design:h.design,rejection:null,busy:false,profiles:h.profiles}),options:[],optionId:h.design.id,bundle:h.bundle,design:h.design,filter:'all',selectedWire:null,compare:null,compareError:'',busy:false,packaging:false,readOnly:true})+
   `<h4>${tr('Danh sách kiểm','チェックリスト','Checklist')}</h4><pre data-testid="sample-checklist">${esc(h.checklist)}</pre><ul>${h.manifest.readiness.map(r=>`<li data-readiness="${esc(r.id)}">${esc(r.id)}: ${esc(r.status)}</li>`).join('')}</ul>`;}
  else if(s.open==='stop-report'&&s.stop)body=ok+stopSampleHtml(s.stop);
 }
 return `<section class="panel samples" data-testid="samples" aria-labelledby="samples-title"><h3 id="samples-title">${tr('Mẫu có sẵn (không cần runtime)','同梱サンプル(ランタイム不要)','Shipped samples (no runtime needed)')}</h3>
${s.error?`<p role="status" data-testid="samples-error"><code>${esc(s.error)}</code></p>`:''}<p>${buttons}</p>${body}</section>`;
}
