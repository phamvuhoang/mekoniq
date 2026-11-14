export function isSha256(value:unknown):boolean;
export function nativeInventoryIssues(value:unknown,expected:{profile:unknown;subject:unknown}):{code:string;path:string;severity:'prerequisite'}[];
export function collectNativeInventory():Promise<{schemaVersion:number;provenance:{origin:string;hostOs:string;hostArchitecture:string;virtualization:string;emulation:string;evidencePath:null;evidenceSha256:null};[key:string]:unknown}>;
