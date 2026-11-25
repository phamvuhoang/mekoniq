import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {electricalDigest,validateElectricalBundle,type ElectricalBundleV1} from './contracts';

const DIGEST=/^[0-9a-f]{64}$/;
/**
 * Electrical bundles live beside, never inside, the engineering bundle store, so writing one never changes the digest of a bundle a run pinned.
 * Content-addressed and re-verified on every read. Session access is in memory like the bundle store's: a restart grants nothing.
 */
export function createElectricalStore(root:string){
 const access=new Map<string,Set<string>>(),ready=mkdir(root,{recursive:true});
 return {
  async put(session:string,bundle:ElectricalBundleV1):Promise<void>{
   await ready;
   if(electricalDigest(bundle)!==bundle.digest)throw new Error('ELECTRICAL_BUNDLE_DIGEST_MISMATCH');
   const path=join(root,`${bundle.digest}.json`),tmp=`${path}.tmp-${randomUUID()}`;
   await writeFile(tmp,JSON.stringify(bundle),{mode:0o600});await rename(tmp,path);
   const set=access.get(session)??new Set<string>();set.add(bundle.digest);access.set(session,set);
  },
  authorized:(session:string,digest:string)=>access.get(session)?.has(digest)??false,
  /** Null when the digest is unknown, damaged, or not this session's; the caller answers all three the same way. */
  async read(session:string,digest:string):Promise<ElectricalBundleV1|null>{
   if(!DIGEST.test(digest)||!access.get(session)?.has(digest))return null;
   try{
    const bundle=JSON.parse(await readFile(join(root,`${digest}.json`),'utf8')) as ElectricalBundleV1;
    return validateElectricalBundle(bundle).ok&&electricalDigest(bundle)===digest&&bundle.digest===digest?bundle:null;
   }catch{return null;}
  },
 };
}
export type ElectricalStore=ReturnType<typeof createElectricalStore>;
