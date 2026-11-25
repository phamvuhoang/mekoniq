// Transport bar of the twin page: one bar for a live run and for replay. It only names runtime requests (auto-run, +5 s, pause/resume,
// cancel) and the view's run speed (not in replay, whose rate is fixed); in replay its play/stop, scrubber (with event marks) and exit only move the local cursor, never the runtime.
// Idle (no run) disables every button.
import {icon,esc} from './icons';
import {tr} from '../i18n';
export interface TransportState {mode:'idle'|'live'|'replay';playing:boolean;canPlay:boolean;canStep:boolean;canPause:boolean;paused:boolean;
 /** Pause was pressed during a paced auto-run: the step in flight finishes, then pause is sent; the button says so and is disabled. */pausing?:boolean;canCancel:boolean;speeds:number[];speed:number;simTimeS:number;tick:number;
 /** Tốc độ đo được khi đang tự chạy; hiện cạnh tốc độ chọn khi lệch quá 10 % (data-testid measured-speed). */measuredSpeed?:number;
 replay?:{fromTick:number;toTick:number;tick:number;playing:boolean;marks:{tick:number;label:string}[];step?:number};
 /** Whose run these controls drive, said on the bar when another tool shares the page (the Control tab: the twin's run, not the bench). */scope?:string}
// the title carries the label where only the icon is shown (≤ 767 px); the id tells a transport control from the run bar's primary action of the same
// action (the page restores focus by id first)
const btn=(label:string,action:string,ico:string,on:boolean,cls='secondary')=>`<button class="button ${cls}" id="transport-${action}" data-action="${action}" title="${label}"${on?'':' disabled'}>${icon(ico,16)}<span>${label}</span></button>`;
/** 2.5 -> "2,5" in Vietnamese, "2.5" otherwise. */
const decimal=(n:number)=>{const s=n.toFixed(1);return tr(s.replace('.',','),s,s);};
/** The bar's time; in replay it carries `replay-time` and the last recorded tick (repainted in place on scrub). */
export const transportTime=(simTimeS:number,tick:number,toTick?:number)=>`${simTimeS.toFixed(1)} s · tick ${tick}${toTick===undefined?'':` / ${toTick}`}`;
export function transportBar(s:TransportState):string{
 const run=s.mode==='live',r=s.mode==='replay'?s.replay:undefined;
 const play=r?btn(r.playing?tr('Dừng phát','停止','Pause'):tr('Phát','再生','Play'),'twin-replay-play',r.playing?'pause':'play',true):s.playing?btn(tr('Tạm dừng tự chạy','自動実行を停止','Stop auto-run'),'twin-stop','stop',run):btn(tr('Tự chạy','自動実行','Auto-run'),'twin-play','play',run&&s.canPlay);
 // pausing: aria-disabled, not disabled, so the pressed control keeps focus (and its node) until the pause lands
 const pause=s.pausing?`<button class="button secondary" id="transport-twin-pause" data-action="twin-pause" aria-disabled="true" title="${tr('Đang tạm dừng…','一時停止中…','Pausing…')}">${icon('pause',16)}<span>${tr('Đang tạm dừng…','一時停止中…','Pausing…')}</span></button>`:s.paused?btn(tr('Tiếp tục mô phỏng','シミュレーション再開','Resume simulation'),'twin-resume','play',run&&s.canPause):btn(tr('Tạm dừng mô phỏng','シミュレーション一時停止','Pause simulation'),'twin-pause','pause',run&&s.canPause);
 // in a fixed slot: the readout appearing never shifts the controls after it (they keep their elements during a paced run)
 const measured=s.measuredSpeed!==undefined&&Math.abs(s.measuredSpeed-s.speed)>0.1*s.speed?`<span class="twin-measured" data-testid="measured-speed">${tr('đo được','実測','measured')} ${esc(decimal(s.measuredSpeed))}×</span>`:'';
 const cursor=r?`<label for="twin-replay-cursor" class="visually-hidden">${tr('Vị trí xem lại (tick)','再生位置(tick)','Replay position (tick)')}</label><input id="twin-replay-cursor" type="range" min="${esc(r.fromTick)}" max="${esc(r.toTick)}" step="${esc(r.step??5)}" value="${esc(r.tick)}"${r.marks.length?' list="twin-replay-marks"':''}>${r.marks.length?`<datalist id="twin-replay-marks">${r.marks.map(m=>`<option value="${esc(m.tick)}" label="${esc(m.label)}"></option>`).join('')}</datalist>`:''}`:'<span class="twin-transport-fill"></span>';
 return `<div class="twin-transport" id="twin-transport" data-testid="twin-transport" role="group" aria-label="${s.scope?esc(s.scope):tr('Điều khiển lần chạy','実行の操作','Run controls')}">
${s.scope?`<span class="twin-transport-scope" data-testid="transport-scope">${esc(s.scope)}</span>`:''}${play}${btn('+5 s','twin-step','arrow',run&&s.canStep)}${pause}${r?'':`<label class="twin-speed"><span>${tr('Tốc độ chạy','実行速度','Run speed')}</span><select id="twin-run-speed">${s.speeds.map(n=>`<option value="${esc(n)}"${n===s.speed?' selected':''}>${esc(n)}×</option>`).join('')}</select></label><span class="twin-measured-slot" id="twin-measured">${measured}</span>`}
${cursor}<span class="twin-transport-time" id="twin-transport-time"${r?' data-testid="replay-time"':''}>${esc(transportTime(s.simTimeS,s.tick,r?.toTick))}</span>${r?btn(tr('Thoát xem lại','再生を終了','Exit replay'),'twin-replay-exit','cross',true,'quiet'):btn(tr('Hủy lần chạy','実行をキャンセル','Cancel run'),'twin-cancel','cross',run&&s.canCancel,'quiet')}</div>`;
}
