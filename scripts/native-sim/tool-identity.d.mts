export interface NativeToolIdentity {version:1;digest:string;files:{path:string;sha256:string;bytes:number}[]}
export function nativeToolClosure(root:string):NativeToolIdentity;
