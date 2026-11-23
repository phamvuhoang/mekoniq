// WEB09 (V16): frame p95 of the production build with a 5,000-sample plot and the belief layer. The reader recomputes p95 from the stored raw intervals; a stated percentile is never trusted.
import {afterAll,expect,test} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {verifyWeb09Record} from '../../scripts/r4-web09-readback.mjs';
// @ts-expect-error plain ESM script without types
import {verifyWebRecord} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script without types
import {SUITES_R4,CASES_R4} from '../../scripts/sim-extension-r4.mjs';

const dirs:string[]=[];afterAll(()=>{for(const d of dirs)rmSync(d,{recursive:true,force:true});});
const sha=(b:string)=>createHash('sha256').update(b).digest('hex'),SRC='a'.repeat(40),LAB='b'.repeat(40),PIN={artifactSha256:'c'.repeat(64),schemaHash:'d'.repeat(64),portableToolsDigest:'e'.repeat(64)};
const BASE='suites/e2e-perf/screens/';
const put=(root:string,file:string,doc:unknown)=>{const text=typeof doc==='string'?doc:JSON.stringify(doc);mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);return {sha256:sha(text)};};
const intervals=(n=3700,ms=16.7)=>Array.from({length:n},(_,i)=>i%50===0?ms*1.5:ms);
const probe=(o:Record<string,unknown>={})=>({elapsedMs:61800,intervalsMs:intervals(),longTasksMs:[],beliefFrames:0,visibilityState:'visible',userAgent:'Chrome',devicePixelRatio:2,webglRenderer:'Apple M',...o});
function fixture(o:{doc?:Record<string,unknown>;plot?:Record<string,unknown>;belief?:Record<string,unknown>;plotWork?:Record<string,unknown>;beliefWork?:Record<string,unknown>;receipt?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'r4-web09-'));dirs.push(root);
 const files=Object.entries({'index.html':'<script type="module" src="/assets/main.js"></script>','source-runtime.lock.json':JSON.stringify({sourceCommit:SRC,...PIN,dirty:false}),'assets/main.js':'document.body.textContent="fixture";'}).map(([path,bytes])=>{put(root,BASE+'production-ui/'+path,bytes);return {path,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};});
 const receipt=put(root,BASE+'production-ui.json',{schemaVersion:1,kind:'lab-production-ui',labCommit:LAB,labDirty:false,sourceCommit:SRC,runtimeArtifact:PIN.artifactSha256,schemaHash:PIN.schemaHash,files});
 const frames=intervals();
 const doc={schemaVersion:1,kind:'web09-frame-timing',productionSha256:receipt.sha256,limitMs:33,minimumDurationMs:60000,viewport:{width:1440,height:900},scenarios:[
  {id:'plot-5000',workload:{runId:'run-bench',samplesPerSeries:5000,plottedPoints:5000,...o.plotWork},...probe(o.plot)},
  {id:'belief-layer',workload:{runId:'run-cell',beliefRecords:120,replayHorizonTick:2100,firstTick:20,view:'3d',...o.beliefWork},...probe({beliefFrames:frames.length,...o.belief})}],...o.doc};
 put(root,BASE+'web09.json',doc);
 const record={identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:{sourceCommit:SRC,...PIN}}};
 return {root,record};
}
const reader=(root:string)=>(p:string)=>{try{return readFileSync(join(root,p));}catch{return null;}};

test('WEB09 passes with both scenarios inside the R2b target, a 5,000-sample plot and a belief layer drawn in nearly every frame',()=>{
 const f=fixture();expect(verifyWeb09Record(reader(f.root),f.record)).toEqual([]);
});
test('WEB09 is missing without a measurement and the suite is part of the R4 table',()=>{
 const f=fixture();rmSync(join(f.root,BASE+'web09.json'));expect(verifyWeb09Record(reader(f.root),f.record)).toEqual(['WEB09_MEASUREMENT_MISSING']);
 expect(SUITES_R4.find((s:{id:string})=>s.id==='e2e-perf').command).toContain('--production-ui');
 expect(CASES_R4.WEB09.suites).toContain('e2e-perf');
});
test('WEB09 recomputes p95 from the raw intervals: a slow tail fails even when nothing else does',()=>{
 const slow=[...intervals(3700),...Array(300).fill(60)];
 const f=fixture({plot:{intervalsMs:slow}});expect(verifyWeb09Record(reader(f.root),f.record)).toEqual(['WEB09_P95_OVER_LIMIT:plot-5000']);
 const g=fixture({belief:{intervalsMs:slow,beliefFrames:slow.length}});expect(verifyWeb09Record(reader(g.root),g.record)).toEqual(['WEB09_P95_OVER_LIMIT:belief-layer']);
});
test('WEB09 needs a full 60 s window of enough frames, a visible page and sane numbers',()=>{
 for(const [patch,code] of [[{intervalsMs:intervals(1500)},'WEB09_WINDOW_SHORT'],[{elapsedMs:30000},'WEB09_WINDOW_SHORT'],[{intervalsMs:[...intervals(3700),-1]},'WEB09_INTERVALS_INVALID'],[{intervalsMs:[...intervals(3700),'x']},'WEB09_INTERVALS_INVALID'],[{visibilityState:'hidden'},'WEB09_PAGE_HIDDEN']] as [Record<string,unknown>,string][]){
  const f=fixture({plot:patch});expect(verifyWeb09Record(reader(f.root),f.record),code).toContain(code+':plot-5000');
 }
 // a window of 80 frames of 800 ms is 64 s long but not a frame measurement
 const f=fixture({plot:{intervalsMs:Array(80).fill(800)}});expect(verifyWeb09Record(reader(f.root),f.record).join()).toMatch(/WEB09_(FRAME_COUNT|P95_OVER_LIMIT):plot-5000/);
});
test('WEB09 measures the workload it claims: 5,000 plotted points, belief drawn in at least 80% of the frames',()=>{
 for(const work of [{samplesPerSeries:4000,plottedPoints:4000},{plottedPoints:4999}]){const f=fixture({plotWork:work});expect(verifyWeb09Record(reader(f.root),f.record)).toContain('WEB09_PLOT_WORKLOAD:plot-5000');}
 const g=fixture({belief:{beliefFrames:100}});expect(verifyWeb09Record(reader(g.root),g.record)).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
 const h=fixture({beliefWork:{beliefRecords:0}});expect(verifyWeb09Record(reader(h.root),h.record)).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
});
test('WEB09 is bound to the production build of this tuple and to its own limit',()=>{
 const f=fixture({doc:{productionSha256:'f'.repeat(64)}});expect(verifyWeb09Record(reader(f.root),f.record)).toContain('WEB09_BUILD_BINDING');
 const g=fixture({doc:{limitMs:60}});expect(verifyWeb09Record(reader(g.root),g.record)).toContain('WEB09_TARGET_INVALID');
 const h=fixture();put(h.root,BASE+'production-ui/assets/main.js','substituted');expect(verifyWeb09Record(reader(h.root),h.record)).toEqual(['WEB09_PRODUCTION_INVALID']);
 const i=fixture({doc:{scenarios:[]}});expect(verifyWeb09Record(reader(i.root),i.record)).toContain('WEB09_SCENARIOS_INVALID');
});
test('verifyWebRecord reports WEB09 through this reader, no longer as a constant',async()=>{
 const f=fixture();const web=await verifyWebRecord(f.root,f.record);expect(web.WEB09).toEqual([]);
 rmSync(join(f.root,BASE+'web09.json'));expect((await verifyWebRecord(f.root,f.record)).WEB09).toEqual(['WEB09_MEASUREMENT_MISSING']);
});
