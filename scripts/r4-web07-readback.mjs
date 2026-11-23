import {createHash} from 'node:crypto';
import {productionAssetDependencies} from './production-assets.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),hex=/^[a-f0-9]{64}$/;
export const WEB07_PANELS={control:'e2e-control',faults:'e2e-faults',tray:'e2e-tray',belief:'e2e-belief',calibration:'e2e-calibration','fault-composer':'e2e-faults','perception-study':'e2e-belief',recovery:'e2e-belief'};
const targets={control:['control-bench'],faults:['fault-evidence'],tray:['tray-hint'],belief:['belief-legend'],calibration:['calibration-record','calibration-fitted','calibration-residuals','calibration-domain','calibration-plot'],'fault-composer':['drive-faults','fault-timeline'],'perception-study':['perception-study','perception-study-rows'],recovery:['perception-recovery']};
function production(read,base,record){
 const bytes=read(base+'production-ui.json');if(!bytes)return {issue:'PRODUCTION_MISSING'};
 try{
  const p=JSON.parse(bytes),source=record.identity?.before?.sourceCommit,lab=record.lab,pin=lab?.pin;
  if(p.schemaVersion!==1||p.kind!=='lab-production-ui'||p.labDirty!==false||!source||!lab?.commit||p.labCommit!==lab.commit||p.sourceCommit!==source||p.runtimeArtifact!==pin?.artifactSha256||p.schemaHash!==pin?.schemaHash||!hex.test(p.runtimeArtifact)||!hex.test(p.schemaHash)||!Array.isArray(p.files))throw Error();
  const paths=p.files.map(f=>f.path);if(new Set(paths).size!==paths.length||!paths.includes('index.html')||!paths.includes('source-runtime.lock.json'))throw Error();
  for(const f of p.files){
   if(!/^(?:index\.html|source-runtime\.lock\.json|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(f.path)||!hex.test(f.sha256))throw Error();
   const b=read(base+'production-ui/'+f.path);if(!b||sha(b)!==f.sha256||b.length!==f.bytes)throw Error();
   if(f.path.endsWith('.js')&&productionAssetDependencies(f.path,b).some(path=>!paths.includes(path)))throw Error();
  }
  const index=read(base+'production-ui/index.html').toString(),entries=[...index.matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g)].map(m=>m[1].slice(1));
  if(index.includes('/@vite/client')||!entries.some(p=>p.endsWith('.js'))||entries.some(p=>!paths.includes(p)))throw Error();
  const builtPin=JSON.parse(read(base+'production-ui/source-runtime.lock.json'));
  if(builtPin.sourceCommit!==source||builtPin.artifactSha256!==p.runtimeArtifact||builtPin.schemaHash!==p.schemaHash||builtPin.dirty!==false||!hex.test(pin.portableToolsDigest)||builtPin.portableToolsDigest!==pin.portableToolsDigest)throw Error();
  return {sha256:sha(bytes)};
 }catch{return {issue:'PRODUCTION_INVALID'};}
}
export function verifyWeb07Record(read,record){
 const issues=[];
 for(const [panel,suite] of Object.entries(WEB07_PANELS)){
  const base=`suites/${suite}/screens/`,primary=read(base+`web07-${panel}.json`);
  if(!primary){issues.push('WEB07_ROWS_MISSING:'+panel);continue;}
  const build=production(read,base,record);if(build.issue){issues.push('WEB07_'+build.issue+':'+panel);continue;}
  for(const state of panel==='calibration'?['populated','empty','error']:['populated']){
   const name=panel+(state==='populated'?'':'-'+state),bytes=state==='populated'?primary:read(base+`web07-${name}.json`);
   if(!bytes){issues.push('WEB07_ROWS_MISSING:'+name);continue;}
   let d;try{d=JSON.parse(bytes);if(!Array.isArray(d.rows)||d.rows.length!==9)throw Error();}catch{issues.push('WEB07_ROWS_CORRUPT:'+name);continue;}
   const ids=state==='populated'?targets[panel]:['calibration-'+state];
   if(d.schemaVersion!==1||d.panel!==panel||d.state!==state||d.testId!==ids[0]||JSON.stringify(d.requiredTestIds)!==JSON.stringify(ids))issues.push('WEB07_TARGET_INVALID:'+name);
   if(d.productionSha256!==build.sha256)issues.push('WEB07_BUILD_BINDING:'+name);
   const got=new Map(d.rows.map(e=>[[e?.lang,e?.width].join('/'),e]));
   if(got.size!==9)issues.push('WEB07_ROWS_CORRUPT:'+name);
   for(const l of ['vi','ja','en'])for(const w of [390,1024,1440]){const e=got.get(l+'/'+w);
    if(!e||e.panel!==panel)issues.push(`WEB07_CELL_UNMEASURED:${name}/${l}/${w}`);
    else if(e.axeSeriousCritical!==0||!Array.isArray(e.axeIds)||e.axeIds.length||e.reducedMotion!==true||e.horizontalScroll!==false||e.populated!==(state==='populated')||e.productionSha256!==build.sha256)issues.push(`WEB07_CELL_FAILED:${name}/${l}/${w}`);
   }
  }
 }
 return [...new Set(issues)];
}
