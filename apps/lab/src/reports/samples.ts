// Static samples (R5.5): a hardware candidate package and four stop reports, shipped as files and read back byte for byte before they are shown. Nothing here asks a runtime.
import type {DeviceProfileV1,ElectricalBundleV1,ElectricalDesignV1,HardwareCandidateV1} from '../shared/engineering';
import type {StopReportV1} from '../shared/navigation2d';
export interface SampleEntry {id:'hardware-candidate'|'stop-report';kind:'hardware_candidate'|'stop_report';manifest:string;sha256:string;calibration:'not_calibrated';accepted:false}
const hex=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource))].map(x=>x.toString(16).padStart(2,'0')).join('');
/** A catalog entry is usable only when it says it is not calibrated and not accepted. */
export const validEntry=(e:unknown):e is SampleEntry=>{const x=e as Partial<SampleEntry>|null;return !!x&&typeof x==='object'&&(x.id==='hardware-candidate'||x.id==='stop-report')&&typeof x.manifest==='string'&&/^[0-9a-f]{64}$/.test(String(x.sha256))&&x.calibration==='not_calibrated'&&x.accepted===false;};
const dirOf=(p:string)=>p.slice(0,p.lastIndexOf('/')+1);
/** Hashes the manifest against the catalog and every file the manifest lists against the manifest. `mismatched` names each file that differs or cannot be read. */
export async function verifySample(entry:SampleEntry,fetchBytes:(path:string)=>Promise<Uint8Array>):Promise<{ok:boolean;mismatched:string[]}>{
 const mismatched:string[]=[];
 let manifestBytes:Uint8Array;try{manifestBytes=await fetchBytes(entry.manifest);}catch{return {ok:false,mismatched:[entry.manifest]};}
 if(await hex(manifestBytes)!==entry.sha256)return {ok:false,mismatched:[entry.manifest]};
 let manifest:{files?:{path:string;sha256:string}[]};try{manifest=JSON.parse(new TextDecoder().decode(manifestBytes));}catch{return {ok:false,mismatched:[entry.manifest]};}
 for(const f of manifest.files??[]){
  try{if(await hex(await fetchBytes(dirOf(entry.manifest)+f.path))!==f.sha256)mismatched.push(f.path);}catch{mismatched.push(f.path);}
 }
 return {ok:mismatched.length===0,mismatched};
}
export interface HardwareSample {manifest:HardwareCandidateV1;bundle:ElectricalBundleV1;design:ElectricalDesignV1;profiles:Map<string,DeviceProfileV1>;checklist:string}
export async function loadHardwareSample(entry:SampleEntry,fetchBytes:(path:string)=>Promise<Uint8Array>):Promise<HardwareSample>{
 const base=dirOf(entry.manifest),json=async<T>(p:string)=>JSON.parse(new TextDecoder().decode(await fetchBytes(base+p))) as T;
 const manifest=await json<HardwareCandidateV1>('manifest.json'),profiles=new Map<string,DeviceProfileV1>();
 for(const f of manifest.files)if(f.path.startsWith('profiles/')){const p=await json<DeviceProfileV1>(f.path);profiles.set(p.id,p);}
 return {manifest,bundle:await json<ElectricalBundleV1>('electrical-bundle.json'),design:await json<ElectricalDesignV1>('electrical-design.json'),profiles,checklist:new TextDecoder().decode(await fetchBytes(base+'documents/bench-checklist.md'))};
}
export async function loadStopSample(entry:SampleEntry,fetchBytes:(path:string)=>Promise<Uint8Array>):Promise<StopReportV1[]>{
 const base=dirOf(entry.manifest),m=JSON.parse(new TextDecoder().decode(await fetchBytes(entry.manifest))) as {files:{path:string}[]};
 return Promise.all(m.files.map(async f=>JSON.parse(new TextDecoder().decode(await fetchBytes(base+f.path))) as StopReportV1));
}
export const fetchStatic=async(path:string):Promise<Uint8Array>=>{const r=await fetch('/'+path,{cache:'no-store'});if(!r.ok)throw new Error('SAMPLE_UNAVAILABLE:'+path);return new Uint8Array(await r.arrayBuffer());};
