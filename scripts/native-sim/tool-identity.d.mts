export interface NativeToolIdentity {version:1;digest:string;files:{path:string;sha256:string;bytes:number}[]}
export function nativeToolClosure(root:string):NativeToolIdentity;
export const PORTABLE_TOOL_PATHS:string[];
export function portableToolClosure(root:string):NativeToolIdentity;
