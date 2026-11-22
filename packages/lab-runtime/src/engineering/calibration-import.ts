// R4-C §3 step 3 (V14): measured logs enter as local files, fail-closed. One CSV per trial (`time_ns,<channel>…`, strictly increasing integer nanoseconds) plus a sidecar that declares units, clock, uncertainty,
// policy, who measured with what, and the bench signal each trial ran. Nothing is reordered, interpolated or converted; a file that does not say what it is does not enter (R4-D41, D47, D50).
import {createHash} from 'node:crypto';
import {isCalibrationDataset,type CalibrationDataset} from './calibration';
import type {BenchRequestV1} from '../v2/control/drive-io';

export type BenchSignal=BenchRequestV1['signal'];
export type CalibrationUnit='rad'|'rad/s'|'N*m'|'m'|'m/s';
export interface CalibrationSidecar {
 sourceKind:'measured'|'synthetic';/** present means a tool wrote the file: it can never be `measured` */generator?:string;
 deviceId:string;configDigest:string;clockDomain:CalibrationDataset['clockMapping']['domain'];clockOffsetNs:number;
 units:Record<string,CalibrationUnit>;uncertainty:Record<string,number>;policy:CalibrationDataset['policy'];
 attestation?:{operator:string;instrument:string;recordedAt:string};
 trials:{trialId:string;split:'tune'|'validation';condition:string;file:string;axisId:string;signal:BenchSignal}[];
}
/** The row cap is the dataset schema's (maxItems 100,000 per trial array): a longer log could not be assessed. */
export const CALIBRATION_LOG_LIMITS={rows:100_000,bytes:16*1024*1024} as const;
const NUMBER=/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,INTEGER=/^-?\d+$/;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const isObject=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);

export type ParsedCsv={ok:true;timesNs:number[];channels:Record<string,number[]>}|{ok:false;issues:string[]};
export function parseCalibrationCsv(text:string,channels:readonly string[]):ParsedCsv{
 if(Buffer.byteLength(text)>CALIBRATION_LOG_LIMITS.bytes)return {ok:false,issues:['LOG_TOO_LARGE']};
 const lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
 if(lines.length-1>CALIBRATION_LOG_LIMITS.rows)return {ok:false,issues:['LOG_TOO_LARGE']};
 const header=(lines[0]??'').split(',');
 if(header[0]!=='time_ns'||new Set(header).size!==header.length)return {ok:false,issues:['HEADER_INVALID']};
 const issues:string[]=[],columns=header.slice(1);
 for(const c of channels)if(!columns.includes(c))issues.push(`CHANNEL_MISSING:${c}`);
 for(const c of columns)if(!channels.includes(c))issues.push(`CHANNEL_UNDECLARED:${c}`);
 if(issues.length)return {ok:false,issues};
 if(lines.length<2)return {ok:false,issues:['LOG_EMPTY']};
 const timesNs:number[]=[],out:Record<string,number[]>=Object.fromEntries(columns.map(c=>[c,[]]));
 let invalid=false,monotonic=true;
 for(const line of lines.slice(1)){
  const cells=line.split(',');
  if(cells.length!==header.length){invalid=true;continue;}
  const t=INTEGER.test(cells[0]!)?Number(cells[0]):NaN;
  if(!Number.isSafeInteger(t))invalid=true;
  else{if(timesNs.length&&t<=timesNs.at(-1)!)monotonic=false;timesNs.push(t);}
  columns.forEach((c,k)=>{const cell=cells[k+1]!,v=NUMBER.test(cell)?Number(cell):NaN;if(Number.isFinite(v))out[c]!.push(v);else invalid=true;});
 }
 if(invalid)issues.push('VALUE_INVALID');
 if(!monotonic)issues.push('TIME_NOT_MONOTONIC');
 return issues.length?{ok:false,issues}:{ok:true,timesNs,channels:out};
}

