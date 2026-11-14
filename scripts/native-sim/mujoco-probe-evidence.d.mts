export interface ProbeCase {id:string;kind:string;seed:number;scope:string}
export function mujocoCases():ProbeCase[];
export function probePrerequisites(manifest:unknown,inventory:unknown,host:unknown,engine:unknown):string[];
export function assessCase(spec:ProbeCase,raw:unknown):{passed:boolean;issues:string[]};
export function sha256(bytes:string|Uint8Array):string;
export function probeFile(root:string,path:string,max?:number):Promise<Buffer>;
export function probeArtifacts(root:string):Promise<{path:string;bytes:number;sha256:string}[]>;
export function analyseWire(events:unknown[]):{valid:boolean;issues:string[];spawned:number[];maxActive:number;ipcMs:number[];pending:unknown[];active:number[]};
export function timingSummary(values:number[]):{samples:number;p50Ms:number;p95Ms:number;maxMs:number};
