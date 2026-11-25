import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const seal=(v,key)=>({...v,[key]:hash(JSON.stringify(canonical(Object.fromEntries(Object.entries(v).filter(([k])=>k!==key)))))});
/** What the tray fixture shares with serve-payload-v1 stays byte for byte the same file. */
const COMMON=['serve-3d-project.json','serve-3d-components.json','physical-model-amr-1.json','world3d.json','assumptions.json','drive-contact-profile.json'];
/** Cup positions in the tray (support) frame, R4-A 7.4; revised with a new revision, never forced to the centre, when the feasibility check fails. */
const LAYOUT=[[-0.1,-0.09],[0.1,-0.09],[0,0.1]];
const LOW={cupSliding:0.15,traySliding:0.15};
/** Deterministically generate the three-cup tray fixture from the committed serve-payload-v1 files; no engine execution (the compile and readback checks are python/tests/test_tray.py). */
export async function generateTrayFixture(outDir,payloadDir=join(root,'robotics/simulation-mujoco/fixtures/serve-payload-v1')){
 const files=new Map(),json=(name,v)=>files.set(name,JSON.stringify(v,null,2)+'\n');
 for(const n of COMMON)files.set(n,await readFile(join(payloadDir,n),'utf8'));
 const center=JSON.parse(await readFile(join(payloadDir,'cup-center.json'),'utf8')),cup=center.props[0],support=center.supports[0],poly=support.polygonM;
 const assumed=(locator)=>({kind:'assumed',documentId:'serve-payload-v1/assumptions.json',revision:'1',locator,contentSha256:hash(files.get('assumptions.json'))});
 const profile=(id,sliding)=>seal({...center,id,digest:'',supports:[support],props:LAYOUT.map(([x,y],i)=>({...cup,propId:`cup-${i+1}`,friction:{...cup.friction,sliding},sources:{...cup.sources,attachment:{...cup.sources.attachment,locator:'cup-triple layout (R4-A 7.4): three free cups on amr-1/tray-1'}},attachment:{kind:'free',supportId:support.supportId,initialPoseInSupport:{positionM:[x,y,cup.geometry.heightM/2],quaternionXyzw:[0,0,0,1]}}})),assumptions:center.assumptions},'digest');
 json('cup-triple.json',profile('cup-triple',0.6));
 json('cup-triple-low-friction.json',profile('cup-triple-low-friction',LOW.cupSliding));
 // the tray face of the pair is the physics profile's default contact friction (the engine takes the larger of the two faces), so the low profile lowers that too
 const base=JSON.parse(files.get('drive-contact-profile.json')),keys=['tickMs','timestepMs','substeps','integrator','solver','velocityGainNmsPerRad','brakeTorqueNm','driveCurve','contact','numerics'];
 const lowProfile={...base,id:'drive-contact-tray-low-v1',contact:{...base.contact,sliding:LOW.traySliding}};
 lowProfile.measurementLock={...base.measurementLock,probeId:'v10-tray-low-friction',numericalInputSha256:hash(JSON.stringify(canonical(Object.fromEntries(keys.map(k=>[k,lowProfile[k]]))))) };
 lowProfile.digest=hash(JSON.stringify(canonical(Object.fromEntries(Object.entries(lowProfile).filter(([k])=>k!=='digest')))));
 json('drive-contact-tray-low-v1.json',lowProfile);
 json('registered-physics.json',{'drive-contact-tray-low-v1':{sha256:hash(files.get('drive-contact-tray-low-v1.json')),digest:lowProfile.digest,probeId:'v10-tray-low-friction'}});
 json('tray-policy-v1.json',{schemaVersion:1,id:'tray-policy-v1',revision:1,calibration:'not_calibrated',slipWarnM:0.005,slipFailM:0.02,slipEpsilonM:0.005,slipWindowTicks:25,accelerationWindowTicks:3,episodeGapTicks:25,accelerationToleranceBelowMps2:0.5,accelerationToleranceAboveMps2:0.3,onsetLeadTicks:5,onsetLagTicks:40,gravityMps2:9.81,
  loadFell:'LOAD_FELL by serve-mobile-stop-v1',note:'Experiment thresholds, not safety limits. Slip is read over a trailing window of slipWindowTicks (0.5 s) because MuJoCo friction is soft: a cup creeps about 1 mm per window, and some 40 mm over a 110 s mission, far inside the friction cone, while a sliding cup moves centimetres per window. A windowed slip above slipWarnM is reported, above slipFailM fails the variant; the cumulative drift is reported beside it and judged by nothing. The oracle tolerances say how close to the Coulomb crossing an onset must be: MuJoCo friction is soft, so a cup begins to creep before the hard bound mu*g (windows of 8 mm were measured at 0.77 of it) and never after; the tolerance below the bound is therefore 0.5 m/s2 and the one above 0.3. Nothing is claimed inside the band. Each cup is judged at the point of the tray under it, episode by episode (episodes closer than episodeGapTicks are one): a slip must fall in an episode of its own cup, and an episode above the bound must hold a slip.',
  sources:{thresholds:assumed('slip thresholds and oracle tolerances: explicit uncalibrated starting assumptions')}});
 json('actor-proxy-v1.json',{schemaVersion:1,id:'actor-proxy-v1',revision:1,calibration:'not_calibrated',shape:'box',footprint:'square of side 2*radiusM, kinematic (mocap)',heightM:1.7,collision:'as a static solid: the LiDAR sees it and a robot contact is reported as an unexpected collision',
  sources:{shape:assumed('scripted person proxy: a standing person as a box of the scenario actor radius and 1.7 m')}});
 // geometry of each layout: cup-cup and cup-edge distances (the worker compile and the readback of the pair are python/tests/test_tray.py)
 const clearance=(p)=>Math.min(...poly.map((v,i)=>{const w=poly[(i+1)%poly.length],e=[w[0]-v[0],w[1]-v[1]],n=Math.hypot(...e);return (e[0]*(p[1]-v[1])-e[1]*(p[0]-v[0]))/n;}))-cup.geometry.radiusM;
 const pair=Math.min(...LAYOUT.flatMap((a,i)=>LAYOUT.slice(i+1).map(b=>Math.hypot(a[0]-b[0],a[1]-b[1]))));
 json('feasibility.json',{schemaVersion:1,accepted:false,calibration:'not_calibrated',supportId:support.supportId,polygonM:poly,
  layouts:[['cup-triple',0.6,0.6],['cup-triple-low-friction',LOW.cupSliding,LOW.traySliding]].map(([id,cupSliding,traySliding])=>({id,cupsInTrayFrameM:LAYOUT,cupRadiusM:cup.geometry.radiusM,cupCupMinCenterDistanceM:pair,cupEdgeMinClearanceM:Math.min(...LAYOUT.map(clearance)),cupSliding,traySliding,effectiveFriction:Math.max(cupSliding,traySliding),rule:'engine takes the larger friction of the two faces'}))});
 files.set('NOTICE','serve-tray-v1\nFirst-party Serve fixture inputs. The files listed as shared are copied byte-for-byte from serve-payload-v1; the cup layout, friction pair, policy thresholds and actor proxy are assumed experiment inputs, not_calibrated.\nNo vendor mesh or code is redistributed.\n');
 files.set('README.md','# Serve tray fixture v1\n\nGenerate with `node scripts/generate-tray-fixture.mjs [out-dir]`. Three free cups (cup-1..3, 0.32 kg, r 0.04 m) on `amr-1/tray-1`, in two friction variants. The AMR, project, components, world and the nominal drive-contact profile are byte for byte those of `serve-payload-v1`. Friction is one input that lowers the cups and the tray contact together (`drive-contact-tray-low-v1`), because the engine takes the larger friction of the two faces; `feasibility.json` records the geometry and the effective pair friction, and `robotics/simulation-mujoco/tests/test_tray.py` compiles each layout and reads the pair friction back from the model. `tray-policy-v1.json` holds the experiment thresholds and the oracle tolerances (assumed); `actor-proxy-v1.json` declares the box that stands for a person. Everything is `not_calibrated`; nothing here enables a runtime backend.\n');
 json('manifest.json',{schemaVersion:1,documentType:'tray-fixture-manifest',id:'serve-tray-v1',generator:'scripts/generate-tray-fixture.mjs',calibration:'not_calibrated',files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,text])=>({path,sha256:hash(text),bytes:Buffer.byteLength(text)}))});
 await mkdir(outDir,{recursive:true});for(const [name,text] of files)await writeFile(join(outDir,name),text);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateTrayFixture(resolve(process.argv[2]??join(root,'robotics/simulation-mujoco/fixtures/serve-tray-v1')));
