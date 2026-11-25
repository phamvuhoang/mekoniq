import type {ElectricalBundleV1,TcoAssumptionsV1,TcoComparisonV1} from './contracts';

type Parts=TcoComparisonV1['options'][number]['parts'];
const FACTORS=['hardware','wiring','assembly','testing','service','downtime'] as const;
const sum=(xs:(number|null)[])=>xs.some(x=>x===null)?null:xs.reduce<number>((s,x)=>s+(x as number),0);

/**
 * Pure comparison of 2 to 4 bundles of one project. No currency conversion, no default price: a part that needs a price nobody has is `null`, and so is every total that contains it.
 * Assembly, testing and downtime come from the assumptions and the wire and connector counts, so they are always numbers; `dominant` is the part, among those known for every option, that differs most.
 */
export function compareOptions(bundles:readonly ElectricalBundleV1[],assumptions:TcoAssumptionsV1):TcoComparisonV1{
 const options=bundles.map(b=>{
  const own=b.bom.lines.filter(l=>l.lineId.startsWith('eld/')||l.lineId.startsWith('mate/')||l.lineId.startsWith('wire/'));
  const line=(prefix:string)=>own.filter(l=>l.lineId.startsWith(prefix)),price=(ls:typeof own)=>sum(ls.map(l=>l.price?l.price.amount*l.qty:null));
  const drives=line('eld/drive/'),parts=line('eld/part/'),connectors=line('mate/'),wire=line('wire/');
  const currencies=new Set(own.filter(l=>l.price).map(l=>l.price!.currency));
  const wireCount=b.netlist.wires.length,connectorQty=connectors.reduce((n,l)=>n+l.qty,0),units=drives.reduce((n,l)=>n+l.qty,0)+parts.reduce((n,l)=>n+l.qty,0);
  const metres=wire.reduce((n,l)=>n+l.qty,0);
  const p:Parts={
   hardware:currencies.size>1?null:price([...drives,...parts]),
   wiring:assumptions.wirePricePerM===null||assumptions.connectorPrice===null?null:metres*assumptions.wirePricePerM+connectorQty*assumptions.connectorPrice,
   assembly:(wireCount*assumptions.minutesPerWire+connectorQty*assumptions.minutesPerConnector)/60*assumptions.labourPerHour,
   testing:units*assumptions.testMinutesPerUnit/60*assumptions.labourPerHour,
   service:price(drives)===null?null:assumptions.driveReplacementsOverLife*price(drives)!/Math.max(1,drives.reduce((n,l)=>n+l.qty,0)),
   downtime:assumptions.driveReplacementsOverLife*assumptions.downtimeHoursPerRepair*assumptions.downtimeCostPerHour};
  return {designId:b.inputs.design.id,bundleDigest:b.digest,comparable:false,missingPriceLineIds:b.bom.missingPriceLineIds.filter(id=>id.startsWith('eld/')),parts:p,total:sum(FACTORS.map(f=>p[f])),state:b.state,currencies:[...currencies]};
 });
 const blocked=options.some(o=>o.state==='blocked'),mixed=new Set(options.flatMap(o=>o.currencies)).size>1,missing=options.some(o=>o.total===null);
 const reason:TcoComparisonV1['notComparableReason']=blocked?'BUNDLE_BLOCKED':mixed?'CURRENCY_MISMATCH':missing?'PRICE_MISSING_FOR_DECIDING_PARTS':null;
 let dominant:TcoComparisonV1['dominant']=null;
 for(const f of FACTORS){
  const vs=options.map(o=>o.parts[f]);if(vs.some(v=>v===null))continue;
  const spread=Math.max(...(vs as number[]))-Math.min(...(vs as number[]));
  if(dominant===null||spread>dominant.spread)dominant={factor:f,spread};
 }
 return {assumptionsDigest:assumptions.digest,options:options.map(o=>({designId:o.designId,bundleDigest:o.bundleDigest,comparable:reason===null,missingPriceLineIds:o.missingPriceLineIds,parts:o.parts,total:reason==='CURRENCY_MISMATCH'||reason==='BUNDLE_BLOCKED'?null:o.total})),dominant,notComparableReason:reason};
}
