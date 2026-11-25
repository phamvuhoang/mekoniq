// Keys of the twin page (D66): each names a data-action the workspace already handles. Pure: the workspace's keydown listener calls keyAction.
import {tr} from '../i18n';
export const KEYMAP:Readonly<Record<string,string>>={' ':'twin-toggle-play',ArrowRight:'twin-step',f:'twin-camera-fit',i:'twin-inspector-toggle',w:'twin-watch','?':'twin-help',Escape:'twin-escape'};
const FIELDS=['INPUT','SELECT','TEXTAREA'];
/** null while typing in a field (a range input is not one, but its arrows keep moving it), with Ctrl/Meta/Alt held, or with a dialog open
 * (Escape still acts). Letters ignore Shift/Caps Lock. A held Space (auto-repeat) toggles play once. */
export function keyAction(e:{key:string;ctrlKey:boolean;metaKey:boolean;altKey:boolean;repeat?:boolean;target:{tagName?:string;type?:string;isContentEditable?:boolean;role?:string|null}|null},dialogOpen:boolean):string|null{
 // on a tab, the arrows move between the tabs (the tablist's own keys), never the run
 if(e.target?.role==='tab'&&(e.key==='ArrowRight'||e.key==='ArrowLeft')&&!e.ctrlKey&&!e.metaKey&&!e.altKey)return e.key==='ArrowRight'?'twin-tab-next':'twin-tab-previous';
 const range=e.target?.tagName?.toUpperCase()==='INPUT'&&e.target.type==='range';
 if(e.ctrlKey||e.metaKey||e.altKey||e.target?.isContentEditable||!range&&FIELDS.includes(e.target?.tagName?.toUpperCase()??'')||range&&e.key==='ArrowRight')return null;
 const action=KEYMAP[e.key]??KEYMAP[e.key.toLowerCase()]??null;
 return dialogOpen&&action!=='twin-escape'||e.repeat&&action==='twin-toggle-play'?null:action;
}
const LABELS:Record<string,string>={' ':'Space',ArrowRight:'→',Escape:'Esc'};
const what=(action:string)=>({
 'twin-toggle-play':tr('Chạy/dừng tự chạy; khi xem lại: phát/dừng','自動実行の開始/停止。再生中は再生/停止','Start/stop auto-run; in replay: play/pause'),
 'twin-step':tr('Bước +5 s','+5 秒進める','Step +5 s'),
 'twin-camera-fit':tr('Vừa khung đối tượng chọn','選択対象に合わせる','Fit the selected object'),
 'twin-inspector-toggle':tr('Mở/đóng bảng chi tiết','詳細パネルの開閉','Open/close the details'),
 'twin-watch':tr('Chế độ xem: chỉ khung nhìn, nhãn mô phỏng và thanh điều khiển','視聴モード:ビューポート、シミュレーション表示、操作バーのみ','Watch mode: only the viewport, the simulation label and the transport'),
 'twin-help':tr('Bảng phím này','このキー一覧','This key list'),
 'twin-escape':tr('Thoát chế độ xem, rồi đóng hộp đang mở, rồi đóng bảng chi tiết','視聴モード終了→開いている枠を閉じる→詳細を閉じる','Leave watch mode, then close the open box, then close the details'),
})[action]??action;
/** Non-modal: the workspace owns Escape for it (twin-escape); its close button (twin-help-close) takes focus when it opens. */
export const TWIN_ONLY_KEYS:readonly string[]=['twin-toggle-play','twin-step','twin-camera-fit','twin-watch'];
export function shortcutsDialog(open:boolean,control=false):string{
 return `<dialog class="twin-shortcuts" id="twin-shortcuts" data-testid="shortcuts" aria-labelledby="twin-shortcuts-title"${open?' open':''}><h2 id="twin-shortcuts-title">${tr('Phím tắt','キーボードショートカット','Keyboard shortcuts')}</h2>
<dl>${Object.entries(KEYMAP).filter(([,a])=>!control||!TWIN_ONLY_KEYS.includes(a)).map(([k,a])=>`<dt><kbd>${LABELS[k]??k.toUpperCase()}</kbd></dt><dd>${what(a)}</dd>`).join('')}</dl><button class="button quiet" data-action="twin-help-close">${tr('Đóng','閉じる','Close')}</button></dialog>`;
}
