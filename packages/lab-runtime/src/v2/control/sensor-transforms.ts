// Runtime-side sensor faults (R4-A §7.1): applied to a scan before the controller sees it. The draw rule is fixed so that one dropped ray never shifts the noise of the next:
// every ray spends three uniforms, u0 for the dropout decision, then a Box-Muller pair of which the first is the range noise.
import {gaussianPair,type Stream} from '../random';

export function lidarNoise<T extends {rangesM:(number|null)[];states:string[];rangeMinM?:number;rangeMaxM?:number}>(scan:T,params:{sigmaM:number;dropoutFraction:number},stream:Stream):T{
 const rangesM=[...scan.rangesM],states=[...scan.states];
 for(let i=0;i<rangesM.length;i++){
  const u0=stream.next(),[noise]=gaussianPair(stream),r=rangesM[i];
  if(r===null||r===undefined||states[i]!=='hit')continue;
  if(u0<params.dropoutFraction){rangesM[i]=null;states[i]='no_return';continue;}
  let v=r+params.sigmaM*noise;
  if(scan.rangeMinM!==undefined)v=Math.max(scan.rangeMinM,v);
  if(scan.rangeMaxM!==undefined)v=Math.min(scan.rangeMaxM,v);
  rangesM[i]=v;
 }
 return {...scan,rangesM,states};
}
