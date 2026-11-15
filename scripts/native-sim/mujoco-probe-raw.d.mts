export function readSealedWire(root:string,runId:string):Promise<unknown[]>;
export function verifyBusinessRaw(root:string,spec:unknown,raw:unknown,subject:unknown):Promise<string[]>;
export function verifyBadStateRaw(root:string,raw:unknown,baseline:unknown):Promise<string[]>;
