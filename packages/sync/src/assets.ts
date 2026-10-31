export type LocalAsset={id:string;hash:string;bytes:number;localPath:string;status:'pending'|'ready'|'missing'|'rejected'};
/** Metadata/network failures leave local bytes in place for resume. */
export function mayRemoveLocalAsset(local:LocalAsset,receipt:{id:string;hash:string;status:string}){return receipt.status==='ready'&&receipt.id===local.id&&receipt.hash===local.hash;}
