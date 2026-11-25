import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openReplayPackage} from '../../src/reports/replay-package';
import {replayZip} from '../../src/reports/replay-save';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
test('ZIP preserves genuine encoded package size/hash and roundtrips through the admitted reader',async()=>{
 const root='public/replays/mobile-impact/',manifest=await readFile(root+'manifest.json'),reader=await openReplayPackage(manifest,async function*(a){yield await readFile(root+a.path+(a.encoding==='gzip'?'.bin':''));});
 const archive=new Uint8Array(await(await replayZip(reader,new AbortController().signal)).arrayBuffer()),v=new DataView(archive.buffer),entries=new Map<string,Uint8Array>();let at=0;
 while(v.getUint32(at,true)===0x04034b50){const length=v.getUint32(at+18,true),nameLength=v.getUint16(at+26,true),extra=v.getUint16(at+28,true),name=new TextDecoder().decode(archive.slice(at+30,at+30+nameLength)),start=at+30+nameLength+extra;entries.set(name,archive.slice(start,start+length));at=start+length;}
 for(const a of reader.manifest.assets){const bytes=entries.get(a.path)!;expect(bytes.length).toBe(a.bytes);expect(sha(bytes)).toBe(a.sha256);}
 const imported=await openReplayPackage(entries.get('manifest.json')!,async function*(a){yield entries.get(a.path)!;});expect(imported.manifest.horizon.tick).toBe(520);expect((await imported.sampleAt('physics',520))?.tick).toBe(520);imported.close();reader.close();
});
