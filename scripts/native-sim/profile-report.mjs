import {isSha256 as sha,nativeInventoryIssues} from './native-inventory.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const strings=v=>Array.isArray(v)&&v.every(x=>typeof x==='string');
export function validNativeProfileReport(v,id,expected){
 if(expected!==undefined)return v?.profileId===id&&expected?.profile?.id===id&&nativeInventoryIssues(v,expected).length===0;
 if(!object(v)||v.id!==id||typeof v.available!=='boolean'||!strings(v.reasonCodes))return false;
 if(!v.available)return v.reasonCodes.length>0;
 if(v.reasonCodes.length||!sha(v.profileSha256)||!sha(v.inventorySha256)||v.installation!=='native_apt'||v.image!==null||v.headless!==true)return false;
 const a=v.actual,r=a?.runtime;
 if(/^engineering-(amd64|arm64)$/.test(id))return object(a)&&a.platform==='linux'&&a.arch===id.slice(12)&&a.os==='ubuntu24.04'&&object(a.packages)&&Object.keys(a.packages).length>0&&object(a.digests)&&Object.keys(a.digests).length>0&&Object.entries(a.digests).every(([p,d])=>p.startsWith('/')&&sha(d))&&object(a.aptProvenance?.sources)&&Object.keys(a.aptProvenance.sources).length>0&&Object.values(a.aptProvenance.sources).every(sha)&&object(r)&&r.rosDistro==='jazzy'&&strings(r.amentPrefixes)&&object(r.overlayManifests)&&Object.values(r.overlayManifests).every(sha)&&!r.overlayError&&['pythonPath','libraryPath','gazeboPluginPath'].every(k=>typeof r[k]==='string')&&['ros2','gz','python3'].every(k=>object(r.executables?.[k])&&typeof r.executables[k].path==='string'&&r.executables[k].path.startsWith('/')&&sha(r.executables[k].sha256));
 return object(a)&&a.platform==='linux'&&a.architecture==='arm64'&&a.os?.id==='ubuntu'&&a.os.version==='24.04'&&object(a.packages)&&Object.keys(a.packages).length>0&&Object.values(a.packages).every(x=>typeof x==='string'&&x.length>0)&&object(r)&&r.rosDistro==='jazzy'&&strings(r.amentPrefixes)&&object(r.overlayManifests)&&Object.values(r.overlayManifests).every(sha)&&['pythonPath','libraryPath','gazeboPluginPath'].every(k=>typeof r[k]==='string')&&['ros2','gz'].every(k=>object(r.executables?.[k])&&typeof r.executables[k].path==='string'&&r.executables[k].path.startsWith('/')&&sha(r.executables[k].sha256));
}
