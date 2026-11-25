import {test,expect,type Page} from '@playwright/test';
// U05 (D51, SX-57) in a real browser, without a runtime: the 3D view mounted alone with the xArm coffee cell and a few mujoco_arm samples. The mock launcher
// never produces mujoco_arm samples, so the launcher-level check of a real MJ-BV01 run belongs to the next task (U06).
// node scripts/test-mock-e2e.mjs arm-mesh.spec.ts, or pnpm exec playwright test arm-mesh.spec.ts (which starts pnpm dev).
// LAB_EVIDENCE_DIR=<dir>: also save PNGs of the view (mesh arm at home, at the pick with the gripper closed on a cup, the fallback with its problems list).
const shots=process.env.LAB_EVIDENCE_DIR,shots2=process.env.LAB_EVIDENCE_DIR_2??shots;
// waypoints of the fixture's programs.json (xarm6-g2-v1, source repo; not copied into the Lab): home, and the pick where the TCP holds the cup
const HOME=[-4.93613604879e-10,-1.14779631171,-0.324460234973,-3.14159266066,0.098539780113,7.05694566235e-09];
const PICK=[-3.61465593187e-16,0.130550805606,-0.358580734739,-3.14159265359,1.34276639765,-3.6678410097e-16];
// the cup centre at the pick in the map: the base at (2.65, 0.65, 0.7) plus the cup on the nozzle stand (0.49, 0, 0.15) of the cell layout
const CUP:[number,number,number]=[3.14,0.65,0.85];
type Opts={q:number[];opening:number|null;cup?:[number,number,number]|null;selected?:string|null;/** a plant cup the view does not list */extraCup?:boolean};
/** Mount the view on a fixed host and expose draw(opts) (one update with fresh samples) on window. */
async function mount(page:Page){
 await page.goto('/');
 await page.evaluate(async()=>{
  const [t3,{presets},proj,{defaultLayers},pr,rb]=await Promise.all([import('/src/viewer/twin3d.ts' as string),import('/src/scenarios/catalog.ts' as string),import('/fixtures/engineering/xarm6-g2-v1/coffee-cell-project.json' as string),import('/src/twin/overlays.ts' as string),import('/src/ui/problems.ts' as string),import('/src/ui/run-bar.ts' as string)]) as [typeof import('../../src/viewer/twin3d'),typeof import('../../src/scenarios/catalog'),{default:unknown},typeof import('../../src/twin/overlays'),typeof import('../../src/ui/problems'),typeof import('../../src/ui/run-bar')];
  const host=document.createElement('div');host.id='u05';host.style.cssText='position:fixed;inset:0 auto auto 0;width:900px;height:560px;z-index:99999;background:#0b1418;display:grid;grid-template-columns:900px';
  const stage=document.createElement('div');stage.style.cssText='width:900px;height:560px';host.append(stage);document.body.append(host);
  const w=window as unknown as Record<string,unknown>;w.armMeshChanges=0;
  const make=()=>t3.mountTwin3d(stage,()=>{},()=>{w.webglFailed=true;},()=>{w.armMeshChanges=(w.armMeshChanges as number)+1;})!;let v=make();
  /** Dispose the view and mount a new one on the same stage, as the workspace does on a 2D → 3D toggle. */
  w.remount=()=>{v.dispose();v=make();};w.dispose=()=>v.dispose();
  /** The cached (page-wide) mesh geometry: how many there are, and the `dispose` listeners renderers left on them (three's EventDispatcher `_listeners`). */
  w.listeners=()=>{const n:number[]=[];t3.cachedArmMeshes()?.group.traverse(o=>{const g=(o as unknown as {geometry?:{_listeners?:Record<string,unknown[]>}}).geometry;if(g)n.push(g._listeners?.dispose?.length??0);});return {geometries:n.length,max:Math.max(0,...n),total:n.reduce((a,b)=>a+b,0)};};
  /** Break the cached mesh set so dressing an arm with it throws (the guard must leave the joint chain and the note). */
  w.sabotage=()=>{t3.cachedArmMeshes()!.links.length=0;};
  /** The run bar and its problems panel as the page draws them, from a synthetic list: `problems` attention rows and `notes` arm-mesh notes. */
  w.bar=(problems:number,notes:number,open:boolean)=>{
   const rows=[...Array.from({length:problems},(_,i)=>({id:`p${i}`,severity:'attention' as const,text:'Cup missing at the nozzle.',codes:['CUP_MISSING']})),...pr.armMeshProblems(Array.from({length:notes},()=>({entityId:'arm-1',code:'ARM_MESH_UNAVAILABLE' as const,detail:'ARM_MESH_UNAVAILABLE:479e88e779dcb811721d70ce0463c20cc22d8db196fa6c61af2e3f0d06c2dc28'})))];
   let el=document.getElementById('u05-bar');if(!el){el=document.createElement('div');el.id='u05-bar';el.className='twin-shell';el.style.cssText='position:fixed;left:0;top:0;width:1100px;height:420px;z-index:100000;background:var(--bg)';document.body.append(el);}
   el.innerHTML=rb.runBar({scenarioTitle:'MJ-BV01',runtime:{state:'live',label:'Live',detail:''},mode:'Simulation · not calibrated',status:'Running',simTimeS:12.3,served:'0',...pr.problemCounts(rows),primary:null,inspectorOpen:false},{problemsOpen:open,boxesHtml:pr.problemsPanel(rows,open)});
   return pr.problemCounts(rows);};
  const preset={...presets.find(p=>p.id==='coffee')!,project:proj.default as never};let seq=0;
  const frame=(o:Opts)=>{const sim=String(++seq*1e8),now=performance.now(),base={schemaVersion:2,runId:'r',bootId:'b',seq:String(seq),simTimeNs:sim,observedAt:null,receivedMonotonicNs:'0',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,estimated:null,causationId:null,receivedAtMs:now,epochResetAtMs:null,providerId:'mujoco_arm'};
   const samples:Record<string,unknown>={'arm-1':{...base,entityId:'arm-1',frameId:'arm_base',observed:{jointsRad:o.q,...o.opening===null?{}:{gripperOpeningM:o.opening}}}};
   if(o.cup)samples['cup-1']={...base,entityId:'cup-1',frameId:'map',observed:{positionM:o.cup,quaternionXyzw:[0,0,0,1],restingOn:'gripper',ownerKind:'arm',ownerId:'arm-1'}};
   if(o.extraCup)samples['cup-9']={...base,entityId:'cup-9',frameId:'map',observed:{positionM:[3.1,0.6,0.85],quaternionXyzw:[0,0,0,1],restingOn:'stand',ownerKind:'cell',ownerId:'coffee-1'}};
   return {preset,report:null,nowMs:now,samples,view:{entities:[],coffee:{jobs:[],cups:[{cupId:'cup-1',ownerKind:'arm',ownerId:'arm-1'}]}}} as never;};
  const vs=(o:Opts)=>({view:'3d' as const,layers:defaultLayers(),selected:o.selected??null});
  w.draw=(o:Opts)=>{const f=frame(o);v.update(f,vs(o));w.lastFrame=f;return {...v.canvas.dataset};};
  w.fit=(id:string)=>v.fit(id);
  w.problems=()=>{const p=pr.armMeshProblems(t3.armMeshIssues(w.lastFrame as never));const box=document.createElement('div');box.innerHTML=pr.problemsPanel(p,true);box.style.cssText='position:absolute;right:12px;top:12px;width:380px;color:#e8f0f0';host.append(box);return p.map(x=>x.codes);};
 });
}
const draw=(page:Page,o:Opts)=>page.evaluate(o=>(window as unknown as {draw:(o:unknown)=>DOMStringMap}).draw(o),o);
const data=(page:Page)=>page.evaluate(()=>({...(document.querySelector('#u05 canvas') as HTMLCanvasElement).dataset}));

