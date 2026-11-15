// Synthetic NumPy ZIP_STORED / float64 vectors. No engine or native claim.
import {crc32} from 'node:zlib';
export function stateNpz(state:Record<string,number[]>){
 const parts:Buffer[]=[],directory:Buffer[]=[];let offset=0;
 for(const [key,values]of Object.entries(state)){
  const name=Buffer.from(key+'.npy'),text=`{'descr': '<f8', 'fortran_order': False, 'shape': (${values.length},), }`;
  const header=Buffer.from(text+' '.repeat((64-(10+text.length+1)%64)%64)+'\n'),npy=Buffer.alloc(10+header.length+values.length*8);Buffer.from([147,78,85,77,80,89,1,0]).copy(npy);npy.writeUInt16LE(header.length,8);header.copy(npy,10);values.forEach((v,i)=>npy.writeDoubleLE(v,10+header.length+i*8));
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc32(npy),14);local.writeUInt32LE(npy.length,18);local.writeUInt32LE(npy.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt32LE(crc32(npy),16);central.writeUInt32LE(npy.length,20);central.writeUInt32LE(npy.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);parts.push(local,name,npy);directory.push(central,name);offset+=local.length+name.length+npy.length;
 }
 const size=directory.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,...directory,end]);
}
