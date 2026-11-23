import {vi} from 'vitest';
import * as fs from 'node:fs/promises';
/** Names every FileHandle.sync by the path its handle was opened with; `steps` is the world step in flight when it ran. */
export async function traceSyncs(h:{calls:string[]},onSync=async(_file:string)=>{},beforeSync?:(file:string)=>void|Promise<void>){
 const actual=await vi.importActual<typeof fs>('node:fs/promises'),paths=new WeakMap<object,string>(),syncs:{file:string;steps:number}[]=[];
 vi.mocked(fs.open).mockImplementation(async(...a:Parameters<typeof fs.open>)=>{const f=await actual.open(...a);paths.set(f,String(a[0]));return f;});
 const probe=await actual.open(process.execPath,'r'),proto=Object.getPrototypeOf(probe) as {sync():Promise<void>},sync=proto.sync;await probe.close();
 vi.spyOn(proto,'sync').mockImplementation(async function(this:object){const file=paths.get(this)??'?';await beforeSync?.(file);await sync.call(this);syncs.push({file,steps:h.calls.filter(c=>c.startsWith('step:')).length});await onSync(file);});
 return syncs;
}
