// Deliberately narrow, bounded reader of np.savez's four uncompressed float64 state vectors.
// No pickle, object arrays, extraction, decompression, arbitrary dtype or ZIP paths.
import {crc32} from 'node:zlib';
export function readStateNpz(bytes){
 const fail=()=>{throw Error('STATE_NPZ_INVALID');};
 if(bytes.length<22||bytes.length>1024*1024)fail();const end=bytes.length-22;
 if(bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt32LE(end+4)!==0||bytes.readUInt16LE(end+8)!==4||bytes.readUInt16LE(end+10)!==4||bytes.readUInt16LE(end+20)!==0)fail();
 const start=bytes.readUInt32LE(end+16);if(start+bytes.readUInt32LE(end+12)!==end)fail();
 let cursor=start;const result={},ranges=[];
 for(let i=0;i<4;i++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)fail();
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),size=bytes.readUInt32LE(cursor+24),crc=bytes.readUInt32LE(cursor+16),nameSize=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42);
  if(flags!==0||method!==0||size!==bytes.readUInt32LE(cursor+20)||offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==0||bytes.readUInt16LE(offset+8)!==0)fail();
  const name=bytes.subarray(cursor+46,cursor+46+nameSize).toString(),key=name.replace(/\.npy$/,'');
  if(!['qpos','qvel','qacc','ctrl'].includes(key)||name!==key+'.npy'||key in result||bytes.readUInt16LE(offset+26)!==nameSize||bytes.subarray(offset+30,offset+30+nameSize).toString()!==name)fail();
  const dataOffset=offset+30+nameSize+bytes.readUInt16LE(offset+28),stop=dataOffset+size;
  if(stop>start||ranges.some(([a,b])=>offset<b&&stop>a))fail();ranges.push([offset,stop]);
  const npy=bytes.subarray(dataOffset,stop);if(crc32(npy)!==crc||npy.length<10||!npy.subarray(0,6).equals(Buffer.from([147,78,85,77,80,89]))||![1,2].includes(npy[6])||npy[7]!==0)fail();
  const base=npy[6]===1?10:12,headerSize=base===10?npy.readUInt16LE(8):npy.readUInt32LE(8);if(headerSize>1024||base+headerSize>npy.length)fail();
  const header=npy.subarray(base,base+headerSize).toString(),match=/^\{'descr': '<f8', 'fortran_order': False, 'shape': \((\d+),\), \}\s*$/.exec(header);if(!match)fail();
  const count=Number(match[1]);if(count<1||count>4096||base+headerSize+count*8!==npy.length)fail();
  result[key]=Array.from({length:count},(_,i)=>npy.readDoubleLE(base+headerSize+i*8));
  cursor+=46+nameSize+extra+comment;if(cursor>end)fail();
 }
 if(cursor!==end)fail();return result;
}
