// ponytail: five fixed columns, straight connectors; readable up to about 20 devices. Pin-level drawing is the trigger for elkjs (spec R5-A §10).
import type {ElectricalBundleV1} from '../shared/engineering';
import {tr} from '../i18n';
const COLUMNS=['power','protection','control','drive','field'] as const;
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const columnOf=(id:string):number=>/battery|supply|psu|charger/.test(id)?0:/fuse|breaker|contactor|estop|e-stop|protect/.test(id)?1:/controller|io-?module|module|master/.test(id)?2:/drive|krd|zlac|servo/.test(id)?3:4;
/** Same bundle, same string. One `<g data-device-id>` per device, one `<path data-net-id>` per bus and rail, a `<title>` on each. */
export function wiringDiagramSvg(bundle:ElectricalBundleV1,labels:(deviceId:string)=>string):string{
 const ids=[...new Set(bundle.netlist.nets.flatMap(n=>n.nodes.map(x=>x.deviceId)))].sort();
 const cols=COLUMNS.map(()=>[] as string[]);for(const id of ids)cols[columnOf(id)]!.push(id);
 const pos=new Map<string,{x:number;y:number}>(),W=160,H=44,GX=40,GY=18;
 cols.forEach((c,ci)=>c.forEach((id,ri)=>pos.set(id,{x:ci*(W+GX)+10,y:ri*(H+GY)+30})));
 const height=Math.max(1,...cols.map(c=>c.length))*(H+GY)+40,width=COLUMNS.length*(W+GX);
 const heads=COLUMNS.map((c,i)=>`<text x="${i*(W+GX)+10}" y="16" class="wd-col">${c}</text>`).join('');
 const nets=bundle.netlist.nets.filter(n=>n.kind==='bus'||n.kind==='power').map(n=>{
  const pts=[...new Set(n.nodes.map(x=>x.deviceId))].map(d=>pos.get(d)!).filter(Boolean).sort((a,b)=>a.x-b.x||a.y-b.y);
  return `<path data-net-id="${esc(n.id)}" class="wd-net wd-${n.kind}" d="${pts.map((p,i)=>`${i?'L':'M'}${p.x+W/2} ${p.y+H/2}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5"><title>${esc(n.id)} (${n.kind})</title></path>`;}).join('');
 const boxes=ids.map(id=>{const p=pos.get(id)!;return `<g data-device-id="${esc(id)}" ><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="4" fill="none" stroke="currentColor"/><text x="${p.x+8}" y="${p.y+26}">${esc(labels(id))}</text><title>${esc(labels(id))} (${esc(id)})</title></g>`;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(tr('Sơ đồ đấu dây: các cột nguồn, bảo vệ, điều khiển, drive, thiết bị trường','配線図: 電源・保護・制御・ドライブ・フィールド機器の列','Wiring diagram: columns for power, protection, control, drive and field devices'))}" class="wiring-diagram">${heads}${nets}${boxes}</svg>`;
}