const unsafePath=(file:unknown)=>typeof file!=='string'||!file||file.includes('\0')||file.includes('\\')||file.startsWith('/')||/^[A-Za-z]:/.test(file)||file.split('/').some(p=>p===''||p==='..'||p==='.');
function shapeOk(s:unknown):s is CalibrationSidecar{
 if(!isObject(s)||!['measured','synthetic'].includes(s.sourceKind as string))return false;
 if(typeof s.deviceId!=='string'||typeof s.configDigest!=='string'||!['sim','wall','instrument'].includes(s.clockDomain as string)||!Number.isSafeInteger(s.clockOffsetNs))return false;
 if(!isObject(s.units)||!Object.values(s.units).every(u=>typeof u==='string')||!isObject(s.uncertainty)||!Object.values(s.uncertainty).every(u=>typeof u==='number'&&Number.isFinite(u)&&u>=0))return false;
 if(!isObject(s.policy)||!isObject(s.policy.channels))return false;
 if(s.generator!==undefined&&typeof s.generator!=='string')return false;
 if(s.attestation!==undefined&&!(isObject(s.attestation)&&['operator','instrument','recordedAt'].every(k=>typeof (s.attestation as Record<string,unknown>)[k]==='string')))return false;
 return Array.isArray(s.trials)&&s.trials.length>0&&s.trials.every(t=>isObject(t)&&['trialId','condition','file','axisId'].every(k=>typeof t[k]==='string')&&['tune','validation'].includes(t.split as string)&&isObject(t.signal));
}
/** Sidecar first (cheap, no file read), then every file; issues of a bad file carry its name so the person who measured knows which one to fix. */
export async function importCalibrationLog(sidecar:unknown,readText:(file:string)=>Promise<string>):Promise<{ok:true;dataset:CalibrationDataset;sidecar:CalibrationSidecar}|{ok:false;issues:string[]}>{
 if(!shapeOk(sidecar))return {ok:false,issues:['SIDECAR_INVALID']};
 const s=sidecar;
 if(s.trials.some(t=>unsafePath(t.file)))return {ok:false,issues:['LOG_PATH_REJECTED']};
 const issues:string[]=[],channels=[...new Set([...Object.keys(s.policy.channels),...Object.keys(s.units)])];
 if(s.sourceKind==='measured'){
  const a=s.attestation;if(!a||!a.operator.trim()||!a.instrument.trim()||!a.recordedAt.trim())issues.push('ATTESTATION_REQUIRED');
  if(s.generator!==undefined)issues.push('GENERATED_DATA_NOT_MEASURED');
 }
 for(const c of channels){if(!s.units[c])issues.push(`UNIT_MISSING:${c}`);}
 for(const c of Object.keys(s.policy.channels))if(s.uncertainty[c]===undefined)issues.push(`UNCERTAINTY_MISSING:${c}`);
 const ids=s.trials.map(t=>t.trialId),files=s.trials.map(t=>t.file);
 if(new Set(ids).size!==ids.length||new Set(files).size!==files.length)issues.push('CALIBRATION_SPLIT_LEAKAGE');
 if(issues.length)return {ok:false,issues};
 const trials:CalibrationDataset['trials']=[],raw:[string,string][]=[];
 for(const t of s.trials){
  let text:string;try{text=await readText(t.file);}catch{issues.push(`${t.file}:LOG_UNREADABLE`);continue;}
  const r=parseCalibrationCsv(text,channels);
  if(!r.ok){issues.push(...r.issues.map(i=>`${t.file}:${i}`));continue;}
  raw.push([t.file,sha(text)]);trials.push({trialId:t.trialId,split:t.split,condition:t.condition,timesNs:r.timesNs,channels:r.channels});
 }
 if(issues.length)return {ok:false,issues};
 const dataset:CalibrationDataset={schemaVersion:1,configDigest:s.configDigest,instrument:{id:s.attestation?.instrument??s.deviceId,revision:s.attestation?.recordedAt??'synthetic'},units:{...s.units},
  clockMapping:{domain:s.clockDomain,offsetNs:s.clockOffsetNs},uncertainty:{...s.uncertainty},rawDigest:sha(JSON.stringify(raw)),sourceKind:s.sourceKind,policy:structuredClone(s.policy),trials};
 return isCalibrationDataset(dataset)?{ok:true,dataset,sidecar:s}:{ok:false,issues:['DATASET_SCHEMA_INVALID']};
}
