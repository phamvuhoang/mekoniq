// The fault schedule drawn by layer (R4-A §7.3): four lanes on the simulated clock, and the same entries as a text list. The list is the accessible equivalent and what a narrow screen shows instead of the plot.
import {tr} from '../i18n';
import {esc} from './icons';
import {DRIVE_FAULT_LAYERS,type DriveFaultEntry,type FaultCatalog} from '../scenarios/drive-faults';
export const layerName=(l:string)=>({command:tr('Kênh lệnh','指令チャネル','Command channel'),drive:tr('Drive','ドライブ','Drive'),feedback:tr('Phản hồi','帰還','Feedback'),sensor:tr('Cảm biến','センサ','Sensor')} as Record<string,string>)[l]??l;
const LANE_H=16,PAD=2,MIN_W=3,fmt=(n:number)=>n.toFixed(3);
const paramsText=(p:Record<string,number>)=>Object.entries(p).map(([k,v])=>`${k} ${v}`).join(', ');
/** SVG lanes plus the text equivalent. `horizonMs` is the extent of the plot; an entry that starts at or after it is listed and flagged, never drawn off the plot. */
export function faultTimeline(entries:readonly DriveFaultEntry[],catalog:FaultCatalog,horizonMs:number,o:{removable?:boolean}={}):string{
 const horizon=Math.max(1,horizonMs),layerOf=(e:DriveFaultEntry)=>catalog.find(f=>f.id===e.faultId)?.layer,known=(e:DriveFaultEntry)=>layerOf(e)!==undefined;
 const lane=(layer:string,y:number)=>{
  const mine=entries.filter(e=>layerOf(e)===layer&&e.trigger.value<horizon);
  return `<g data-lane="${layer}" transform="translate(0 ${y})"><text x="0" y="${LANE_H-5}" class="lane-label">${esc(layerName(layer))}</text>${mine.map(e=>{
   const w=Math.min(100,Math.max(MIN_W,e.durationMs/horizon*100)),x=Math.min(e.trigger.value/horizon*100,100-w);
   return `<rect data-entry="${esc(e.id)}" x="${fmt(x)}" width="${fmt(w)}" y="1" height="${LANE_H-4}" class="fault-bar"><title>${esc(e.faultId)} · ${esc(e.targetId)}</title></rect>`;}).join('')}</g>`;
 };
 const label=`${tr('Dòng thời gian lỗi','障害タイムライン','Fault timeline')}: ${entries.length} ${tr('mục lỗi','件の障害','fault(s)')}`;
 const svg=`<svg class="fault-timeline-plot" role="img" aria-label="${esc(label)}" viewBox="0 0 100 ${DRIVE_FAULT_LAYERS.length*(LANE_H+PAD)}" preserveAspectRatio="none" focusable="false">${DRIVE_FAULT_LAYERS.map((l,i)=>lane(l,i*(LANE_H+PAD))).join('')}</svg>`;
 const list=`<ol class="fault-timeline-list" aria-label="${esc(tr('Các mục lỗi','障害エントリ','Fault entries'))}">${entries.map(e=>`<li data-entry="${esc(e.id)}"${known(e)?'':' data-unknown="true"'}${e.trigger.value>=horizon?' data-beyond="true"':''}><b>${esc(e.faultId)}</b> · ${esc(e.targetId)} · ${tr('bắt đầu','開始','starts')} ${esc(e.trigger.value)} ms · ${tr('kéo dài','継続','lasts')} ${esc(e.durationMs)} ms${Object.keys(e.params).length?` · ${esc(paramsText(e.params))}`:''}${known(e)?` · ${esc(layerName(layerOf(e)!))}`:` · ${tr('không có trong danh mục của runtime','ランタイムのカタログにない','not in the runtime\'s catalog')}`}${o.removable?` <button type="button" class="text-button" data-action="twin-drivefault-remove" data-value="${esc(e.id)}">${tr('Xóa','削除','Remove')}</button>`:''}</li>`).join('')}</ol>`;
 return `<div class="fault-timeline" data-testid="fault-timeline"${entries.length?'':' data-empty="true"'}><div class="fault-axis" aria-hidden="true"><span>0 s</span><span>${esc((horizon/1000).toFixed(horizon%1000?1:0))} s</span></div>${svg}${list}</div>`;
}
