export function runMujocoProbe(options:{handoff:string;out:string;checker:{sourceCommit:string;toolSha256:string};signal?:AbortSignal}):Promise<{qualification:string;accepted:boolean;DEP_MJ_01:string;cases:{status:string}[]}>;
export function verifyMujocoProbe(root:string,checker?:unknown):Promise<{passed:boolean;issues:string[];qualification:string;accepted:boolean}>;
export function readMujocoProbeSupplement(root:string,checker?:unknown):Promise<{status:string;accepted:boolean;[key:string]:unknown}>;
