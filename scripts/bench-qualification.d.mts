export type BenchGateStatus='tested'|'failed'|'not_run'|'blocked_external';
export const GATES_BENCH:Record<string,string[]>;
export const CASES_BENCH:Record<string,{gate:string|null;optional?:true}>;
export const CUTTABLE_BENCH:string[];
export const EXTERNAL_GATES_BENCH:Record<'G-SAFE1',string>;
export const HARDWARE_GATES_BENCH:string[];
export function gateStatus(gateId:string,caseStatuses:Record<string,{status:string;reason:string|null}|undefined>,o:{testLevel:'protocol_double'|'hardware'}):BenchGateStatus;
