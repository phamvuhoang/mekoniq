// Every registered bench case, by id: the evidence reader (K05) re-runs a case's evaluate on its stored trace.
import {CONFORMANCE_CASES} from './conformance';
import type {BenchCase} from './types';
export type * from './types';
export {CONFORMANCE_CASES,trackingCase} from './conformance';
export const BENCH_CASES:readonly BenchCase[]=CONFORMANCE_CASES;
export const benchCase=(id:string):BenchCase|undefined=>BENCH_CASES.find(c=>c.id===id);
