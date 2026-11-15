export function runMujocoProbe(options:{handoff:string;out:string;signal?:AbortSignal}):Promise<{qualification:string;accepted:boolean;DEP_MJ_01:string;cases:{status:string}[]}>;
export function verifyMujocoProbe(root:string):Promise<{passed:boolean;issues:string[];qualification:string;accepted:boolean}>;
export function readMujocoProbeSupplement(root:string):Promise<{status:string;accepted:boolean;[key:string]:unknown}>;
export function copyMujocoProbeSupplement(input:string,out:string):ReturnType<typeof readMujocoProbeSupplement>;
