import {hashJson} from '../../v2/hash';
import type {Bom,BomLine,ComponentRevision} from '../contracts';
import type {Quote} from '../catalog';
import type {DesignContext} from './design';
import type {NetlistV1} from './contracts';

const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const idSafe=(s:string)=>s.replace(/[^A-Za-z0-9_.:/-]/g,'_').slice(0,120);

/**
 * The mechanical BOM stays as it is; electrical devices, mating connectors and wire are added. Line ids: `eld/drive|part/…`, `mate/…`, `wire/…`.
 * Only a quotation in the catalog gives a price; connectors and wire have none, so their lines are listed as missing a price and the total is never complete.
 * Wire quantity is whole metres rounded up from the lengths that are known (at least 1); a line with an unknown segment is flagged by UNVERIFIED_LENGTH.
 */
export function extendBom(base:Bom,context:DesignContext,netlist:NetlistV1,catalog:{components:Record<string,ComponentRevision>;quotes:Record<string,Quote>}):Bom{
 const lines=new Map<string,BomLine>(),add=(l:BomLine)=>{const have=lines.get(l.lineId);if(have){have.qty+=l.qty;have.instanceIds.push(...l.instanceIds);for(const a of l.requiredAccessories)if(!have.requiredAccessories.includes(a))have.requiredAccessories.push(a);}else lines.set(l.lineId,{...l,instanceIds:[...l.instanceIds],requiredAccessories:[...l.requiredAccessories]});};
 for(const d of [...context.design.devices].sort((a,b)=>cmp(a.id,b.id))){
  const p=context.profiles.get(d.id)!,c=catalog.components[p.component.digest];if(!c)continue;
  const kind=p.kind==='servo_drive'?'drive':'part',mates=p.connectors.flatMap(x=>x.matingPart?[x.matingPart]:[]);
  const power=c.ports.filter(q=>q.kind==='power'&&q.voltageRangeV),range=(power.find(q=>q.direction==='in')??power[0])?.voltageRangeV??null;
  add({lineId:`eld/${kind}/${c.id}:${p.component.digest.slice(0,8)}`,componentId:c.id,componentRevision:c.revision,componentDigest:p.component.digest,sku:c.identity.sku,candidate:c.identity.status==='candidate',qty:1,massKg:null,
   voltageRangeV:range as [number,number]|null,price:catalog.quotes[p.component.digest]?{amount:catalog.quotes[p.component.digest]!.amount,currency:catalog.quotes[p.component.digest]!.currency,quotedOn:catalog.quotes[p.component.digest]!.quotedOn}:null,sources:[],instanceIds:[d.id],requiredAccessories:mates});
  for(const m of mates)add({lineId:`mate/${idSafe(m)}`,componentId:`mating-${idSafe(m)}`.slice(0,200),componentRevision:'1',componentDigest:hashJson({matingPart:m}),sku:m.slice(0,200),candidate:true,qty:1,massKg:null,voltageRangeV:null,price:null,sources:[],instanceIds:[d.id],requiredAccessories:[]});
 }
 const wires=new Map<string,{csa:number;colour:string;metres:number;ids:string[]}>();
 for(const w of netlist.wires){const k=`${w.csaMm2}mm2:${w.colour}`,g=wires.get(k)??{csa:w.csaMm2,colour:w.colour,metres:0,ids:[]};g.metres+=w.lengthM?.value??0;g.ids.push(w.id);wires.set(k,g);}
 for(const [k,g] of [...wires].sort((a,b)=>cmp(a[0],b[0])))lines.set(`wire/${k}`,{lineId:`wire/${k}`,componentId:`wire-${k}`.replace(/[^A-Za-z0-9_.:/-]/g,'_'),componentRevision:'1',componentDigest:hashJson({wire:g.csa,colour:g.colour}),sku:null,candidate:true,qty:Math.max(1,Math.ceil(g.metres)),massKg:null,voltageRangeV:null,price:null,sources:[],instanceIds:[],requiredAccessories:[]});
 const all=[...base.lines,...[...lines.values()].map(l=>({...l,instanceIds:[...new Set(l.instanceIds)].sort(cmp)})).sort((a,b)=>cmp(a.lineId,b.lineId))];
 const priced=all.filter(l=>l.price),currencies=new Set(priced.map(l=>l.price!.currency));
 return {lines:all,missingPriceLineIds:all.filter(l=>!l.price).map(l=>l.lineId),incompleteTotal:priced.length<all.length||currencies.size>1,
  total:priced.length&&currencies.size===1?{amount:priced.reduce((s,l)=>s+l.price!.amount*l.qty,0),currency:[...currencies][0]!,quotedOn:priced.map(l=>l.price!.quotedOn).sort().at(-1)!}:null};
}