test('the xArm is drawn from its meshes once loaded, swapped in place; the fingers follow the opening; the cup is at the plant\'s pose',async({page})=>{
 const stl:string[]=[];page.on('request',r=>{if(r.url().endsWith('.stl'))stl.push(r.url());});
 await mount(page);
 const first=await draw(page,{q:HOME,opening:null,cup:null});
 expect(first.armModel).toBe('chain');// the joint chain until the meshes are ready
 await page.waitForFunction(()=>(document.querySelector('#u05 canvas') as HTMLCanvasElement).dataset.armModel==='mesh',null,{timeout:20000});
 const swapped=await data(page);
 expect(swapped.armMeshLinks).toBe('14');expect(swapped.armFallback).toBe('');
 // the swap rebuilt nothing and did not move the camera
 expect(swapped.rebuilds).toBe(first.rebuilds);expect(swapped.camera).toBe(first.camera);
 expect(await page.evaluate(()=>(window as unknown as {armMeshChanges:number}).armMeshChanges)).toBe(1);
 console.log(`meshes loaded in ${swapped.armMeshMs} ms`);
 await page.evaluate(()=>(window as unknown as {fit:(id:string)=>void}).fit('arm-1'));
 if(shots)await page.locator('#u05').screenshot({path:`${shots}/U05-mesh-home.png`});
 // the fingers: open (unknown opening draws open), then closed on the cup; the cup at the sample's position
 const open=await draw(page,{q:PICK,opening:0.0889,cup:CUP}),closed=await draw(page,{q:PICK,opening:0.08,cup:CUP});
 expect(Number(open.gripperRad)).toBe(0);expect(Number(closed.gripperRad)).toBeGreaterThan(0.05);
 expect((await draw(page,{q:PICK,opening:null,cup:CUP})).gripperRad).toBe(open.gripperRad);
 const at=await draw(page,{q:PICK,opening:0.08,cup:CUP});
 (JSON.parse(at.cups!)['cup-1'] as number[]).forEach((v,k)=>expect(v).toBeCloseTo(CUP[k]!,4));
 // the cup going to its plant pose changes its drawing once: that object alone is redrawn, the scene is not rebuilt (U06)
 expect(at.redraws).toBe(String(Number(first.redraws)+1));expect(at.rebuilds).toBe(first.rebuilds);
 await page.evaluate(()=>(window as unknown as {fit:(id:string)=>void}).fit('arm-1'));
 if(shots)await page.locator('#u05').screenshot({path:`${shots}/U05-mesh-pick-closed.png`});
 // a rebuild (another selection) draws the meshes again from the loaded geometry: no new request; every request went to this page's origin
 const sel=await draw(page,{q:PICK,opening:0.08,cup:CUP,selected:'arm-1'});
 expect(Number(sel.rebuilds)).toBeGreaterThan(Number(at.rebuilds));expect(sel.armModel).toBe('mesh');
 const origin=new URL(page.url()).origin;
 expect(stl).toHaveLength(14);expect(stl.every(u=>u.startsWith(`${origin}/fixtures/xarm6-g2-v1/blobs/`))).toBe(true);
 expect((await page.request.get('/fixtures/xarm6-g2-v1/NOTICE')).ok()).toBe(true);
});
for(const how of ['blocked','altered'] as const)test(`meshes ${how}: the joint chain stays, ARM_MESH_UNAVAILABLE in the problems list, the view keeps drawing`,async({page})=>{
 let bad='';
 await page.route('**/fixtures/xarm6-g2-v1/blobs/*.stl',async r=>{
  if(how==='blocked')return r.fulfill({status:404,body:''});
  const res=await r.fetch(),body=Buffer.from(await res.body());if(!bad){bad=r.request().url();body[300]^=1;}// one blob's bytes no longer match its name
  return r.fulfill({response:res,body});
 });
 await mount(page);
 expect((await draw(page,{q:HOME,opening:null,cup:CUP})).armModel).toBe('chain');
 await page.waitForFunction(()=>(document.querySelector('#u05 canvas') as HTMLCanvasElement).dataset.armFallback==='ARM_MESH_UNAVAILABLE',null,{timeout:20000});
 const d=await data(page);
 expect(d.armModel).toBe('chain');expect(d.armMeshLinks).toBe('0');
 // still drawing: a new pose moves the chain and the cup
 const next=await draw(page,{q:PICK,opening:0.08,cup:CUP});expect(next.armModel).toBe('chain');(JSON.parse(next.cups!)['cup-1'] as number[]).forEach((v,k)=>expect(v).toBeCloseTo(CUP[k]!,4));
 expect(await page.evaluate(()=>(window as unknown as {problems:()=>string[][]}).problems())).toEqual([['ARM_MESH_UNAVAILABLE']]);
 await expect(page.locator('#u05 [data-testid="problem-row"][data-severity="notice"]')).toContainText('ARM_MESH_UNAVAILABLE');
 if(how==='altered')await expect(page.locator('#u05 [data-testid="problem-row"]')).toContainText(`ARM_MESH_UNAVAILABLE:${bad.split('/').pop()!.slice(0,12)}`);// the blob named, by the first 12 hex digits of its sha256
 await page.evaluate(()=>(window as unknown as {fit:(id:string)=>void}).fit('arm-1'));
 if(shots&&how==='blocked')await page.locator('#u05').screenshot({path:`${shots}/U05-fallback-problems.png`});
 // item 5: the note says which case it is; a failed fetch is tried again by the next mount, a sha256 that differs stays final for the page
 await expect(page.locator('#u05 [data-testid="problem-row"]').first()).toContainText(how==='blocked'?'không tải được file':'sha256 của file khác tên của nó');
 await page.unroute('**/fixtures/xarm6-g2-v1/blobs/*.stl');
 await page.evaluate(()=>(window as unknown as {remount:()=>void}).remount());await draw(page,{q:HOME,opening:null,cup:CUP});
 if(how==='blocked')await page.waitForFunction(()=>(document.querySelector('#u05 canvas') as HTMLCanvasElement).dataset.armModel==='mesh',null,{timeout:20000});
 else{await page.waitForTimeout(1500);expect((await data(page)).armModel).toBe('chain');}
});

