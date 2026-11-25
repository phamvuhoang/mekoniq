export interface RuntimeIdentity {sourceCommit:string;schemaHash:string;protocolMajor:number;protocolMajors?:number[];}
/** The lock pins one artifact; a runtime is compatible when it is that source/schema and speaks a protocol major the pinned artifact offers (v1 health from a [1,2] artifact is fine). */
export function verifyRuntime(lock:RuntimeIdentity,actual:RuntimeIdentity):{ok:boolean;reasons:string[]} {
 const reasons:string[]=[];
 if(lock.sourceCommit!==actual.sourceCommit) reasons.push('SOURCE_MISMATCH');
 if(lock.schemaHash!==actual.schemaHash||!(lock.protocolMajors??[lock.protocolMajor]).includes(actual.protocolMajor)) reasons.push('CONTRACT_MISMATCH');
 return {ok:reasons.length===0,reasons};
}
