// Step-response metrics of a bench trace (R4-A §6, contracts §5). Computed on the TRUE state (`actual`, basis 'actual'); a missing substep (a null sample) is never skipped over: a metric whose window contains one is TRACE_GAP.
import type {ControlMetric,DriveTrace} from './drive-io';

type Sample=NonNullable<DriveTrace['samples'][number]>;
type Names='riseTimeS'|'overshootPct'|'settlingTimeS'|'steadyStateError'|'rmsError'|'peakTorqueNm'|'saturationRatio';
const no=(unit:string,reason:string):ControlMetric=>({available:false,value:null,unit,reason});
const yes=(value:number,unit:string,samples:number):ControlMetric=>({available:true,value,unit,samples,basis:'actual'});

/** `signal`: where the step starts (`t0S`, seconds from the first sample), the value it starts from and its signed size. `policy`: the trailing window the steady state is read from, the settling band (a fraction of the amplitude, inclusive)
 *  and how long the response must stay in the band to count as settled. `mode` only names the unit of the position or speed metrics. Time metrics are measured from t0S.
 *  riseTimeS: 10 % to 90 % (TARGET_NOT_REACHED); overshootPct: peak beyond the target y0 + amplitude in % of the amplitude (0 when none, TARGET_NOT_REACHED when the response never reaches 90 %); settlingTimeS: the time after which the response stays in the band for at least holdWindowS, else NOT_SETTLED;
 *  steadyStateError: (y0 + amplitude) minus the final value, the mean of `actual` over the final window; the final value (so the error) is NOT_SETTLED only when the standard deviation of `actual` in that window exceeds settleBand * |amplitude| (contracts §5; a response that settles away from its target has an error, not NOT_SETTLED); rmsError: sqrt(mean((target - actual)^2)); peakTorqueNm: max |torque|; saturationRatio: the share of samples flagged saturated. */
export function stepResponseMetrics(trace:DriveTrace,signal:{t0S:number;y0:number;amplitude:number},policy:{finalWindowS:number;settleBand:number;holdWindowS:number},mode:'csp'|'csv'='csp'):Record<Names,ControlMetric>{
 const u=mode==='csp'?'rad':'rad/s',units:Record<Names,string>={riseTimeS:'s',overshootPct:'%',settlingTimeS:'s',steadyStateError:u,rmsError:u,peakTorqueNm:'N m',saturationRatio:'ratio'};
 const all=(reason:string)=>Object.fromEntries((Object.keys(units) as Names[]).map(k=>[k,no(units[k],reason)])) as Record<Names,ControlMetric>;
 const {dtS,samples}=trace,n=samples.length,{t0S,y0,amplitude}=signal;
 if(!(amplitude!==0&&Number.isFinite(amplitude)&&Number.isFinite(y0)))return all('AMPLITUDE_ZERO');
 if(!(policy.finalWindowS>0&&policy.holdWindowS>0&&policy.settleBand>0&&policy.settleBand<=1))return all('POLICY_INVALID');
 const i0=Math.round(t0S/dtS);
 if(!(dtS>0&&t0S>=0&&Number.isFinite(t0S)&&i0<n))return all('WINDOW_INVALID');
 const iFinal=n-Math.ceil(policy.finalWindowS/dtS);
 const win=(from:number)=>{const w=samples.slice(from);return w.includes(null)?null:w as Sample[];};
 const w=win(i0),out=all('TRACE_GAP');
 if(w){
  const yn=w.map(s=>(s.actual-y0)/amplitude),m=w.length;
  // 10 % and 90 % crossings, linearly interpolated between samples; the first sample may already be past 10 %
  const cross=(level:number)=>{const i=yn.findIndex(y=>y>=level);return i<0?null:i===0?0:i-1+(level-yn[i-1]!)/(yn[i]!-yn[i-1]!);};
  const c10=cross(0.1),c90=cross(0.9);
  out.riseTimeS=c10!==null&&c90!==null?yes((c90-c10)*dtS,'s',m):no('s','TARGET_NOT_REACHED');
  out.overshootPct=c90!==null?yes(Math.max(0,(Math.max(...yn)-1)*100),'%',m):no('%','TARGET_NOT_REACHED');   // contracts §5: like the rise time, undefined until the response reaches its target
  let last=-1;yn.forEach((y,i)=>{if(Math.abs(y-1)>policy.settleBand)last=i;});
  out.settlingTimeS=(m-(last+1))*dtS>=policy.holdWindowS?yes((last+1)*dtS,'s',m):no('s','NOT_SETTLED');
  out.rmsError=yes(Math.sqrt(w.reduce((a,s)=>a+(s.target-s.actual)**2,0)/m),u,m);
  out.peakTorqueNm=yes(Math.max(...w.map(s=>Math.abs(s.torqueNm))),'N m',m);
  out.saturationRatio=w.some(s=>s.saturated===undefined)?no('ratio','SATURATION_NOT_TRACED'):yes(w.filter(s=>s.saturated).length/m,'ratio',m);
 }
 const f=iFinal>=i0?win(iFinal):undefined;   // the final window must lie after the step
 if(f===undefined)out.steadyStateError=no(u,'WINDOW_INVALID');
 else if(f===null)out.steadyStateError=no(u,'TRACE_GAP');
 else{
  const mean=f.reduce((x,q)=>x+q.actual,0)/f.length,sd=Math.sqrt(f.reduce((x,q)=>x+(q.actual-mean)**2,0)/f.length);
  out.steadyStateError=sd>policy.settleBand*Math.abs(amplitude)?no(u,'NOT_SETTLED'):yes(y0+amplitude-mean,u,f.length);
 }
 return out;
}