const ev=<T,>(page:Page,f:string,...a:unknown[])=>page.evaluate(([f,a])=>(window as unknown as Record<string,(...x:unknown[])=>unknown>)[f as string]!(...(a as unknown[])),[f,a] as const) as Promise<T>;
const meshReady=(page:Page)=>page.waitForFunction(()=>(document.querySelector('#u05 canvas') as HTMLCanvasElement).dataset.armModel==='mesh',null,{timeout:20000});
test('disposing the view releases the shared mesh geometry: mount and dispose again and again, nothing accumulates',async({page})=>{
 type L={geometries:number;max:number;total:number};
 await mount(page);await draw(page,{q:HOME,opening:null,cup:CUP});await meshReady(page);
 const first=await ev<L>(page,'listeners'),gpu=(await data(page)).geometries;
 expect(first.geometries).toBe(14);expect(first.max).toBe(1);// drawn by one renderer: one listener per geometry
 for(let i=0;i<4;i++){
  await ev(page,'remount');
  // the disposed renderer left nothing on the cached geometry
  expect(await ev<L>(page,'listeners')).toEqual({geometries:14,max:0,total:0});
  const d=await draw(page,{q:HOME,opening:null,cup:CUP});expect(d.armModel).toBe('mesh');// from the cache, at once
  expect(await ev<L>(page,'listeners')).toEqual(first);
  expect(d.geometries).toBe(gpu);// the new renderer holds as many geometries as the first did
 }
 await ev(page,'dispose');expect((await ev<L>(page,'listeners')).total).toBe(0);
 console.log(`per mount: ${first.geometries} cached geometries with ${first.max} dispose listener each, renderer info.memory.geometries ${gpu}; after dispose: 0 listeners`);
});
test('a mesh set that cannot be dressed: the arm keeps its joint chain and the ARM_MESH_UNAVAILABLE note, never neither drawing',async({page})=>{
 await mount(page);await draw(page,{q:HOME,opening:null,cup:CUP});await meshReady(page);
 await ev(page,'sabotage');
 const d=await draw(page,{q:HOME,opening:null,cup:CUP,selected:'arm-1'});// a rebuild dresses the arm again from the cache
 expect(d.armModel).toBe('chain');expect(d.armFallback).toBe('ARM_MESH_UNAVAILABLE');
 expect(await ev<string[][]>(page,'problems')).toEqual([['ARM_MESH_UNAVAILABLE']]);
});
test('a plant cup the view does not list is counted in dataset.plantCupsDropped',async({page})=>{
 await mount(page);
 expect((await draw(page,{q:HOME,opening:null,cup:CUP})).plantCupsDropped).toBe('0');
 expect((await draw(page,{q:HOME,opening:null,cup:CUP,extraCup:true})).plantCupsDropped).toBe('1');
});
test('run bar: notes only is a neutral button labelled as notes that opens the same panel; with a problem the count is the problems',async({page})=>{
 await mount(page);
 const btn=page.locator('#u05-bar [data-action="twin-problems-toggle"]');
 expect(await ev(page,'bar',0,1,false)).toEqual({problems:0,notes:1});
 await expect(page.locator('#u05-bar [data-testid="problems-count"]')).toHaveCount(0);await expect(page.locator('#u05-bar [data-testid="notes-count"]')).toHaveText(/1/);
 await expect(btn).toHaveClass(/notes-only/);
 const color=await btn.evaluate(b=>getComputedStyle(b).color),amber=await page.evaluate(()=>{const s=document.createElement('span');s.style.color='var(--amber)';document.body.append(s);const c=getComputedStyle(s).color;s.remove();return c;});
 expect(color).not.toBe(amber);
 if(shots2)await page.locator('#u05-bar .twin-runbar').screenshot({path:`${shots2}/U05-runbar-notes-only.png`});
 await ev(page,'bar',0,1,true);await expect(page.locator('#u05-bar [data-testid="problems-panel"]')).toBeVisible();
 await expect(page.locator('#u05-bar [data-testid="problem-row"][data-severity="notice"]')).toContainText('ARM_MESH_UNAVAILABLE');
 if(shots2)await page.locator('#u05-bar').screenshot({path:`${shots2}/U05-runbar-notes-panel.png`});
 expect(await ev(page,'bar',1,1,false)).toEqual({problems:1,notes:1});
 await expect(page.locator('#u05-bar [data-testid="problems-count"]')).toContainText('1');await expect(btn).not.toHaveClass(/notes-only/);
 await expect(page.locator('#u05-bar [data-testid="notes-count"]')).toHaveCount(1);
 if(shots2)await page.locator('#u05-bar .twin-runbar').screenshot({path:`${shots2}/U05-runbar-problem-and-note.png`});
 await ev(page,'bar',1,1,true);
 await expect(page.locator('#u05-bar [data-testid="problem-row"]')).toHaveCount(2);
 await expect(page.locator('#u05-bar [data-testid="problem-row"]').last()).toHaveAttribute('data-severity','notice');// notes after the problems
 if(shots2)await page.locator('#u05-bar').screenshot({path:`${shots2}/U05-runbar-problem-and-note-panel.png`});
});
