import type {DeviceProfileV1,ElectricalBundleV1} from './contracts';
import {ELECTRICAL_COMPILER_VERSION} from './compile';

export const ELECTRICAL_DOCUMENTS=['io-allocation.md','wire-list.csv','pinout.csv','bom.csv','checks.md','bench-checklist.md','harness.yml'] as const;
export type ElectricalDocumentName=typeof ELECTRICAL_DOCUMENTS[number];
const LIMIT='Tài liệu sinh tự động từ dữ liệu thiết kế; không thay thế đo điện hay đánh giá an toàn. / Generated from design data; it does not replace electrical measurement or a safety assessment.';
const enc=new TextEncoder();
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
/** RFC 4180: quote when the field has a comma, a quote or a line break; numbers are printed with String(), never a locale. */
const csvCell=(v:unknown)=>{const s=v===null||v===undefined?'':String(v);return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
const csv=(header:string[],rows:unknown[][])=>[header.join(','),...rows.map(r=>r.map(csvCell).join(','))];
const src=(s:{kind:string;documentId:string;locator:string})=>`${s.kind}: ${s.documentId} / ${s.locator}`;
const md=(s:string)=>s.replace(/\|/g,'\\|').replace(/\r?\n/g,' ');

/** A bundle that is not `compiled` has no documents: the checks are the answer, and they are shown by the checks route. */
export function renderElectricalDocuments(bundle:ElectricalBundleV1,profiles:ReadonlyMap<string,DeviceProfileV1>):{path:ElectricalDocumentName;bytes:Uint8Array}[]{
 if(bundle.state!=='compiled')throw new Error('ELECTRICAL_BUNDLE_BLOCKED');
 const id=`bundle ${bundle.digest} ${ELECTRICAL_COMPILER_VERSION}`,hash=(c:string)=>`# ${c}`;
 const pointPin=(deviceId:string,pointId:string)=>profiles.get(deviceId)?.ioPoints.find(p=>p.pointId===pointId)?.pin??'';
 const out:Record<ElectricalDocumentName,string[]>={'io-allocation.md':[],'wire-list.csv':[],'pinout.csv':[],'bom.csv':[],'checks.md':[],'bench-checklist.md':[],'harness.yml':[]};

 const a=bundle.allocation;
 out['io-allocation.md']=[`<!-- ${id} -->`,'# I/O allocation','','## Assigned','','| Signal | Device | Point | Pin | Bus | Exposure | Pinned |','|---|---|---|---|---|---|---|',
  ...a.assigned.map(x=>`| ${md(x.signalId)} | ${md(x.deviceId)} | ${md(x.pointId)} | ${md(pointPin(x.deviceId,x.pointId))} | ${md(x.busId??'')} | ${x.exposure} | ${x.pinned?'yes':'no'} |`),
  '','## Not allocated','',...(a.unassigned.length?a.unassigned.map(u=>`- ${u.signalId}: ${u.reasons.map(r=>`${r.code} (${r.candidates})`).join(', ')}`):['None.']),
  '','## Spare points','',...(a.spare.length?a.spare.map(s=>`- ${s.deviceId}/${s.pointId}`):['None.']),
  '','## Reserved points','',...(a.reserved.length?a.reserved.map(s=>`- ${s.deviceId}/${s.pointId}: ${s.function}`):['None.'])];

 out['wire-list.csv']=[hash(id),...csv(['id','net','from','to','csa_mm2','colour','length_m','current_a','csa_source'],bundle.netlist.wires.map(w=>[w.id,w.netId,`${w.from.deviceId}.${w.from.pin}`,`${w.to.deviceId}.${w.to.pin}`,w.csaMm2,w.colour,w.lengthM?.value??'',w.currentA?.value??'',src(w.csaSource)]))];

 const netOf=new Map<string,string>();
 for(const n of bundle.netlist.nets)for(const nd of n.nodes)netOf.set(`${nd.deviceId}.${nd.pin}`,n.kind==='safety'?`${n.id} (review)`:n.id);
 const rows:unknown[][]=[];
 for(const [deviceId,p] of [...profiles].sort((x,y)=>cmp(x[0],y[0])))for(const c of p.connectors)for(const pin of c.pins)rows.push([deviceId,c.id,pin.pin,pin.name,pin.role,netOf.get(`${deviceId}.${c.id}/${pin.pin}`)??'']);
 out['pinout.csv']=[hash(id),...csv(['device','connector','pin','name','role','net'],rows)];

 out['bom.csv']=[hash(id),...csv(['line_id','component','sku','qty','candidate','unit_price','currency','price_date','missing_price'],bundle.bom.lines.map(l=>[l.lineId,l.componentId,l.sku??'',l.qty,l.candidate,l.price?.amount??'',l.price?.currency??'',l.price?.quotedOn??'',l.price?'no':'yes']))];

 const by=(level:string)=>bundle.checks.filter(c=>c.level===level);
 out['checks.md']=[`<!-- ${id} -->`,'# Checks','',`State: ${bundle.state}. Blocking ${by('blocking').length}, warnings ${by('warning').length}, unverified ${by('unverified').length}.`,
  ...(['blocking','warning','unverified'] as const).flatMap(level=>['',`## ${level}`,'',...(by(level).length?by(level).map(c=>`- \`${c.ruleId}\` ${md(c.path)}: ${md(c.detail)}`):['None.'])])];

 const groups=new Map<string,typeof bundle.checks>();
 for(const c of by('unverified')){const m=/^\/devices\/([^/]+)/.exec(c.path),k=m?m[1]!:'design';groups.set(k,[...(groups.get(k)??[]),c]);}
 const HOW:Record<string,string>={UNVERIFIED_ASSUMED_SOURCE:'replace the assumed value with a pinned document value, or measure it',UNVERIFIED_FIRMWARE:'record the firmware version on the unit and re-check the I/O mapping and PDO layout',UNVERIFIED_BUS_EXPOSURE:'read the point on the bus with the unit powered and confirm object, bit and update time',UNVERIFIED_LENGTH:'measure the wire run on the first build',UNVERIFIED_PRICE:'obtain a quotation and add it to the catalog',UNVERIFIED_CURRENT:'measure the supply current of the device under load'};
 out['bench-checklist.md']=[`<!-- ${id} -->`,'# Bench checklist','','Every item below is something this design relies on and no pinned document supports.','',
  ...[...groups].sort((x,y)=>cmp(x[0],y[0])).flatMap(([k,list])=>['',`## ${k}`,'',...list.map(c=>`- [ ] \`${c.ruleId}\` ${md(c.detail)} — ${HOW[c.ruleId]??'verify on the bench'}`)]),
  ...(groups.size?[]:['','Nothing is unverified.'])];

 const devices=[...new Set(bundle.netlist.wires.flatMap(w=>[w.from.deviceId,w.to.deviceId]))].sort(cmp);
 const used=new Map(devices.map(d=>[d,[...new Set(bundle.netlist.wires.flatMap(w=>[w.from,w.to]).filter(n=>n.deviceId===d).map(n=>n.pin))].sort(cmp)]));
 const q=(s:string)=>JSON.stringify(s);
 out['harness.yml']=[hash(id),'metadata:',`  title: ${q('MEKONIQ harness '+bundle.digest.slice(0,12))}`,`  source: ${q(id)}`,'connectors:',
  ...devices.flatMap(d=>[`  ${q(d)}:`,`    pincount: ${used.get(d)!.length}`,`    pinlabels: [${used.get(d)!.map(q).join(', ')}]`]),
  'cables:',...bundle.netlist.wires.flatMap((w,i)=>[`  ${q('W'+(i+1))}:`,`    wirecount: 1`,`    gauge: ${q(w.csaMm2+' mm2')}`,`    colors: [${q(w.colour)}]`,...(w.lengthM?[`    length: ${w.lengthM.value}`]:[])]),
  'connections:',...bundle.netlist.wires.flatMap((w,i)=>[`  - - ${q(w.from.deviceId)}: [${used.get(w.from.deviceId)!.indexOf(w.from.pin)+1}]`,`    - ${q('W'+(i+1))}: [1]`,`    - ${q(w.to.deviceId)}: [${used.get(w.to.deviceId)!.indexOf(w.to.pin)+1}]`])];

 return ELECTRICAL_DOCUMENTS.map(path=>{
  const lines=out[path],text=path.endsWith('.csv')||path.endsWith('.yml')?[...lines,hash(LIMIT)]:[...lines,'',`_${LIMIT}_`];
  return {path,bytes:enc.encode(text.join('\n')+'\n')};
 });
}
