import type {ReplayReader} from './replay-package';
const encoder=new TextEncoder();
const crc=(b:Uint8Array)=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;};
/** A store-only ZIP of these files at their paths (no compression, so the bytes inside are the bytes given). Extract to a folder to read them back. */
export function storedZip(files:readonly {path:string;bytes:Uint8Array}[]):Blob{
 const local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
 for(const {path,bytes} of files){
  const name=encoder.encode(path),sum=crc(bytes),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,sum,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
  const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,sum,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);local.push(header,bytes);offset+=header.length+bytes.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);e.setUint32(16,offset,true);return new Blob([...local,...central,end] as BlobPart[],{type:'application/zip'});
}
/** Bounded store-only ZIP of already admitted bytes. Extract to a folder to import; never rewrites evidence. */
export async function replayZip(reader:ReplayReader,signal:AbortSignal):Promise<Blob>{
 const files:{path:string;bytes:Uint8Array}[]=[];
 for(const path of ['manifest.json',...reader.manifest.assets.map(a=>a.path)]){if(signal.aborted)throw Error('REPLAY_ABORTED');files.push({path,bytes:path==='manifest.json'?encoder.encode(JSON.stringify(reader.manifest)):await reader.readStoredAsset(path)});}
 return storedZip(files);
}
