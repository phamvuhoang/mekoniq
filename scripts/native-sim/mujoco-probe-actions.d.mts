export interface ProbeAction {actionId:string;kind:string;payload:Record<string,unknown>;received:boolean}
export interface ProbeActionResult {run:{runRevision:number};[key:string]:unknown}
export function createActionRecorder(options:{runId:string;revision:number;requests:ProbeAction[];httpMs:number[];save:(name:string,value:unknown)=>Promise<void>;api:(path:string,method:string,body:Record<string,unknown>)=>Promise<ProbeActionResult>;memory:()=>Promise<void>}):(kind:string,payload?:Record<string,unknown>)=>Promise<ProbeActionResult>;
