// Every registered bench case, by id: the evidence reader (K05) re-runs a case's evaluate on its stored trace.
import type {BenchKitV1,BenchPolicy} from '../contracts';
import {CONFORMANCE_CASES} from './conformance';
import {SENSOR_CASES} from './sensors';
import type {BenchCase,CaseTrace,CaseVerdict} from './types';
export type * from './types';
export {CONFORMANCE_CASES,trackingCase} from './conformance';
export {LIDAR_RANGE_M,SENSOR_CASES,scanRows,toLidarScan,type Ld19Frame} from './sensors';
export const BENCH_CASES:readonly BenchCase[]=[...CONFORMANCE_CASES,...SENSOR_CASES];
export const benchCase=(id:string):BenchCase|undefined=>BENCH_CASES.find(c=>c.id===id);
/** THE verdict of a case, a pure function of what is stored: the runner's own decision when it made one (`trace.meta.runner`, only ever not_run or failed),
 * otherwise the case's evaluate. runCase returns exactly this and the record reader recomputes it, so a stored `tested` can only come from evaluate. */
export function verdictOf(c:BenchCase,trace:CaseTrace,kit:BenchKitV1,policy:BenchPolicy):CaseVerdict{
 const r=trace.meta?.runner as {status?:unknown;reason?:unknown}|undefined;
 if(r===undefined)return c.evaluate(trace,kit,policy);
 const ok=!!r&&(r.status==='not_run'||r.status==='failed')&&typeof r.reason==='string';
 return ok?{status:r.status as 'not_run'|'failed',reason:r.reason as string,measurements:[]}:{status:'failed',reason:'RUNNER_VERDICT_INVALID',measurements:[]};
}
