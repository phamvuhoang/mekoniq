import {WorldPlayback} from '../twin/world-playback';
import {comparisonTabs,semanticStudyHtml,parseSemanticStudy,type SemanticStudyView} from '../reports/compare';
import {CELL_SET,WORLD_EXPERIMENTS,worldExperimentLabel,knownWorldDrawing} from '../twin/cell';
import {worldPhase,type WorldDrawing} from '../twin/world-view';
import {storyCameraTransition,type StoryCameraState,type StoryCamera} from '../twin/story-camera';
import {physicsHtml,physicsTimeline} from '../reports/physics';
import {loadPayloadBundle,selectPayloadExperiment,PAYLOAD_EXPERIMENT_IDS,experimentLabel,MUJOCO_MOBILE_SET,type PayloadBundle} from '../twin/payload';
import {faultScheduleEditor,draftEntry,driveFaultStudio,faultCodeWords,type ScheduleDraft} from './fault-schedule';
import {visibleCheck,driveBlock,type DriveCheck,faultCatalogOf,driveFaultContext,defaultDraft,defaultParams,draftToEntry,faultTargets,parseDriveScheduleFile,serialiseSchedule,MAX_DRIVE_FAULTS,type DriveFaultDraft,type DriveFaultEntry} from '../scenarios/drive-faults';
import {selectDriveExperiment,driveExperimentOf} from '../twin/payload';
import {editSchedule} from '../scenarios/fault-schedule';
import {ProjectStore} from '../project/store';
// Twin workspace: run bar, viewport (2D plan or optional 3D, Display menu with layers + legend), transport bar and a details inspector
// (objects, engineering, report, setup). All execution goes through TwinRuntime; selection/layers/view/panels are local view state only.
import {requestForPreset,httpTwinRuntime,SPEED_FACTORS,TwinRuntimeError,clockControls,engineeringRefFor,pinnedCommit,type RunReport,type RunView,type TwinHealth,type TwinRuntime,type ReadinessSnapshot} from '../scenarios/controls';
import {backendSetOptions} from '../scenarios/support';
import {loadNavigationScene} from '../scenarios/engineering';
import {boundNavigationScene,importNavigationEvidence} from '../reports/navigation2d';
import type {NavigationSceneV1} from '../shared/navigation2d';
import {pose3dOf} from '../twin/pose3d';
import {IRSIM_PROFILE,MUJOCO_ARM_SET,WEBOTS_ARM_SET,WEBOTS_PROFILE,type EngineeringPresetInput} from '../scenarios/catalog';
import {layerProvenance} from '../twin/overlays';
import {presets,presetById,nameOf,type TwinPreset} from '../scenarios/catalog';
import {preflight,ready} from '../scenarios/preflight';
import {renderTwin,sceneEntities,kindLabel,type TwinFrame,type ViewState} from '../twin/scene';
import {defaultLayers,LAYERS,layerLabel,legend,ONLY_2D_REASON,THREE_D_LAYERS,toggleLayer,type Layer} from '../twin/overlays';
import {selectEntity,selectedEntity,onSelection} from '../twin/selection';
import {inspect,identityItems} from '../twin/inspector';
import {currentCup,reconciliationSubject} from '../twin/coffee-cell';
import {attentionChain,cycleQueue,nextAction,runControls,statusText,type OpsState} from './operations-panel';
import {caveatPopover,loopbackBlockedText,pickerItems,runBar,runtimePopover,runtimeWord,scenarioPicker,simLabel,THIS_MACHINE,type RunBarState} from './run-bar';
import {armMeshProblems,collectProblems,problemCounts,nextStrip,problemsPanel,type Problem} from './problems';
import {transportBar,transportTime,type TransportState} from './transport';
import {keyAction,shortcutsDialog,TWIN_ONLY_KEYS} from './keys';
import {inspector,loadUi,saveUi,TABS,type InspectorTab} from './inspector';
import {ControlPanel} from './control-panel';
import {engineeringPanel,engineeringInspection,telemetryLine} from './engineering-panel';
import type {Twin3d,TwinPoses} from '../viewer/twin3d';
import {LivePlayback} from '../twin/live-playback';
import {icon,esc} from './icons';
import {TwinStore} from '../twin/store';
import {freshness,type Link} from '../twin/freshness';
import {openRunStreams,type LinkState,type StreamHandlers} from '../runtime/stream';
import {morph} from './morph';
import {loopbackPage,mayAutoProbe,parseTarget,saveTarget,targetAddress,type RuntimeTarget} from '../runtime/target';
import {openReplayV2} from '../reports/replay';
import {reportCsv,reportHtml,reportJson} from '../reports/metrics';
import {reportPanel,reportSummary,navigationAtCursor,replayBody,replayMarks,controllerVerificationHtml,type ReplayState} from './report-panel';
import {tr} from '../i18n';
import {businessSimulationNote,illustrativeNote,stateLabel} from './labels';
import {importControllerBundle} from '../reports/verification';
import {EvidenceStore,captureEvidence,evidenceStatus,type SavedEvidence} from '../reports/evidence';
import {MAX_PROJECT_BYTES,validateProjectV2} from '../project/schema';
const STEP_TICKS=250,PACED_TICKS=20,SAME_ORIGIN:RuntimeTarget={base:'/lab/v2',kind:'same_origin'};
/** The request never got an answer (network error, or the browser refused a loopback request): the step may have run. */
const lostResponse=(e:unknown)=>e instanceof TypeError||e instanceof TwinRuntimeError&&['LOOPBACK_BLOCKED','PACED_STEP_TIMEOUT'].includes(e.code);
/** A paced step holds at most 50 ticks (≤ 1 s at 1×): no answer after this is a lost response. */
const STEP_TIMEOUT_MS=30_000;
/** A finished cell run asks for the pair of its final view this many more times (about 3 s at the 40 ms poll), then stops. */
const TERMINAL_POLLS=75;
/** Run states that get no newer world pair: the pair of the current view is their frame. */
const SETTLED:readonly string[]=['completed','cancelled','needs_attention'];
/** Run states after which the world is no longer polled once its last pair is held (a failed run holds none). */
const ENDED:readonly string[]=['completed','failed','cancelled'];
/** Keys that act on the twin's run or view: none of them reaches a twin the Control tab hides. */

/** Only the network request's own failure (fetch rejects with a TypeError) means the runtime was not reached; a TypeError thrown by code is not hidden behind it. */
const net=<T,>(p:Promise<T>)=>p.catch((e:unknown)=>{throw e instanceof TypeError?new TwinRuntimeError('RUNTIME_UNREACHABLE',[],0):e;});
/** A page served from this machine has a runtime of its own origin; a page from the web has none (no location: the unit tests, a loopback page). */
const onLoopbackPage=()=>typeof location==='undefined'||loopbackPage(location.hostname);
/** Replace an element's content with `html` in place: kept nodes stay (morph). */
// a node that cannot be cloned (the unit tests' stand-in DOM) is simply rewritten
const morphInner=(el:Element|null,html:string)=>{if(!el)return;if(typeof el.cloneNode!=='function'){el.innerHTML=html;return;}const t=el.cloneNode(false) as Element;t.innerHTML=html;morph(el,t);};
/** Replace an element with `html` (one element of the same id) in place: kept nodes stay (morph). */
const morphOuter=(el:Element|null,html:string)=>{if(!el)return;const t=document.createElement('template');t.innerHTML=html;const next=t.content.firstElementChild;if(next&&next.id===el.id)morph(el,next);else el.outerHTML=html;};
/** Twin-page boxes that scroll on their own (the window does not at desktop sizes). */
const SCROLL_BOXES=['inspector-panel-objects','inspector-panel-engineering','inspector-panel-report','inspector-panel-setup','inspector-panel-control','twin-display-menu','twin-picker','twin-problems','twin-caveat'];
/** The boxes the run bar and the viewport open: one at a time. */
const BOXES={'twin-display-toggle':'displayOpen','twin-runtime-toggle':'runtimeOpen','twin-picker-toggle':'pickerOpen','twin-problems-toggle':'problemsOpen','twin-caveat-toggle':'caveatOpen'} as const;
/** Each box's element. */
const BOX_IDS={displayOpen:'twin-display-menu',runtimeOpen:'twin-runtime-box',pickerOpen:'twin-picker',problemsOpen:'twin-problems',caveatOpen:'twin-caveat'} as const;
/** An answer asked under a generation the page has left behind (I2). */
const STALE='STALE_ANSWER',stale=(e:unknown)=>e instanceof TwinRuntimeError&&e.code===STALE;
export class TwinWorkspace {
 /** What the page shows: bumped when that changes under an answer in flight (the runtime dropped or retargeted, saved evidence opened, a run created or
  * reclaimed, replay of an opened report left). An answer asked under an older generation is dropped, never applied or rendered (current()). */
 private gen=0;
 private current<T>(p:Promise<T>):Promise<T>{const g=this.gen;return p.then(v=>{if(g!==this.gen)throw new TwinRuntimeError(STALE,[],0);return v;});}
 /** Another page is shown (leave() until mounted()): a completion updates the state for when the page is shown again and renders nothing now. */
 private left=false;
 private rerender(){if(!this.left)this.render();}
 private readiness:ReadinessSnapshot|null=null;private readinessRequest=0;private readinessExpiry:ReturnType<typeof setTimeout>|undefined;
 private health:TwinHealth|null=null;private healthChecked=false;private probing=false;
 private preset:TwinPreset=presets[0]!;
 /** Inputs locked at creation; the scene and bar show the run's preset, not whatever is selected afterwards. */
 private runPreset:TwinPreset|null=null;
 private view:RunView|null=null;private report:RunReport|null=null;private seen:Record<string,number>={};
 private vs:ViewState={view:innerWidth<768?'2d':'3d',layers:defaultLayers(),selected:null};
 private webglFailed=false;private viewer:Twin3d|null=null;private mounting=false;private v3d:typeof import('../viewer/twin3d')|null=null;
 /** D58: live playback of the 3D view (twin/live-playback); `exact` are the newest frame's poses it overrides. */
 private playback=new LivePlayback({reducedMotion:()=>matchMedia('(prefers-reduced-motion: reduce)').matches,fresh:(id,now)=>freshness(this.store.entity(id),this.link,now).state==='live'});private exact:TwinPoses|null=null;private raf=0;private worldPlayback=new WorldPlayback();private shownWorldPose='';private worldStale=false;
 /** Telemetry (lossy) lives in the store; the durable view only changes from action receipts, resets and polled snapshots. */
 private store=new TwinStore();private link:Link={state:'closed',lastHeartbeatMs:null,paused:false};private streams:ReturnType<typeof openRunStreams>|null=null;private streamRun='';
 private business=0;private ticker:ReturnType<typeof setInterval>|undefined;private painted='';private refreshing=false;
 private study:SemanticStudyView|null=null;private studyTab:'run'|'study'='run';
 private replayPending=false;private replay:ReplayState|null=null;private replayTimer:ReturnType<typeof setInterval>|undefined;private previous:RunReport|null=null;
 // R4 V09: the drive fault schedule is an input of the next run of a MuJoCo drive preset, held here (never in the project), with the check the runtime last gave it
 private driveFaults:DriveFaultEntry[]=[];private driveFor='';private driveDraft:DriveFaultDraft|null=null;private driveOpen=false;private driveMessage:string|null=null;private driveCheck:DriveCheck={state:'idle',codes:[]};private runDrive:DriveFaultEntry[]|undefined;
 private scheduleOpen=false;private scheduleDraft:ScheduleDraft={faultId:'reboot',targetId:'',trigger:'elapsed_sim_ms',value:'1000',durationMs:'1000'};private projects=new ProjectStore();
 /** IR-SIM runs: the run bundle's compiled navigation scene, loaded once per run from the bundle the runtime locked. */
 private exportBusy=false;private exportAbort:AbortController|null=null;private world:WorldDrawing|null=null;private worldView:RunView|null=null;private worldReceived=0;private worldBusy=false;private worldAbort:AbortController|null=null;private worldDrawing:Omit<WorldDrawing,'record'>|null=null;private worldRun='';private worldBoot='';private worldReason='';private storyPhase='';private storyCamera:StoryCameraState={camera:'overview',follow:false,phaseFollow:false,instant:false};
 private payloadBundle:PayloadBundle|null=null;private navigation:NavigationSceneV1|null=null;private sceneLoad=0;
 /** The scene this frame may draw: bound to the shown report's own evidence (an opened report is never live). */
 private scene(){return boundNavigationScene(this.report,this.navigation,!this.archived);}
 /** An open IR-SIM report: its navigation layers are drawn, or the reason they are not is shown (never silently absent). */
 private irsimReport(){return !!this.report&&(this.report.navigation2d!==undefined||this.report.manifest.backends.some(b=>b.id==='irsim_2d'||b.id==='webots_3d'||b.id==='mujoco_3d'));}
 /** Replace the scene with the one of `bundle` (or none); a later load or create() wins over an earlier one. */
 private loadScene(bundle:string|undefined){this.navigation=null;this.payloadBundle=null;const token=++this.sceneLoad;if(bundle)void loadPayloadBundle(this.rt,bundle).then(b=>{if(token===this.sceneLoad){this.payloadBundle=b;this.rerender();}},()=>{});if(bundle)void this.current(loadNavigationScene(this.rt,bundle).catch(()=>null)).then(s=>{if(token===this.sceneLoad){this.navigation=s;this.rerender();}},()=>{/* asked for another page state */});}
 /** Which boxes and inspector tab are open: view state only (`inspectorOpen` and `tab` survive a reload). `focusTo`: where focus goes after the next render. */
 private ui=loadUi();/** A Control tab restored from storage stays only on a runtime that offers the bench (settleRestoredTab); a tab the user picks is never changed. */private restoredControl=this.ui.tab==='control';private scrolls:Record<string,number>={};private helpOpen=false;private keys=false;private focusTo:string|null=null;private helpReturn:string|null=null;
 /** Keys (D66) while the page is shown: registered in mounted() (the same listener is added once), removed in leave(). */
 private onKey=(e:KeyboardEvent)=>{
  const t=e.target as HTMLElement|null;
  const studyTab=t?.closest<HTMLElement>('[data-action="twin-study-tab"]');if(studyTab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'run':e.key==='End'?'study':studyTab.dataset.value==='run'?'study':'run';this.focusTo='#comparison-tab-'+next;this.click('twin-study-tab',next);return;}
  // the app already acted on it (Space/Enter on a scene object), Space on a control keeps its native meaning, and an open modal
  // (the confirm dialog) keeps its own keys: cancelling its Escape would suppress the dialog's close request
  if(e.defaultPrevented||document.querySelector('dialog:modal')||e.key===' '&&t?.closest?.('button,a[href],summary,[role="button"],[data-action]'))return;
  const a=keyAction({key:e.key,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,repeat:e.repeat,target:t?{tagName:t.tagName,type:(t as HTMLInputElement).type,isContentEditable:t.isContentEditable,role:t.getAttribute?.('role')}:null},!!document.querySelector('dialog[open]'));
  // the Control tab has the main area: the hidden twin takes no run or view key (the details, help and Escape keep theirs)
  if(a&&this.controlOpen()&&TWIN_ONLY_KEYS.includes(a))return;
  if(a){e.preventDefault();this.click(a);}
 };
 /** A pointer press outside the open box (and outside the button that opened it) closes it, as Escape does. In place (morph): the control under that
  * press keeps its node, so the click it begins still lands. */
 private onPress=(e:PointerEvent)=>{
  const t=e.target as Element|null,open=(Object.entries(BOXES) as [string,keyof typeof BOX_IDS][]).find(([,k])=>this.ui[k]);if(!open||!t?.closest)return;
  // on the twin page itself (the app's header, language and navigation re-render or leave the page anyway)
  const [toggle,k]=open;if(!t.closest('.twin-shell')||t.closest(`#${BOX_IDS[k]},[data-action="${toggle}"]`))return;
  this.ui={...this.ui,[k]:false};this.liveRender();
 };
 /** The Control tab (R4.2): its own bench runs on this workspace's runtime client and health; it never reads or changes the twin's run or preset. */
 private control=new ControlPanel({rt:()=>this.rt,health:()=>this.health,pinBlock:()=>this.pinBlock(),render:()=>this.liveRender(),engineHolder:()=>this.engineHolder(),freeEngine:async()=>{await this.call(()=>this.settlePrevious());if(this.engineHolder())throw Error(this.notice||'ENGINE_STILL_HELD');}});
 /** The twin's own finished run that keeps the one MuJoCo slot until it is archived (a bench is then refused MUJOCO_CAPACITY): the cell, or a run with the MuJoCo arm. A mobile run gives it back when it ends. */
 private engineHolder(){const v=this.view;return v&&!this.replay&&!this.archived&&ENDED.includes(v.run.status)&&(v.run.backendSetId===CELL_SET||v.run.backends.includes('mujoco_arm'))&&this.retired!==v.run.id&&this.lostRun!==v.run.id?v.run.id:null;}
 /** The Control tab has the main area (the twin's viewport is hidden): open, not watching, and the bench can run here. An unavailable bench sits beside the viewport. */
 private controlOpen(){return this.ui.inspectorOpen&&this.ui.tab==='control'&&!this.ui.watch&&this.control.available();}
 /** Once health is known: a Control tab restored from storage falls back to Objects on a runtime that offers no bench. */
 private settleRestoredTab(){if(!this.restoredControl)return;this.restoredControl=false;if(!Object.keys(this.health?.benchCatalog??{}).length){this.ui={...this.ui,tab:'objects'};saveUi(this.ui);}}
 private runSpeed=16;private evidenceStore=new EvidenceStore();private saved:SavedEvidence[]=[];private savedLoaded=false;private archived=false;
 /** The runtime box's address field (the saved address until edited); `runtimeError`: the code of the last failed connect (INVALID_RUNTIME_URL is shown at the field);
  * `pinMismatch`: [runtime, pin] short commits after a create refused RUNTIME_PIN_MISMATCH; `pinExpected`: the Lab's pin (served beside the page), '' until read. */
 private addressDraft='';private whereChoice:'here'|'other'='here';private runtimeError:string|null=null;private pinMismatch:string[]|null=null;private pinExpected='';private pinRead=false;
 /** Paced auto-run (features.pacedStep): stopped by a hidden tab (resumes when shown); `speedLog` [wall ms, sim s] of the last 2 s gives `measuredSpeed` (U06 shows it). */
 private hiddenStop=false;private speedLog:[number,number][]=[];private measuredSpeed:number|undefined;
 /** One Pause press during a paced run: the loop stops, the in-flight step returns, then `pause` goes with that step's revision. */
 private inFlightCell:RunView|null=null;private priorityPause:Promise<unknown>|null=null;
 private pausing=false;private payloadStopping=false;private payloadStopPause=false;private payloadCancelPaused=false;
 /** The address that failed validation: the error stays only while the field still holds it. */
 private failedAddress='';
 /** Report refresh off the paced loop's critical path: at most one request in flight, at most once a second, `reportAgain` = one more when it lands. */
 private reportBusy=false;private reportDue=0;private reportAgain=false;
 /** Every report request gets a number; an answer is shown only if no later-asked one is shown already (the runtime makes a report when asked). */
 private reportSeq=0;private reportShown=0;
 /** An action waits for the report that matches the view (save, export, replay, a new run): the page says it is loading meanwhile. */
 private reportLoading=false;
 /** The paced loop is running: re-renders keep the elements the user can act on (paint()). */
 private pacedLoop=false;
 /** Polls a finished cell run has spent, with no action in flight, without holding the pair of its final view (TERMINAL_POLLS at most). */
 private terminalPolls=0;
 /** This run's world polling was stopped as ended: a later view that moves past the held pair starts it again (applyView). */
 private worldPollStopped=false;
 private tokenDraft='';private busy=false;private playing=false;private notice='';private fault='cup-removed';private confirming:string|null=null;private confirmationKind:'reconcile'|'restoreCup'='reconcile';private reconcileTargets:string[]=[];
 /** `engineeringProjectDigest` is the digest of the engineering design the Assembly page holds now; saved engineering evidence is current only while it matches. */
 /** `engineeringInput` is the Assembly page's current design and receipt; an engineering preset runs from it only when its profile matches (re-checked against the receipt). */
 constructor(private render:()=>void,private rt:TwinRuntime=httpTwinRuntime(),private engineeringProjectDigest:()=>string|undefined=()=>undefined,private engineeringInput:()=>EngineeringPresetInput|undefined=()=>undefined){
  // not paired, or a runtime on another origin that is reached only after a click: the runtime box is open from the start
  if(typeof location!=='undefined'&&typeof location.search==='string'){const story=new URLSearchParams(location.search).get('story');if(story==='coffee-delivery'||story==='external-impact'){this.preset={...presetById('mujoco-cell')!,worldExperimentId:story==='external-impact'?'world-cup-fall-v1':'world-nominal-v1'};this.runSpeed=1;}}
  this.ui.runtimeOpen=!rt.paired||this.target().kind!=='same_origin';
  // "this machine": the page's own runtime on a page from this machine, else the launcher's runtime on the user's machine (a page from the web has none of its own)
  const t=this.target();this.addressDraft=t.kind==='same_origin'&&!onLoopbackPage()?THIS_MACHINE:targetAddress(t);this.whereChoice=t.kind==='same_origin'||this.addressDraft===THIS_MACHINE?'here':'other';
  onSelection(id=>{this.vs={...this.vs,selected:id};this.rerender();});
 }
 /** The durable view, with AMR poses taken from newer telemetry (or from the replay cursor); stale/lost telemetry is drawn as unknown. */
 /** An engineering preset takes the open Assembly design (and its receipt) when it has this preset's profile; otherwise it keeps a null receipt and preflight says so. */
 private resolve(p:TwinPreset):TwinPreset{
  if(!p.engineering)return p;
  const input=this.engineeringInput();
  return input&&[IRSIM_PROFILE,WEBOTS_PROFILE].includes(input.project.requestedProfile)&&input.project.requestedProfile===p.engineering.project.requestedProfile?{...p,engineering:{project:input.project,receipt:input.receipt},project:structuredClone(input.project.runtimeProject)}:p;
 }
 private refOf(p:TwinPreset){try{return p.engineering?engineeringRefFor(p.engineering.project,p.engineering.receipt):undefined;}catch{return null;}}
 private clock(){return this.view?clockControls(this.view,this.health):undefined;}
 private target(){return this.rt.target??SAME_ORIGIN;}
 /** The held pair is the committed frame of the current view: same run, tick and revision. */
 private pairCurrent(){const v=this.view;return !!v&&!!this.world&&!!this.worldView&&this.world.record.snapshot.runId===v.run.id&&this.worldView.tick===v.tick&&this.worldView.run.runRevision===v.run.runRevision;}
 /** A completed, cancelled or held-for-attention run gets no newer pair: the current one is its frame. */
 private settledPair(){return SETTLED.includes(this.view?.run.status??'')&&this.pairCurrent();}
 private frame():TwinFrame {
  // The pair of a settled run's current view never expires (settledPair). Any other pair is kept for 500 ms, or drawn stale (never empty)
  // while the run is running and a newer pair is expected.
  const held=!this.replay&&!this.replayPending&&this.world&&this.worldView&&this.world.record.snapshot.runId===this.view?.run.id,status=this.view?.run.status,late=!!held&&performance.now()-this.worldReceived>500,stale=late&&status==='running',paired=held&&(!late||status==='running'||this.settledPair());const v=paired?this.worldView:this.view,base={preset:this.runPreset??this.resolve(this.preset),report:this.report,world:undefined as WorldDrawing|undefined,payloadBundle:this.payloadBundle?.scene.sceneDigest===this.scene().scene?.sceneDigest?this.payloadBundle:null,navigation:this.scene().scene};
  if(paired&&this.world&&this.world.record.snapshot.runId===v?.run.id&&this.world.record.snapshot.tick===v?.tick&&this.world.sourceRevision===v.run.runRevision){base.world=stale?{...this.world,quality:'stale'}:this.world;base.navigation=this.world.scene.navigation;base.payloadBundle={scene:this.world.scene.navigation,physical:this.world.physical,load:this.world.load,physicalSha256:this.world.scene.models.mobilePhysical.sha256,loadSha256:this.world.scene.models.emptyLoad.sha256};}
  if(!v)return {...base,view:v};
  if(this.replay){const r=this.replay,projection=r.rp.project(this.view!,r.tick);if(base.preset.id==='mujoco-cell'){const report:RunReport&{worldSweep?:unknown}={...projection.report};delete report.arm;delete report.worldSweep;delete report.physicsEvidence;return {...base,...projection,report,world:undefined,navigation:null,payloadBundle:null,samples:{}};}return {...base,...projection};}
  if(base.world)return {...base,report:this.report&&this.report.outcome.tick<=v.tick?this.report:null,view:v,samples:Object.fromEntries(this.store.entities().filter(s=>s.simTimeNs===null||BigInt(s.simTimeNs)<=BigInt(v.simTimeNs)).map(s=>[s.entityId,s])),nowMs:performance.now()};
  const now=performance.now();
  return {...base,samples:Object.fromEntries(this.store.entities().map(s=>[s.entityId,s])),nowMs:now,view:{...v,entities:v.entities.filter(e=>e.kind==='amr').map(e=>{const s=this.store.entity(e.id),o=s?.observed;if(!s||!o||typeof o.xM!=='number')return e;
   const fresh=freshness(s,this.link,now),newer=s.simTimeNs!==null&&BigInt(s.simTimeNs)>=BigInt(v.simTimeNs)&&(v.run.telemetryCursor===null||BigInt(s.seq)>=BigInt(v.run.telemetryCursor));
   return {...e,...newer?{pose:{x:o.xM as number,y:o.yM as number,yawRad:o.yawRad as number,...pose3dOf(o)},moving:typeof o.moving==='boolean'?o.moving:e.moving,hold:typeof o.hold==='string'?o.hold:null}:{},sampleAgeMs:fresh.ageMs??undefined,quality:fresh.state==='live'||fresh.state==='frozen_sim'?newer?(s.quality==='valid'?'valid':'stale'):e.quality:'stale'};})}};
 }
 /** Plain text (escaped where it is written). */
 private linkText(){
  if(this.replay)return `${tr('Đã ghi','記録済み','Recorded')} · ${(this.replay.tick*this.replay.rp.range.tickMs/1000).toFixed(2)} s`;
  const l=this.link.state,{id,f}=this.fresh(),label:Record<LinkState,string>={connecting:tr('đang kết nối','接続中','connecting'),live:'SSE',polling:tr('hỏi định kỳ','ポーリング','polling'),reconnecting:tr('đang nối lại','再接続中','reconnecting'),session_lost:tr('mất phiên · cần ghép nối lại','セッション喪失 · 再ペアリング','session lost · re-pair'),run_lost:tr('runtime không còn lần chạy này','実行が見つかりません','run no longer on runtime'),runtime_lost:tr('mất runtime','ランタイム喪失','runtime lost'),closed:tr('đã đóng','終了','closed')};
  const state={live:tr('mới','最新','live'),stale:tr('cũ','古い','stale'),frozen_sim:'FROZEN_SIM',disconnected:tr('mất kết nối','切断','disconnected'),unknown:tr('chưa rõ','不明','unknown')}[f.state];
  const g=this.store.gaps.length,d=this.store.stats.gapDropped+this.store.stats.dropped;
  return `${label[l]} · ${id??'—'} ${state}${f.ageMs===null?'':` ${(f.ageMs/1000).toFixed(1)} s`}${f.reason&&f.state!=='live'?` (${f.reason})`:''}${g||d?` · gap ${g} · drop ${d}`:''}`;
 }
 private async exportWorld(){
  if(this.exportBusy||!this.view||!this.rt.exportReplay)return;const id=this.view.run.id,epoch=this.gen,abort=new AbortController();this.exportAbort=abort;this.exportBusy=true;this.paint();
  let capture:Awaited<ReturnType<NonNullable<TwinRuntime['exportReplay']>>>|undefined;
  try{capture=await this.rt.exportReplay(id,abort.signal);const {replayZip}=await import('../reports/replay-save'),blob=await replayZip(capture.reader,abort.signal);if(epoch!==this.gen||this.view?.run.id!==id||abort.signal.aborted)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`replay-${id}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.notice=tr('Đã xuất snapshot bất biến; giải nén ZIP rồi nhập tại Xem mẫu.','不変スナップショットを出力しました。ZIPを展開し「サンプルを見る」で読み込んでください。','Immutable snapshot exported; extract the ZIP and import it in Explore recordings.');}
  catch(e){if(epoch===this.gen)this.notice=abort.signal.aborted?tr('Đã hủy xuất gói.','出力を中止しました。','Export cancelled.'):String(e);}
  finally{capture?.reader.close();await capture?.release().catch(e=>{if(epoch===this.gen)this.notice=String(e);});if(this.exportAbort===abort)this.exportAbort=null;this.exportBusy=false;this.paint();}
 }
 private clearWorld(){this.terminalPolls=0;this.worldPollStopped=false;this.worldPlayback.clear();this.shownWorldPose='';this.replayPending=false;this.worldAbort?.abort();this.worldAbort=null;this.worldBusy=false;this.world=null;this.worldView=null;this.worldDrawing=null;this.worldRun='';this.worldReason='';this.worldBoot='';this.storyPhase='';this.playback.clear();}
 private async refreshWorld(){
  const v=this.view;if(this.worldBusy||this.replayPending||!v||v.run.backendSetId!==CELL_SET||this.archived||this.replay||!this.rt.worldDisplay||!this.rt.worldDisplayScene)return;
  const epoch=this.gen,id=v.run.id,abort=new AbortController();this.worldAbort=abort;this.worldBusy=true;
  const reason=this.worldReason,status=v.run.status;let gone=false;
  try{if(this.worldRun!==id){this.world=null;this.worldDrawing=null;this.playback.clear();const meta=await this.rt.worldDisplayScene(id,abort.signal);if(this.left||epoch!==this.gen||this.view?.run.id!==id)return;this.worldRun=id;this.worldDrawing=meta.scene?knownWorldDrawing(meta.scene):null;this.worldReason=meta.reason??(this.worldDrawing?'':'WORLD_MODEL_PROXY_UNAVAILABLE');}
   const observation=await this.rt.worldDisplay(id,abort.signal);if(this.left||epoch!==this.gen||this.view?.run.id!==id||observation.runId!==id)return;
   const context=observation.view??this.view;
   if(context.run.id!==id||observation.tick!==context.tick||observation.revision!==context.run.runRevision||observation.simTimeNs!==context.simTimeNs){this.worldPlayback.clear();this.worldReason='WORLD_VIEW_HORIZON_MISMATCH';return;}
   if(context.run.runRevision>=this.view.run.runRevision&&context.tick>=this.view.tick)this.applyView(context);
   if(observation.availability==='unknown'||!observation.snapshot||!this.worldDrawing||observation.snapshot.sceneDigest!==this.worldDrawing.scene.sceneDigest){this.world=null;this.worldPlayback.clear();this.worldReason=observation.reason??'WORLD_SCENE_IDENTITY_MISMATCH';gone=true;return;}
   if(this.worldBoot&&this.worldBoot!==observation.snapshot.bootId){this.world=null;this.worldView=null;this.worldPlayback.clear();this.playback.clear();this.worldReason='WORLD_BOOT_CHANGED_REQUIRES_NEW_RUN';gone=true;return;}this.worldBoot=observation.snapshot.bootId;const newWorld=this.world?.record.snapshot.tick!==observation.tick||this.world.sourceRevision!==observation.revision;if(newWorld||context.run.status==='paused')this.worldReceived=performance.now();this.worldView=structuredClone(context);this.world={...this.worldDrawing,sourceRevision:observation.revision,quality:observation.availability,record:{snapshot:observation.snapshot,command:observation.control as WorldDrawing['record']['command'],interactions:[]}};this.worldReason=observation.reason??'';const phase=worldPhase(this.world.record);if(phase.id!==this.storyPhase){this.storyPhase=phase.id;this.storyCamera=storyCameraTransition(this.storyCamera,{type:'phase',camera:phase.camera,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});if(this.storyCamera.phaseFollow)this.viewer?.camera(this.storyCamera.camera);}if(this.v3d&&this.world.quality==='valid')this.worldPlayback.feed([id,this.worldBoot,observation.snapshot.sceneDigest].join('/'),observation.simTimeNs,this.worldReceived,this.v3d.posesOf(this.frame()));else this.worldPlayback.clear();if(newWorld||reason!==this.worldReason||status!==this.view.run.status)this.paint();if(newWorld&&this.pacedLoop&&this.vs.view==='3d')this.paint3d(this.frame());
  }catch(e){if(epoch===this.gen&&!abort.signal.aborted&&!(ENDED.includes(this.view?.run.status??'')&&this.settledPair())){this.world=null;this.worldPlayback.clear();this.worldReason=String(e);}}   // a failed poll never drops the final pair an ended run already holds
  // A finished run stops polling when it holds the pair of its final view, or the runtime says there is no world. Not while an action is in flight: the
  // runtime ticks on to the end of a step and bumps the revision only with the receipt. Otherwise it asks again, TERMINAL_POLLS times at most, then gives up.
  finally{if(this.worldAbort===abort){this.worldBusy=false;this.worldAbort=null;if(epoch===this.gen&&!abort.signal.aborted&&ENDED.includes(status)){const got=this.pairCurrent();if(!this.busy&&(gone||got||++this.terminalPolls>=TERMINAL_POLLS)){this.terminalPolls=0;clearInterval(this.ticker);this.ticker=undefined;this.worldPollStopped=true;if(!got)this.paint();}}else this.terminalPolls=0;}}
 }
 private fresh(){/* the sample the link detail and the runtime word speak for: the selected entity's, else the run's first */const id=this.vs.selected&&this.store.entity(this.vs.selected)?this.vs.selected:this.view?.entities[0]?.id;return {id,f:freshness(id?this.store.entity(id):undefined,this.link,performance.now())};}
 /** Telemetry repaint without a full re-render: the runtime word, the link detail (Engineering tab, runtime box), and the 2D plan or 3D view when samples changed. */
 private tick(){
  if(!this.left)void this.refreshWorld();
  const t=this.linkText(),state=this.replay?'recorded':this.fresh().f.state,w=this.runtimeState(),chip=document.getElementById('twin-runtime-chip'),word=document.getElementById('twin-runtime-word');
  for(const id of ['twin-telemetry','twin-telemetry-box']){const el=document.getElementById(id);if(el){el.textContent=t;el.dataset.state=state;}}if(chip)chip.dataset.state=w.state;if(word)word.textContent=w.label;
  // replay: its cursor is part of what is painted (nothing is repainted while it stands still)
  const now=performance.now(),n=JSON.stringify([this.store.stats.applied,this.store.stats.epochResets,this.link.state,this.link.paused,this.vs.selected,this.store.entities().map(s=>{const f=freshness(s,this.link,now);return [s.entityId,f.state,f.reason];}),this.replay&&[this.replay.tick,this.replay.playing]]),worldStale=this.frame().world?.quality==='stale';
  if(worldStale!==this.worldStale){this.worldStale=worldStale;this.painted='';return this.paint();}
  if(n===this.painted)return;this.painted=n;
  const f=this.frame();
  // in place (morph): a 2D entity under the pointer keeps its node (same data-action/data-value), so a click is not lost while samples arrive
  if(this.vs.view==='2d')morphInner(document.getElementById('twin-stage'),renderTwin(f,this.vs));else this.paint3d(f);
  morphInner(document.getElementById('twin-inspector'),engineeringInspection(inspect(f,this.vs.selected,f.seen??this.seen)));
  if(this.replay){
   // in place (morph), as for the paced run: a press spanning an update, focus and an open box's scroll survive
   for(const [id,html] of [['twin-run-bar',this.bar(f)],['twin-objects',this.objects(f)],['twin-identity',this.identity(f)],['twin-next',this.strip(f)]] as const)morphOuter(document.getElementById(id),html);
   morphInner(document.getElementById('twin-entity-list'),this.entityList(f));
   const time=document.getElementById('twin-transport-time');if(time)time.textContent=transportTime(this.replay.tick*this.replay.rp.range.tickMs/1000,this.replay.tick,this.replay.rp.range.toTick);
   if(f.report)morphOuter(document.getElementById('twin-report-summary'),reportSummary(f.report,this.business));
  }
 }
 private animating(now:number){return !this.world&&this.vs.view==='3d'&&!!this.viewer&&this.playback.animating(now,{live:this.link.state==='live',replay:!!this.replay});}
 private loop=()=>{this.raf=0;const now=performance.now();
  if(this.world&&!this.replay&&this.viewer&&this.vs.view==='3d'){
   const poses=this.worldPlayback.at(now);if(!poses||performance.now()-this.worldReceived>500||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
   const key=JSON.stringify(poses);if(key!==this.shownWorldPose){this.shownWorldPose=key;this.viewer.pose(poses);}this.raf=requestAnimationFrame(this.loop);return;
  }
  if(!this.exact||!this.animating(now))return;this.viewer!.pose(this.playback.poses(this.exact,now));this.raf=requestAnimationFrame(this.loop);
 };
 /** Scene and poses are installed in one draw; world interpolation uses only received pairs. */
 private paint3d(f:TwinFrame){const v=this.viewer;if(!v||!this.v3d)return;
  const now=performance.now(),worldPoses=f.world&&!this.replay&&!matchMedia('(prefers-reduced-motion: reduce)').matches?this.worldPlayback.at(now):null;
  v.update(f,this.vs,worldPoses??undefined);if(f.world&&this.storyCamera.follow)v.camera('amr');this.exact=this.replay?null:this.v3d.posesOf(f);
  if(worldPoses){this.shownWorldPose=JSON.stringify(worldPoses);this.raf||=requestAnimationFrame(this.loop);}else if(this.exact&&this.animating(now)){v.pose(this.playback.poses(this.exact,now));this.raf||=requestAnimationFrame(this.loop);}
 }
 private openStreams(v:RunView){
  if(this.streamRun===v.run.id&&this.streams&&!['session_lost','run_lost','closed'].includes(this.streams.state))return;
  this.streams?.close();this.store=new TwinStore();this.playback.clear();this.business=0;this.streamRun=v.run.id;this.link={state:'connecting',lastHeartbeatMs:null,paused:false};
  // a stream of an older page state (a poll answer landing after close) says nothing about what is shown now
  const handlers:StreamHandlers<RunView,Parameters<TwinStore['apply']>[0]>={
   onSample:s=>{const r=this.store.apply(s);if(r==='applied'||r==='epoch_reset'){this.playback.feed(this.store.entity(s.entityId)!,r==='epoch_reset');if(!this.raf&&this.exact&&this.animating(performance.now()))this.raf=requestAnimationFrame(this.loop);}},onGap:g=>{this.store.gap(g as never);this.playback.clear();this.worldPlayback.clear();},
   onHeartbeat:h=>{this.link={...this.link,lastHeartbeatMs:performance.now(),paused:h.paused};if(!this.busy&&!this.refreshing&&this.view&&h.runRevision!==this.view.run.runRevision)void this.refresh();},
   onBusiness:e=>{this.business++;const c=this.view?.run.eventCursor;if(!this.busy&&!this.refreshing&&this.view&&(c==null||BigInt(e.sequence)>BigInt(c)))void this.refresh();},
   onReset:(snap,reason)=>{this.notice=`${tr('Đồng bộ lại từ snapshot','スナップショットから再同期','Resynchronised from a snapshot')}: ${reason}`;if(!this.busy)void this.apply(snap).then(()=>this.rerender(),()=>{});},
   onSnapshot:snap=>{if(!this.busy&&snap.run.runRevision!==this.view?.run.runRevision)void this.apply(snap).then(()=>this.rerender(),()=>{});},
   onState:st=>{this.link={...this.link,state:st};
    // telemetry is not replayed after a drop: the hole is recorded as an explicit local gap
    if(st==='reconnecting'||st==='runtime_lost'){this.store.gap({reason:`LINK_${st.toUpperCase()}`});this.playback.clear();this.worldPlayback.clear();}
    if(st==='session_lost'){this.control.invalidate();this.rt.forget();this.playing=false;this.ui.runtimeOpen=true;this.notice=tr('Runtime đã mất phiên (khởi động lại?). Ghép nối lại; lần chạy trong bộ nhớ không mở lại được, báo cáo cuối vẫn xem được.','ランタイムのセッションが失われました(再起動?)。再ペアリングしてください。メモリ上の実行は再開できませんが、最後のレポートは閲覧できます。','The runtime lost the session (restarted?). Pair again; the in-memory run cannot be reopened, the last report stays viewable.');this.rerender();}
    else if(st==='run_lost'||st==='runtime_lost'){this.playing=false;this.rerender();}
    else this.tick();}};
  const g=this.gen,mine=Object.fromEntries(Object.entries(handlers).map(([k,f])=>[k,(...a:unknown[])=>{if(g===this.gen)(f as (...a:unknown[])=>void)(...a);}])) as typeof handlers;
  this.streams=openRunStreams(v.run.id,v.run.eventCursor,mine,
   {...this.rt.streamDeps?.()??{EventSource:globalThis.EventSource},...this.health?.features?.sse===false?{EventSource:undefined}:{}});
  clearInterval(this.ticker);this.worldPollStopped=false;this.ticker=setInterval(()=>this.tick(),v.run.backendSetId===CELL_SET?40:100);
 }
 /** Durable events arrived that this view does not reflect yet (e.g. another tab acted): re-read the snapshot. */
 private async refresh(){this.refreshing=true;try{if(this.view)await this.apply(await this.current(this.rt.get(this.view.run.id)));this.rerender();}catch{/* keep the last snapshot; an answer for another page state is dropped */}finally{this.refreshing=false;}}
 /** Evidence is the report of the run as shown, never an older one (finalReport). */
 private async saveEvidence(){if(!this.runPreset||typeof indexedDB==='undefined'||!this.report&&!this.view)return;const report=await this.finalReport();await this.evidenceStore.save(captureEvidence(report,this.runPreset.project,this.payloadBundle));this.saved=await this.evidenceStore.list();}
 /** Does this report describe the run exactly as the view shows it (same run, tick and status)? */
 /** A request is on its way for a finished or paused run whose report does not describe it yet (or an action is fetching that report). */
 private reportPending(){const v=this.view;return this.reportLoading||this.reportBusy&&!!v&&!this.replay&&!this.archived&&['completed','failed','cancelled','paused'].includes(v.run.status)&&!this.reportFits();}
 private reportFits(r=this.report){const v=this.view;return !!r&&!!v&&r.manifest.runId===v.run.id&&r.outcome.tick===v.tick&&r.outcome.status===v.run.status;}
 /** The report as a record of the run as shown: the one held if it matches the view, otherwise fetched now; one that still does not match,
  * or a failed fetch, is a visible error (call() shows it), never a fallback to an older report. */
 private async finalReport():Promise<RunReport>{
  const v=this.view;if(!v)return this.report!;
  if(this.reportFits())return this.report!;
  const seq=++this.reportSeq;this.reportLoading=true;this.paint();
  try{
   const r=await this.fetchReport(v.run.id);this.takeReport(v.run.id,seq,r,false);
   if(!this.reportFits(r))throw new TwinRuntimeError('REPORT_NOT_CURRENT',[`report tick ${r.outcome.tick} ${r.outcome.status}`,`run tick ${v.tick} ${v.run.status}`],409);
   return r;
  }finally{this.reportLoading=false;}
 }
 /** Show report `r` (asked as number `seq`) unless the run changed or a later-asked report is already shown. */
 private takeReport(id:string,seq:number,r:RunReport|null,paint=true){
  if(this.view?.run.id!==id||seq<=this.reportShown)return;
  this.reportShown=seq;this.report=r;if(r&&this.replay)this.replay={...this.replay,rp:openReplayV2(r)};if(paint)this.paint();
 }
 /** A re-render during the paced loop keeps every element whose markup did not change (morph): buttons under the pointer, an open select and
  * focus survive; readouts change in place. Outside the paced loop the app re-renders as it always did. */
 private paint(){if(this.pacedLoop)this.liveRender();else this.rerender();}
 private morphing=false;
 private liveRender(){
  // a focused field the morph removes fires its blur/change at once, and that handler renders again: that render runs after this one, never inside it (the DOM is mid-update)
  if(this.morphing){queueMicrotask(()=>this.liveRender());return;}
  const shell=typeof document.querySelector==='function'?document.querySelector('.twin-shell'):null;if(!shell)return this.rerender();
  const t=document.createElement('template');t.innerHTML=this.html();const next=t.content.querySelector('.twin-shell');if(!next)return this.rerender();
  // the 3D viewer owns the stage's canvas; the 2D plan is plain markup and is updated like the rest
  this.morphing=true;try{morph(shell,next,el=>el.id==='twin-stage'&&this.vs.view==='3d'&&!!this.viewer);}finally{this.morphing=false;}
 }
 private evidenceHtml(){
  return `<section class="panel" data-testid="saved-evidence"><h3>${tr('Báo cáo đã lưu','保存済みレポート','Saved reports')}</h3><p class="field-help">${tr('Báo cáo được giữ nguyên. Phạm vi cũ cần chạy lại khi đầu vào đổi.','レポートは不変。入力変更時は該当範囲を再実行。','Reports stay unchanged. Changed inputs require new evidence for the affected scope.')}</p><label for="twin-import-evidence">${tr('Nhập thư mục bằng chứng (chỉ đọc)','検証フォルダを読み込む(読み取り専用)','Import evidence folder (read-only)')}</label><input id="twin-import-evidence" type="file" multiple webkitdirectory ${this.busy||this.playing?'disabled':''}>${this.saved.map(s=>{const state=evidenceStatus(s,this.resolve(this.preset).project,this.report?.manifest.scenario.id===s.report.manifest.scenario.id?this.report:null,{engineeringProjectDigest:this.engineeringProjectDigest()});return `<p><button class="text-button" data-action="twin-open-evidence" data-value="${esc(s.id)}"${this.busy?' disabled':''}>${s.origin==='imported'?tr('Đã nhập','インポート済み','Imported')+' · ':''}${esc(s.report.manifest.scenario.id)} · ${esc(s.report.manifest.runId.slice(0,8))} · tick ${esc(s.report.outcome.tick)}</button> <span data-testid="evidence-status">${state.stale?`${tr('bằng chứng cũ','古い検証記録','stale evidence')}: ${state.scopes.join(', ')}`:tr('khớp đầu vào','入力一致','inputs match')}${!state.runtimeChecked?` · ${tr('chưa so runtime','ランタイム未比較','runtime not compared')}`:''}</span></p>`;}).join('')||'<p>—</p>'}</section>`;
 }
 /** A finished run whose report on the page does not describe it (its fetch failed, or it is older): said, with one way to ask again; never used as evidence. */
 private reportMissing(){const v=this.view;return v&&!this.replay&&!this.archived&&['completed','failed','cancelled'].includes(v.run.status)&&!this.reportFits()&&!this.reportPending()
  ?`<p class="field-error" data-testid="report-missing" role="status">${tr('Trang chưa có báo cáo khớp với lần chạy này (tải báo cáo không thành công hoặc báo cáo cũ hơn): lưu, xuất và xem lại cần báo cáo đó.','この実行に一致するレポートがページにありません(取得に失敗したか、古いレポートです)。保存・書き出し・再生にはそのレポートが必要です。','The page has no report that matches this run (its fetch failed, or it is older): saving, export and replay need that report.')}</p><button class="button secondary" data-action="twin-report-reload"${this.busy?' disabled':''}>${icon('rotate',16)}${tr('Tải lại báo cáo','レポートを再読み込み','Reload report')}</button>`:'';}
 private payloadSettings(){if(this.preset.id==='mujoco-cell')return `<p><b>${tr('Dừng và tiếp tục xử lý','停止と対応の継続','Stop and continue handling')}</b> · ${tr('Tạm dừng / tiếp tục chỉ với trạng thái Source đã biết. Kết quả chưa rõ: đối soát hoặc lần chạy mới; không gửi lại lệnh.','一時停止・再開は既知のSource状態のみ。不明な結果は照合または新しい実行で対応し、再送しません。','Pause/resume requires a known Source state. Unknown outcomes require reconciliation or a new run; commands are not resent.')}</p><label for="twin-world-experiment">${tr('Thử một thay đổi · lần chạy mới','変更を試す · 新しい実行','Try one change · new run')}</label><select id="twin-world-experiment" ${this.busy||this.playing?'disabled':''}>${WORLD_EXPERIMENTS.map(id=>`<option value="${id}" ${id===this.preset.worldExperimentId?'selected':''} ${this.health?.capabilities?.includes('sim3d_world_experiments_v1')&&this.health.worldExperiments?.some(e=>e.id===id&&e.requiresNewRun)?'':'disabled'}>${esc(worldExperimentLabel(id))}</option>`).join('')}</select><p class="field-help">${tr('Tác động đã đăng ký: cốc [30,0,30] N trong 10 substep khi vận chuyển; dock 2000 N trục X trong 10 substep trước nhả. Đổi đầu vào tạo lần chạy mới.','登録外力:輸送中カップに[30,0,30]Nを10サブステップ、解放前ドックにX方向2000Nを10サブステップ。入力変更は新しい実行です。','Registered impact: cup [30,0,30] N for 10 substeps during transport; dock 2000 N map X for 10 substeps before release. Changed inputs create a new run.')}</p>`;if(this.preset.id!=='mujoco-payload')return '';return `<label for="twin-payload-experiment">${tr('Thí nghiệm cho lần chạy mới','新しい実行の実験','Experiment for new run')}</label><select id="twin-payload-experiment" ${this.busy||this.playing||this.replay||this.archived?'disabled':''}>${PAYLOAD_EXPERIMENT_IDS.map(id=>`<option value="${id}" ${id===this.preset.engineering?.project.mujocoExperimentId?'selected':''}>${esc(experimentLabel(id))}</option>`).join('')}</select><p class="field-help">${tr('Đổi lựa chọn tạo lần chạy mới. Tốc độ phát × chỉ đổi nhịp hiển thị, không đổi giới hạn vận tốc.','選択変更は新しい実行になります。再生速度×はペースのみで速度上限を変えません。','A changed selection creates a new run. Playback × changes pacing; it does not change velocity caps.')}</p>`;}
 /** What the runtime is asked, and what a verdict is bound to. */
 private driveBody(){return {driveFaultSchedule:structuredClone(this.driveFaults),backendSetId:this.preset.backendSetId,scenarioId:this.preset.scenarioId,...driveExperimentOf(this.preset)&&this.preset.id==='mujoco-cell'?{driveExperimentId:driveExperimentOf(this.preset)!}:{}};}
 /** Why a run with the studio's schedule cannot be made (no drive experiment chosen), or null. */
 private driveBlocked(){return ['mujoco-payload','mujoco-cell'].includes(this.preset.id)&&this.driveFor===this.preset.id?driveBlock(this.driveFaults.length,driveExperimentOf(this.preset)):null;}
 /** The studio of drive faults for the current preset: empty where the runtime does not run drive faults. */
 private driveStudio():string{
  const catalog=faultCatalogOf(this.health),ctx=driveFaultContext(this.preset.id);
  if(this.driveFor!==this.preset.id){this.driveFor=this.preset.id;this.driveFaults=[];this.driveDraft=null;this.driveMessage=null;this.driveCheck={state:'idle',codes:[]};}
  if(!catalog.length||!ctx)return `<p class="field-help" data-testid="drive-faults-unavailable">${tr('Runtime này không chạy lỗi drive (không có danh mục lỗi trong health).','このランタイムはドライブ障害を実行しません(healthにカタログなし)。','This runtime does not run drive faults (no fault catalog in health).')}</p>`;
  const draft=this.driveDraft&&catalog.some(f=>f.id===this.driveDraft!.faultId)?this.driveDraft:(this.driveDraft=defaultDraft(catalog,ctx));
  return driveFaultStudio({open:this.driveOpen,catalog,ctx,draft,entries:this.driveFaults,experiment:driveExperimentOf(this.preset),disabled:this.busy||this.playing||!!this.replay||this.archived,check:visibleCheck(this.driveCheck,JSON.stringify(this.driveBody())),message:this.driveBlocked()?`${this.driveBlocked()} · ${faultCodeWords(this.driveBlocked()!)}`:this.driveMessage,blocked:!!this.driveBlocked()});
 }
 private runSettings(){const speed=this.preset.project.entities.find(e=>e.kind==='amr')?.speedLimitMps??0.5;return `${this.payloadSettings()}<label>${tr('Môi trường cho lần chạy mới','新しい実行の環境','Environment for new run')}<select id="twin-backend-set" ${this.busy||this.playing||this.replay||this.archived?'disabled':''}>${(this.health?backendSetOptions(this.health):[{id:this.preset.backendSetId,mode:this.preset.mode??'mock',selectable:true,reasons:[]}]).map(s=>`<option value="${esc(s.id)}" ${s.id===this.preset.backendSetId?'selected':''} ${s.selectable||s.id===this.preset.backendSetId?'':'disabled'}>${esc(s.id)} · ${esc(s.mode)}${s.reasons.length?` · ${tr('không khả dụng','利用不可','unavailable')}: ${esc(s.reasons.join(', '))}`:''}</option>`).join('')}</select></label>${['mujoco-payload','mujoco-cell'].includes(this.preset.id)?this.driveStudio():faultScheduleEditor(this.preset.project,this.scheduleDraft,this.busy||this.playing||!!this.replay||this.archived,this.preset.mode??'mock',this.scheduleOpen)}<div class="twin-settings">${['mujoco-payload','mujoco-cell'].includes(this.preset.id)?'':`<label for="twin-speed-limit">${tr('Giới hạn AMR cho lần chạy mới (m/s)','新しい実行のAMR速度上限(m/s)','AMR limit for new runs (m/s)')}</label><input id="twin-speed-limit" type="number" min="0.01" max="0.5" step="0.01" value="${esc(speed)}">`}<button class="button quiet" data-action="twin-run" ${this.busy||this.playing||!!this.replay||this.archived||!this.rt.paired||this.pinBlock()||!!this.driveBlocked()||(this.preset.id==='mujoco-payload'||this.preset.id==='mujoco-cell'&&!this.view)&&!ready(preflight(this.preset,this.health,this.rt.paired,this.readiness))?'disabled':''}>${tr('Chạy với đầu vào mới','変更した入力で実行','Run with edited inputs')}</button>${this.view?`<button class="button quiet" data-action="twin-reset" ${this.busy||this.playing||this.replay||this.pinBlock()?'disabled':''}>${icon('rotate',16)}${tr('Đặt lại (lần chạy mới)','リセット(新しい実行)','Reset (new run)')}</button>`:''}${this.rt.paired?(this.rt.recoverableRunIds??[]).filter(id=>!this.control.isBench(id)).map(id=>`<button class="text-button" data-action="twin-reclaim" data-value="${esc(id)}" ${this.busy?'disabled':''}>${tr('Mở lại chỉ xem/đối soát','表示・照合のみで再開','Reopen for view/reconcile')} · ${esc(id.slice(0,8))}</button>`).join(''):''}</div>`;}
 private readinessPreset(){return this.view?.run.status==='ready'&&this.runPreset?this.runPreset:this.resolve(this.preset);}
 private watchReadinessExpiry(){
  clearTimeout(this.readinessExpiry);
  const delay=this.readiness?Date.parse(this.readiness.expiresAt)-Date.now():NaN;
  if(Number.isFinite(delay)&&delay>0)this.readinessExpiry=setTimeout(()=>this.paint(),Math.min(delay,30000));
 }
 private async checkReadiness(p=this.readinessPreset()){
  const request=++this.readinessRequest;this.readiness=null;this.watchReadinessExpiry();
  if(!this.health?.features?.readiness||!this.rt.paired||!this.rt.readiness)return;
  if(p.id==='mujoco-payload'&&p.engineering&&!p.engineering.receipt&&this.health.capabilities?.includes('sim3d_payload_experiments_v1')&&this.rt.compileEngineering){
   try{const receipt=await this.current(this.rt.compileEngineering(p.engineering.project));if(request!==this.readinessRequest||p!==this.preset)return;p={...p,engineering:{project:p.engineering.project,receipt}};this.preset=p;}catch(e){this.notice=String(e);return;}
  }
  const ref=this.refOf(p);if(ref===null)return;// an engineering preset without a receipt for this exact draft: preflight already says why
  try{const answer=await this.current(ref?this.rt.readiness(p.scenarioId,p.backendSetId,undefined,ref):this.rt.readiness(p.scenarioId,p.backendSetId,p.project));if(request===this.readinessRequest&&p.id===this.readinessPreset().id&&p.backendSetId===this.readinessPreset().backendSetId){this.readiness=answer;this.watchReadinessExpiry();}}catch{/* the unknown state keeps Start disabled */}
 }
 async checkHealth(){const g=this.gen;let h:TwinHealth|null=null;try{h=await this.rt.health();}catch{/* not there */}this.probing=false;if(g!==this.gen)return;this.health=h;await this.checkReadiness();this.healthChecked=true;this.settleRestoredTab();this.rerender();}
 private ops(f:TwinFrame,view=f.view):OpsState{const c=this.clock(),clock=c&&!this.health?.features?.pacedStep?{...c,play:false}:c;return {paired:this.rt.paired,ready:!this.pinBlock()&&ready(preflight(this.readinessPreset(),this.health,this.rt.paired,this.readiness)),busy:this.busy||!!this.replay,playing:this.playing,view,preset:f.preset,...clock&&!this.replay?{clock}:{}};}
 /** Retained frames are display context; only the current live view supplies action policy. */
 private controlOps(f:TwinFrame){return this.ops(f,this.replay?f.view:this.view);}
 /** Preflight matters until a run starts; afterwards the run's own state does. */
 private showChecks(){return !this.view||this.view.run.status==='ready';}
 private runtimeState():RunBarState['runtime']{/* one word for the run bar; `connecting` until the health check answers (no run) or the first heartbeat arrives (a run) */
  const l=this.link,link=this.archived?'closed':!this.view?this.healthChecked?'closed':'connecting':l.state==='live'&&l.lastHeartbeatMs===null?'connecting':l.state;
  // what this page load knows: nothing tried yet, a probe or Connect under way, the last one failed, or an answer (with or without the pin)
  const pending=this.probing||this.busy&&!this.healthChecked||!this.healthChecked&&typeof location!=='undefined'&&mayAutoProbe(this.target(),location.hostname);
  const attempt=this.health?'ok' as const:pending?'pending' as const:this.healthChecked?'failed' as const:'none' as const;
  return {...runtimeWord(link,this.fresh().f.state,this.rt.paired,!!this.replay,this.playing,{attempt,pinMismatch:!!this.pinBlock()}),detail:this.health?`source ${this.health.sourceCommit.slice(0,7)}`:''};
 }
 private bar(f=this.frame()){
  const v=f.view,r=v?.run,ops=this.controlOps(f),n=nextAction(ops),c=runControls(ops);
  // the primary action is the recommended step; while a run is live with none, auto-run (or stopping it)
  const primary=this.replay?null:n.action?{action:n.action.id,label:n.action.label,disabled:ops.busy||f.preset.id==='mujoco-cell'&&n.action.id==='twin-run'&&!this.view&&!ops.ready||!!this.pinBlock()&&['twin-run','twin-rerun','twin-reset'].includes(n.action.id)}:c.live?c.paused?{action:'twin-resume',label:tr('Tiếp tục mô phỏng','シミュレーション再開','Resume simulation'),disabled:ops.busy}:this.pausing?{action:'twin-pause',label:tr('Đang tạm dừng…','一時停止中…','Pausing…'),disabled:true}:this.playing?{action:'twin-stop',label:tr('Dừng','停止','Stop'),disabled:false}:{action:'twin-play',label:tr('Chạy tiếp','続行','Keep running'),disabled:!c.canPlay}:null;
  const p=this.problems(f);if(!p.length)this.ui.problemsOpen=false;const u=this.ui;// an emptied problems box closes: a later problem never opens it by itself
  const boxes=scenarioPicker(pickerItems(presets,this.health),this.preset.id,u.pickerOpen)+runtimePopover({open:u.runtimeOpen,target:this.target(),draftUrl:this.addressDraft,paired:this.rt.paired,busy:this.busy||this.playing,health:this.health,pin:{expected:this.pinExpected,actual:this.health?.sourceCommit??null},error:this.boxError(),where:this.whereChoice,pageOrigin:typeof location==='undefined'?'':location.origin,pageHasRuntime:onLoopbackPage()},v?this.linkText():null)
   +problemsPanel(p,u.problemsOpen,attentionChain(this.ops(f)))+caveatPopover(r?`${r.mode.toUpperCase()} · ${r.access}`:'—',f.report?.limitations??[],u.caveatOpen);
  return runBar({scenarioTitle:this.controlOpen()?`${tr('Twin','ツイン','Twin')} · ${f.preset.title()}`:f.preset.title(),runtime:this.runtimeState(),mode:simLabel(r?.mode??null,f.report?.manifest.calibration?.status==='calibrated'),modeToken:r?.mode??null,status:r?statusText(r.status):null,simTimeS:v?Number(v.simTimeNs)/1e9:null,served:v?v.served:null,...problemCounts(p),primary,inspectorOpen:u.inspectorOpen},
   {pickerOpen:u.pickerOpen,runtimeOpen:u.runtimeOpen,problemsOpen:u.problemsOpen,caveatOpen:u.caveatOpen,boxesHtml:boxes});
 }
 /** Engineering tab head: the run's locked identity and revision. */
 private identity(f:TwinFrame){
  const v=f.view,r=v?.run,p=f.preset;
  return `<div class="twin-identity-block" id="twin-identity"><p class="twin-identity" data-testid="run-identity">${r?identityItems(v!,f.report).map(x=>`<span>${esc(x)}</span>`).join(''):`<span>${esc(p.scenarioId)} · ${esc(p.backendSetId)} · ${tr('chưa khóa','未固定','not locked')}</span>`}</p>${r?`<p><span class="twin-bar-item" data-testid="run-revision"><small>Run rev.</small><b>${this.replay?'—':esc(r.runRevision)}</b></span> <span class="twin-run-id" data-testid="run-id">${esc(r.id)}</span></p>`:''}</div>`;
 }
 /** Every problem of the page (D64); preflight counts until a run starts, an opened report has no live link. */
 private problems(f:TwinFrame):Problem[]{
  const mismatch=this.pinBlock(),pin=mismatch?[{id:'runtime-pin',severity:'blocker' as const,codes:['RUNTIME_PIN_MISMATCH'],action:{id:'twin-runtime-toggle',label:tr('Mở hộp runtime','ランタイムを開く','Open runtime')},
   text:tr(`Runtime chạy source ${mismatch[0]}, Lab ghim ${mismatch[1]}: không tạo lần chạy. Dùng runtime đúng bản ghim.`,`ランタイムのソースは ${mismatch[0]}、Labの固定は ${mismatch[1]} です。実行は作成しません。固定版のランタイムを使ってください。`,`The runtime runs source ${mismatch[0]}; the Lab is pinned to ${mismatch[1]}. No run is created: use the pinned runtime.`)}]:[];
  // the 3D view's reasons for drawing an arm as its joint chain (notices, last)
  const arm=this.vs.view==='3d'&&this.viewer&&this.v3d?armMeshProblems(this.v3d.armMeshIssues(f),f.preset):[];
  return [...pin,...this.problemList(f),...arm];
 }
 private problemList(f:TwinFrame){return collectProblems({paired:this.rt.paired,health:this.health,healthChecked:this.healthChecked,checks:this.showChecks()?preflight(this.readinessPreset(),this.health,this.rt.paired,this.readiness):[],view:f.view,linkState:this.archived?'closed':this.link.state,preset:f.preset});}
 /** Objects tab head: the cycle/resource queue and who holds the current cup (the attention chain is in the problems box). */
 private objects(f:TwinFrame){
  const ops=this.ops(f),cup=currentCup(f.view);
  return `<div class="twin-objects" id="twin-objects">${cycleQueue(ops)}${f.view?`<p class="twin-bar-item"><small>${tr('Cốc hiện tại','現在のカップ','Current cup')}${cup?` ${esc(cup.cupId)}`:''}</small><b data-testid="cup-owner">${cup?esc(nameOf(f.preset,cup.ownerId)):'—'}</b></p>`:''}</div>`;
 }
 /** A run that is simply running needs no person: its next step stays on the run bar. */
 private strip(f:TwinFrame){const n=nextAction(this.controlOps(f)),v=f.view,u=this.replay?f.unrecorded??[]:[];
  // replay: an object with recorded samples but none at this cursor is drawn without them, and that is said
  const none=u.length?`<p class="source-note" data-testid="replay-unrecorded" role="status">${icon('info',15)}${tr('Không có mẫu ghi lại tại thời điểm này (trước mẫu đầu tiên hoặc trong khoảng trống telemetry) cho','この時点の記録サンプルがありません(最初のサンプルより前、またはテレメトリ欠落中):','No recorded sample at this point (before the first one, or in a telemetry gap) for')} ${esc(u.map(id=>nameOf(f.preset,id)).join(', '))}: ${tr('vẽ như khi không có telemetry.','テレメトリがない場合と同じく描画します。','drawn as without telemetry.')}</p>`:'';
  return `<div class="twin-next" id="twin-next">${none}${nextStrip(this.problems(f),v?.run.status==='running'&&!v.attention.length?{title:n.title,detail:n.detail}:n)}</div>`;}
 private transport(f:TwinFrame):TransportState{
  // a runtime that paces steps accepts exactly these factors; an older one keeps the clock's own list
  const v=f.view,c=runControls(this.controlOps(f)),r=this.replay,speeds=this.health?.features?.pacedStep||!this.clock()?.speeds.length?[...SPEED_FACTORS]:this.clock()!.speeds;
  // a paced run pauses with one press (the loop stops, then pause follows its last step); while that is pending it says so and cannot be pressed again
  const pacedPause=!!this.health?.features?.pacedStep&&this.playing&&!r&&c.live;
  return {mode:r?'replay':v?'live':'idle',playing:this.playing,canPlay:c.canPlay,canStep:c.canStep,canPause:!this.pausing&&(c.canPause||pacedPause||this.payloadStopping&&!this.payloadStopPause),pausing:this.pausing||this.payloadStopping&&this.payloadStopPause,paused:this.payloadStopping?false:c.paused||this.runPreset?.id==='mujoco-payload'&&this.payloadCancelPaused,canCancel:c.canCancel,speeds,speed:this.runSpeed,
   simTimeS:r?r.tick*r.rp.range.tickMs/1000:v?Number(v.simTimeNs)/1e9:0,tick:r?r.tick:v?.tick??0,measuredSpeed:this.playing&&!r?this.measuredSpeed:undefined,
   ...r?{replay:{fromTick:r.rp.range.fromTick,toTick:r.rp.range.toTick,tick:r.tick,playing:r.playing,step:['mujoco-payload','mujoco-cell'].includes(f.preset.id)?1:5,marks:this.report?replayMarks(this.report):[]}}:{}};
 }
 /** [runtime, pin] short commits when the runtime this page reached is not the Lab's pin (or a create was refused for it): no run is started. */
 private pinBlock():string[]|null{const c=this.health?.sourceCommit;return c&&this.pinExpected&&c!==this.pinExpected?[c.slice(0,7),this.pinExpected.slice(0,7)]:this.pinMismatch;}
 /** The box's error: the last failed connect, else why this page's own runtime is not there (a page from the web has none: the address field is the way on). */
 private boxError(){return this.runtimeError??(this.healthChecked&&!this.health&&this.target().kind==='same_origin'?typeof location!=='undefined'&&loopbackPage(location.hostname)?'RUNTIME_UNREACHABLE':'NO_RUNTIME_ON_THIS_PAGE':null);}
 private checks(){
  const c=preflight(this.readinessPreset(),this.health,this.rt.paired,this.readiness);
  return `<div class="preflight" data-testid="preflight"><h3>${tr('Kiểm tra trước khi chạy','実行前チェック','Preflight')}</h3><ul>${c.map(x=>`<li class="${x.ok?'ok':'fail'}"><span class="check-mark" aria-hidden="true">${icon(x.ok?'check':'cross',14)}</span><span><b>${esc(x.label)}</b> <span class="state-text">${x.ok?tr('đạt','合格','pass'):tr('chưa đạt','未達','fail')}</span><br><small>${esc(x.detail)}</small></span>${x.entityId?`<button class="text-button" data-action="twin-select" data-value="${esc(x.entityId)}">${tr('Xem','表示','Show')}</button>`:''}</li>`).join('')}</ul>${this.health?.features?.readiness&&this.rt.paired?`<button class="button quiet" data-action="twin-readiness" ${this.busy?'disabled':''}>${tr('Kiểm tra lại','再確認','Check again')}</button>`:''}</div>`;
 }
 private entityList(f:TwinFrame){return sceneEntities(f).map(e=>`<li><button data-action="twin-select" data-value="${esc(e.id)}" aria-pressed="${e.id===this.vs.selected}"><span class="entity-kind">${esc(kindLabel(e.kind))}</span><b>${esc(e.name)}</b>${e.name!==e.id?`<small>${esc(e.id)}</small>`:''}${e.status?`<span class="state-text">${esc(stateLabel(e.status))}</span>`:''}</button></li>`).join('');}
 html():string {
  // a re-render replaces the page: keep where the twin page's own scroll boxes were (hidden ones report 0 and are skipped)
  for(const id of SCROLL_BOXES){const el=document.getElementById(id);if(el&&!el.hidden&&typeof el.scrollTop==='number')this.scrolls[id]=el.scrollTop;}
  this.scheduleOpen=(document.getElementById('twin-fault-schedule') as HTMLDetailsElement|null)?.open??this.scheduleOpen;
  this.driveOpen=(document.getElementById('twin-drive-faults') as HTMLDetailsElement|null)?.open??this.driveOpen;
  // a re-render (e.g. the health probe landing) must not wipe a code being typed; restored in mounted(), never written to markup
  this.tokenDraft=(document.getElementById('twin-pair-token') as HTMLInputElement|null)?.value??this.tokenDraft;
  this.addressDraft=(document.getElementById('twin-runtime-url') as HTMLInputElement|null)?.value??this.addressDraft;
  this.readDriveFields();
  const f=this.frame(),ents=sceneEntities(f),sel=this.vs.selected,insp=inspect(f,sel,f.seen??this.seen),p=f.preset;
  // IR-SIM runs add safety/observed/scan layers, each with its provenance; other runs keep the four legacy layers
  const shown=LAYERS.filter(l=>f.navigation||!['safety','observed','scan'].includes(l));
  const layers=`<div class="twin-layers" role="group" aria-label="${tr('Lớp hiển thị','表示レイヤー','Layers')}">${shown.map(l=>{const only2d=this.vs.view==='3d'&&!THREE_D_LAYERS.includes(l);return `<button data-action="twin-layer" data-value="${l}" aria-pressed="${!only2d&&this.vs.layers[l]}"${only2d?' disabled aria-describedby="layers-2d-only"':''}>${layerLabel(l)}</button>`;}).join('')}</div>${this.vs.view==='3d'&&shown.some(l=>!THREE_D_LAYERS.includes(l))?`<p class="source-note" id="layers-2d-only" data-testid="layers-2d-only">${esc(shown.filter(l=>!THREE_D_LAYERS.includes(l)).map(layerLabel).join(', '))}: ${esc(ONLY_2D_REASON())}</p>`:''}${f.navigation?`<ul class="layer-provenance" data-testid="layer-provenance">${shown.filter(l=>l!=='frames').map(l=>`<li data-layer="${l}"><b>${layerLabel(l)}</b>: ${esc(layerProvenance(l))}</li>`).join('')}</ul>`:''}${(this.runPreset?.engineering||this.irsimReport())&&!f.navigation?`<p class="source-note" data-testid="navigation-scene-unavailable" role="status">${icon('info',15)}${tr('Lớp hình học điều hướng không khả dụng','ナビゲーション形状レイヤーは利用できません','Navigation geometry layers unavailable')}: ${esc(this.scene().reason??'')}</p>`:''}`;
  const viewSwitch=`<div class="viewer-switch" role="group" aria-label="${tr('Kiểu xem','表示形式','View')}"><button data-action="twin-view" data-value="3d" aria-pressed="${this.vs.view==='3d'}" ${this.webglFailed?'disabled':''}>3D</button><button data-action="twin-view" data-value="2d" aria-pressed="${this.vs.view==='2d'}">2D</button></div>`;
  const legendHtml=`<ul class="twin-legend" data-testid="twin-legend" aria-label="${tr('Chú giải','凡例','Legend')}">${legend().map(x=>`<li><i class="mark ${x.mark}" aria-hidden="true"></i><b>${x.label}</b><small>${x.note}</small></li>`).join('')}</ul>`;
  const display=`<div class="twin-popover twin-display-menu" id="twin-display-menu" data-testid="display-menu" role="group" aria-labelledby="twin-scene-title"${this.ui.displayOpen?'':' hidden'}><h2 id="twin-scene-title" class="small-code">${esc(p.project.name)} · ${esc(p.project.world.width)} × ${esc(p.project.world.height)} m</h2>${viewSwitch}${layers}
${this.vs.view==='3d'&&this.v3d?.armCellDrawn(f)?`<p class="source-note" data-testid="arm-cell-note">${icon('info',15)}${f.world?tr('Khay đã thay bằng receiver di động; giá đỡ vòi vẫn cố định. xArm 6/G2 và Serve dùng dữ liệu thế giới đã tiếp nhận, chưa hiệu chuẩn.','トレイは移動レシーバーに置換。ノズル台は固定。受入済みワールドデータのxArm 6/G2とServe、未校正。','The mobile receiver replaces the static tray; the nozzle stand stays fixed. Admitted xArm 6/G2 and Serve world data, not calibrated.'):tr('Giá đỡ vòi và khay: hình học giả định của trạm mô phỏng (bố trí trạm, giả định), không phải số đo; cố định trong trạm (khay ở nguyên chỗ khi robot rời đi). Chân đế dưới tay máy và chân dưới giá đỡ vòi (khung dây): hình minh họa, không có trong mô phỏng.','ノズル台とトレイ:シミュレーションのセルの仮定形状(セル配置、仮定)で、実測ではありません。セルに固定されています(ロボットが離れてもトレイはその場に残ります)。アーム下の台座とノズル台の下の脚(ワイヤーフレーム):説明用の図で、シミュレーションには含まれません。','Nozzle stand and tray: assumed geometry of the simulated cell (the cell layout, assumed), not measured; fixed in the cell (the tray stays where it is when the robot leaves). The mount under the arm and the leg under the nozzle stand (wireframe): illustrations, not part of the simulation.')}</p>`:''}${this.vs.view==='3d'?`<p class="source-note">${f.preset.id==='mujoco-payload'&&!f.payloadBundle?tr('Hình học mô phỏng tải không khả dụng; xem Chi tiết.','荷物の模擬形状を利用できません。詳細を確認してください。','Payload simulation geometry unavailable; inspect Details.'):f.preset.id==='mujoco-payload'?tr('Serve, khay và cốc dùng hình học mô phỏng đã tiếp nhận; tham số giả định, chưa hiệu chuẩn.','Serve・トレイ・カップは受け入れ済み模擬形状です。パラメータは仮定で未校正。','Serve, tray and cup use admitted simulation geometry; parameters are assumed and not calibrated.'):tr('Hình 3D là sơ đồ. Lớp vùng chiếm chỗ thể hiện hình học mô hình.','3D形状は模式図です。占有領域レイヤーがモデル形状を示します。','3D shapes are schematic. The footprint layer shows model geometry.')}</p>`:''}${legendHtml}<p class="source-note">${icon('info',15)}${tr('Cảnh chỉ đọc: vị trí lấy từ runtime, canvas không quyết định đến đích hay hoàn thành.','表示は読み取り専用。位置はランタイムから取得し、描画は到着や完了を判定しません。','Read-only scene: positions come from the runtime; the canvas never decides arrival or completion.')}</p><p class="source-note" data-testid="honesty-notes">${icon('info',15)}${esc(illustrativeNote())} · ${esc(businessSimulationNote())}</p></div>`;
  const tool=(a:string,ic:string,label:string,attrs='')=>`<button class="icon-button twin-tool" data-action="${a}" aria-label="${label}" title="${label}"${attrs}>${icon(ic,18)}</button>`;
  const viewport=`<section class="twin-viewport" aria-label="${tr('Khung nhìn','ビューポート','Viewport')}"><div class="twin-stage" id="twin-stage" data-testid="twin-scene">${renderTwin(f,this.vs)}</div>
<div class="twin-viewport-tools"><div class="twin-tool-row">${this.vs.view==='3d'&&!this.webglFailed?tool('twin-camera-home','home',tr('Về góc nhìn gốc (kịch bản tay máy: trạm tay máy)','初期視点に戻す(アームのシナリオ:アームセル)','Reset the camera (arm scenarios: the arm cell)'))+tool('twin-camera-fit','fit',tr('Vừa khung đối tượng chọn (không chọn: cả mặt bằng)','選択対象に合わせる(未選択なら床全体)','Fit the selected object (none: the whole floor)')):''}${tool('twin-watch',this.ui.watch?'cross':'eye',this.ui.watch?tr('Thoát chế độ xem','視聴モードを終了','Exit watch mode'):tr('Chế độ xem','視聴モード','Watch mode'),` aria-pressed="${this.ui.watch}"`)}${tool('twin-help','keyboard',tr('Phím tắt','キーボードショートカット','Keyboard shortcuts'),` aria-expanded="${this.helpOpen}" aria-controls="twin-shortcuts"`)}<button class="button quiet" data-action="twin-display-toggle" aria-expanded="${this.ui.displayOpen}" aria-controls="twin-display-menu">${icon('design',16)}${tr('Hiển thị','表示','Display')}</button></div>${display}</div>
${this.notice?`<div class="notice" role="status">${icon('info',17)}<span>${esc(this.notice)}</span><button aria-label="${tr('Đóng','閉じる','Dismiss')}" data-action="twin-dismiss">${icon('cross',16)}</button></div>`:''}
<div class="twin-overlay">${p.id==='mujoco-cell'&&(this.replay||this.replayPending)?`<p class="source-note" data-testid="cell-report-world-unavailable" role="status"><span><b>${tr('Không có tư thế thế giới chính xác trong báo cáo này.','このレポートに正確なワールド姿勢はありません。','Exact world poses are unavailable in this report replay.')}</b> ${tr('Xuất gói replay của lần chạy, giải nén rồi nhập tại Xem mẫu để xem các mẫu vật lý đã xác minh.','実行の再生パッケージを出力・展開し、サンプル画面で読み込んで検証済み物理サンプルを表示してください。','Export this run’s replay package, extract it, then import it in Explore recordings to view verified physical samples.')} <code>WORLD_NOT_RECORDED_IN_REPORT</code> <a href="/#replay">${tr('Xem mẫu','サンプルを見る','Explore recordings')}</a></span></p>`:''}${this.reportPending()?`<p class="source-note" data-testid="report-pending" role="status">${icon('info',15)}${tr('Đang tải báo cáo cuối của lần chạy; lưu, xuất và xem lại chờ báo cáo này.','実行の最終レポートを読み込み中です。保存・書き出し・再生はこのレポートを待ちます。','Loading the run\'s final report; saving, export and replay wait for it.')}</p>`:''}${this.webglFailed?`<p class="source-note" data-testid="twin-fallback-note" role="status">${icon('info',15)}${tr('WebGL không khả dụng · đang hiển thị mặt bằng 2D với cùng dữ liệu và lựa chọn.','WebGLを利用できません · 同じデータと選択で2D平面図を表示中。','WebGL unavailable · showing the 2D plan with the same data and selection.')}</p>`:''}${this.strip(f)}</div></section>`;
  const list=`<ul class="entity-list" id="twin-entity-list" data-testid="entity-list" aria-label="${tr('Đối tượng trong twin','ツイン内の対象','Twin objects')}">${this.entityList(f)}</ul>`;
  const panels={
   objects:`${this.objects(f)}<div class="panel-heading"><h3 id="ent-title">${tr('Đối tượng trong twin','ツイン内の対象','Twin objects')}</h3><span class="pill">${ents.length}</span></div>${list}`,
   engineering:`${f.world?`<details class="cell-physics"><summary>${tr('Vật lý tại tick','このtickの物理','Physics at tick')} ${f.world.record.snapshot.tick}</summary><p>${tr('Nghiêng / bánh xe lệnh và thực / tiếp xúc native','傾斜・車輪指令と実測・ネイティブ接触','Tilt / wheel command and actual / native contacts')}</p><pre>${esc(JSON.stringify({base:f.world.record.snapshot.physics?.base,wheels:f.world.record.snapshot.physics?.wheels,contacts:f.world.record.snapshot.physics?.contacts},null,2))}</pre><p>${tr('Trượt và quãng dừng tổng hợp: không khả dụng tại tick này; chỉ có dữ liệu capture được khai báo trong báo cáo.','滑りと停止距離の集計はこのtickでは利用不可。レポートで宣言された取得データのみです。','Aggregate slip and stop distance are unavailable at this tick; only declared report capture data applies.')}</p></details>`:''}${f.view?telemetryLine(this.linkText(),this.replay?'recorded':this.fresh().f.state):''}${this.identity(f)}${engineeringPanel(insp,{hasRun:!!this.view&&f.preset.id!=='mujoco-payload',busy:this.busy||this.playing||!!this.replay,fault:this.fault,coffee:!!f.view?.coffee})}`,
   report:comparisonTabs(this.studyTab,`${this.reportMissing()}${reportPanel(f.report,{replay:this.replay,previous:this.previous,selected:sel,business:this.business,full:this.report,busy:this.busy})||`<p class="empty-inline">${tr('Chưa có báo cáo: báo cáo xuất hiện khi một lần chạy bắt đầu.','レポートなし:実行を開始すると表示されます。','No report yet: it appears once a run starts.')}</p>`}${this.evidenceHtml()}`,semanticStudyHtml(this.study)),
   setup:`${this.runSettings()}${this.showChecks()?this.checks():''}`,
   // M1: the full panel (its plots) only while it is the tab shown; a light one otherwise, so a twin repaint never re-serializes the plots
   control:this.ui.inspectorOpen&&this.ui.tab==='control'?this.control.html():this.control.stub()};
  const selection=this.reconcileTargets.length>1?`<label for="twin-reconcile-target">${tr('Chọn đối tượng đối soát','照合対象を選択','Choose reconciliation target')}</label><select id="twin-reconcile-target"><option value="">${tr('Chọn đối tượng','対象を選択','Select a target')}</option>${this.reconcileTargets.map(id=>`<option value="${esc(id)}" ${this.confirming===id?'selected':''}>${esc(nameOf(p,id))} · ${esc(id)}</option>`).join('')}</select>`:'';
  const dialog=this.confirming||this.reconcileTargets.length?`<dialog id="twin-confirm" aria-labelledby="twin-confirm-title"><h2 id="twin-confirm-title">${this.confirmationKind==='restoreCup'?tr('Xác nhận đã đặt đúng cốc','カップ位置の修正を確認','Confirm cup correction'):tr('Xác nhận đối soát','照合の確認','Confirm reconciliation')}</h2>${selection}<p>${!this.confirming?tr('Chọn đúng đối tượng đã kiểm tra trước khi xác nhận.','確認した対象を選んでから実行してください。','Select the target you checked before confirming.'):this.confirmationKind==='restoreCup'?tr('Đã đặt đúng cốc rỗng dưới vòi? Runtime sẽ kiểm trạng thái chưa rót và nhận quan sát mới từ cảm biến mock.','正しい空のカップをノズル下に置きましたか。ランタイムが未抽出状態を確認し、新しいモックセンサー観測を受け取ります。','Confirm the correct empty cup is under the nozzle. The runtime checks that no dispensing started and receives a fresh mock sensor observation.'):this.view?.run.mode==='simulation'?tr('Ghi lại yêu cầu đối soát. Cần kiểm tra controller bên ngoài; lần chạy vẫn giữ và không tiếp tục chuyển động.','照合要求を記録します。外部コントローラーの確認が必要です。実行は保持され、動作は再開しません。','Record the reconciliation request. External controller checks are still required; the run stays held and motion does not resume.'):tr(`Đối soát ${esc(this.confirming)}: Lab yêu cầu runtime hỏi thiết bị theo command id và ghi lại câu trả lời. Lab không gửi lại lệnh; kết quả là những gì runtime báo về sau đó. Chỉ xác nhận sau khi đã kiểm tra tại chỗ.`,`${esc(this.confirming)} を照合:LabはランタイムにコマンドIDで機器へ問い合わせ、回答を記録するよう依頼します。Labはコマンドを再送しません。結果はその後ランタイムが報告する内容です。現場確認後のみ確認してください。`,`Reconcile ${esc(this.confirming)}: the Lab asks the runtime to query the device by command id and record the answer. The Lab resends nothing; the outcome is whatever the runtime then reports. Confirm only after checking on site.`)}</p><div class="dialog-actions"><button class="button quiet" data-action="twin-confirm-cancel">${tr('Hủy','キャンセル','Cancel')}</button><button class="button primary" data-action="twin-confirm-ok" ${!this.confirming?'disabled':''}>${icon('check',16)}${tr('Xác nhận đã kiểm tra','確認済みとして実行','Confirm checked')}</button></div></dialog>`:'';
  return `<div class="twin-shell${this.ui.watch?' watch':''}">${this.bar(f)}${f.preset.id==='mujoco-cell'?`<div class="cell-story-bar"><a class="button quiet" href="/#replay/coffee-delivery">${tr('Xem mẫu','サンプルを見る','Explore recording')}</a><button class="button quiet" data-action="twin-world-export" ${this.exportBusy||!this.view||!this.rt.exportReplay?'disabled':''}>${tr('Xuất replay','再生データ出力','Export replay')}</button>${this.exportBusy?`<button class="button quiet" data-action="twin-world-export-cancel">${tr('Hủy xuất','出力中止','Cancel export')}</button>`:''}<button class="button quiet" data-action="twin-phase-follow" aria-pressed="${this.storyCamera.phaseFollow}">${tr('Theo pha','工程追従','Follow phases')}</button><span title="${f.world?`Source snapshot tick ${f.world.record.snapshot.tick}`:''}">${f.world?.quality==='stale'?esc(tr('Kết quả chưa rõ · tư thế đã giữ','結果不明 · 保持された姿勢','Outcome unknown · held pose')):f.world?esc(worldPhase(f.world.record).id==='source_idle'?tr('Đang chờ','待機中','Waiting'):worldPhase(f.world.record).id==='transport'?tr('Giao cà phê','コーヒーを届ける','Delivering coffee'):worldPhase(f.world.record).id==='stop_latched'?tr('Dừng để kiểm tra','確認のため停止','Held for review'):worldPhase(f.world.record).id.startsWith('cup-pick')?tr('Gắp và nâng cốc','カップを把持・持ち上げ','Picking up cup'):tr('Đặt cốc lên khay','トレイにカップを置く','Placing cup on tray')):esc(this.worldReason||tr('Đang chờ quan sát thế giới','ワールド観測待ち','Awaiting world observation'))}${f.world?` <small data-testid="world-observation-age">H${f.world.record.snapshot.tick} · r${f.world.sourceRevision??'—'}${SETTLED.includes(f.view?.run.status??'')?'':` · ${Math.max(0,performance.now()-this.worldReceived).toFixed(0)} ms`}</small>${f.world.quality==='stale'?` <b class="field-error" data-testid="world-stale">${tr('Khung đã ghi cuối · cũ (chưa có tick mới)','最後に確定したフレーム · 古い(新しいティックなし)','Last committed frame · stale (no new tick)')}</b>`:''}`:''}</span>${(['overview','cell','amr'] as const).map(c=>`<button class="button quiet" data-action="twin-story-camera" data-value="${c}">${c==='overview'?tr('Toàn cảnh','全体','Overview'):c==='cell'?'Cell':tr('Theo AMR','AMR追従','Follow AMR')}</button>`).join('')}</div>`:''}<div class="twin-main${this.ui.inspectorOpen?' inspector-open':''}${this.controlOpen()?' control-open':''}">${viewport}${inspector(this.ui,panels)}</div>${transportBar({...this.transport(f),...this.controlOpen()?{scope:tr('Lần chạy của twin · bàn chỉnh có nút Chạy thử riêng','ツインの実行 · ベンチは専用の「試運転」','Twin run · the bench has its own Run bench')}:{}})}${physicsTimeline(f.report,f.view?.tick??0)}</div>${shortcutsDialog(this.helpOpen,this.controlOpen())}${dialog}`;
 }
 /** After the host HTML is replaced: modal dialog, optional 3D view. The 2D plan is already in the DOM and stays the fallback. */
 mounted(){
  if(typeof location!=='undefined'&&location.hash.startsWith('#replay'))return;
  this.left=false;
  if(!this.keys){document.addEventListener('keydown',this.onKey);document.addEventListener('pointerdown',this.onPress);this.keys=true;}
  const to=this.focusTo;this.focusTo=null;if(to)queueMicrotask(()=>(document.querySelector(to) as HTMLElement|null)?.focus());// after the app restores focus (its render ends after mounted())
  for(const [id,top] of Object.entries(this.scrolls)){const el=document.getElementById(id);if(el)el.scrollTop=top;}
  this.watchReadinessExpiry();
  const studyImporter=document.getElementById('twin-import-study') as HTMLInputElement|null;
  studyImporter?.addEventListener('change',()=>{const file=studyImporter.files?.[0];if(!file)return;void this.call(async()=>{if(file.size>8*1024*1024)throw Error('SEMANTIC_STUDY_LIMIT');this.study=parseSemanticStudy(await file.text());this.studyTab='study';});},{once:true});
  const importer=document.getElementById('twin-import-evidence') as HTMLInputElement|null;
  const driveImporter=document.getElementById('twin-drivefault-import') as HTMLInputElement|null;
  driveImporter?.addEventListener('change',()=>{const file=driveImporter.files?.[0];if(!file||this.busy||this.playing||this.replay||this.archived)return;void file.text().then(text=>{if(file.size>256*1024)return this.driveRefuse('SCHEDULE_FILE_TOO_LARGE');const r=parseDriveScheduleFile(text,faultCatalogOf(this.health));if(!r.ok)return this.driveRefuse(r.code);this.driveFaults=r.entries;this.driveMessage=null;this.driveCheck={state:'idle',codes:[]};this.driveOpen=true;this.rerender();});},{once:true});
  const projectImporter=document.getElementById('twin-project-import') as HTMLInputElement|null;
  projectImporter?.addEventListener('change',()=>{const file=projectImporter.files?.[0];if(!file||this.busy||this.playing||this.replay||this.archived)return;void this.call(async()=>{if(file.size>MAX_PROJECT_BYTES)throw new Error('PROJECT_TOO_LARGE');const project=await this.projects.importV2(await file.text());this.preset={...this.preset,project};this.readiness=null;});},{once:true});
  importer?.addEventListener('change',()=>{const files=Array.from(importer.files??[]);if(!files.length)return;void this.call(async()=>{const report=files.find(f=>(f.webkitRelativePath?f.webkitRelativePath.split('/').slice(1).join('/'):f.name)==='report.json'),isNavigation=report?!!JSON.parse(await report.text())?.navigation2d:false;const imported=isNavigation?await importNavigationEvidence(files):await importControllerBundle(files);const saved={...captureEvidence(imported.report,imported.project,(imported as {payloadBundle?:PayloadBundle}).payloadBundle),origin:'imported' as const};await this.evidenceStore.save(saved);this.saved=await this.evidenceStore.list();this.notice=tr('Đã nhập bằng chứng chỉ đọc; không thay đổi readiness.','読み取り専用の証跡を取り込みました。実行準備状態は変更しません。','Read-only evidence imported; readiness is unchanged.');});},{once:true});
  if(!this.savedLoaded&&typeof indexedDB!=='undefined'){this.savedLoaded=true;void this.evidenceStore.list().then(saved=>{this.saved=saved;this.rerender();}).catch(e=>{this.notice=String(e);this.rerender();});}
  // a run this page archived (the twin's own next run, or the Control tab's one-click close) is never streamed again: the runtime no longer has it
  if(this.view&&this.rt.paired&&!this.streams&&!this.archived&&!this.replay&&!this.replayPending&&this.retired!==this.view.run.id)this.openStreams(this.view);
  const token=document.getElementById('twin-pair-token') as HTMLInputElement|null;if(token&&this.tokenDraft)token.value=this.tokenDraft;
  // only a loopback page probes, only its own origin, once, when the twin page is first shown; any other runtime waits for a click (D52)
  if(!this.healthChecked&&!this.probing&&mayAutoProbe(this.target(),location.hostname)){this.probing=true;void this.checkHealth();}
  // the Lab's own pin, from this page's origin (never a runtime's): the box shows it beside the runtime's commit
  if(!this.pinRead){this.pinRead=true;void pinnedCommit().then(c=>{this.pinExpected=c;this.paint();},()=>{/* no pin served: shown as unknown; a create to another origin says RUNTIME_LOCK_MISSING */});}
  if(this.confirming||this.reconcileTargets.length){const d=document.getElementById('twin-confirm') as HTMLDialogElement|null;if(d&&!d.open)d.showModal();d?.addEventListener('cancel',()=>{this.confirming=null;this.reconcileTargets=[];},{once:true});}
  const stage=document.getElementById('twin-stage');
  if(!stage||this.vs.view!=='3d'||this.webglFailed)return;
  if(this.viewer){this.viewer.attach(stage);this.paint3d(this.frame());return;}
  if(this.mounting)return;this.mounting=true;
  void import('../viewer/twin3d').then(m=>{this.v3d=m;
   this.mounting=false;
   const now=document.getElementById('twin-stage');if(!now||this.vs.view!=='3d')return;
   const v=m.mountTwin3d(now,id=>selectEntity(id),()=>this.fallback(),()=>this.paint(),()=>{this.storyCamera=storyCameraTransition(this.storyCamera,{type:'manual-orbit'});});
   if(!v)return this.fallback();
   this.viewer=v;this.paint3d(this.frame());
  },()=>{this.mounting=false;this.fallback();});
 }
 private fallback(){this.viewer?.dispose();this.viewer=null;this.webglFailed=true;this.vs={...this.vs,view:'2d'};this.rerender();}
 leave(){this.clearWorld();this.exportAbort?.abort();this.worldAbort?.abort();this.worldAbort=null;this.world=null;this.worldView=null;this.worldDrawing=null;this.worldRun='';this.left=true;if(this.raf)cancelAnimationFrame(this.raf);if(this.hiddenStop){this.hiddenStop=false;document.removeEventListener('visibilitychange',this.onVisible);}this.raf=0;if(this.keys){document.removeEventListener('keydown',this.onKey);document.removeEventListener('pointerdown',this.onPress);this.keys=false;}this.ui.watch=false;this.helpOpen=false;this.playing=false;this.viewer?.dispose();this.viewer=null;this.streams?.close();this.streams=null;clearInterval(this.ticker);clearTimeout(this.readinessExpiry);this.stopReplay();}
 /** Report replay has no exact shared-world stream. Invalidate live requests/history before either report path. */
 private async startReportReplay(){
  this.exportAbort?.abort();this.clearWorld();const epoch=++this.gen;this.replayPending=true;this.playing=false;this.stopReplay();this.streams?.close();this.streams=null;clearInterval(this.ticker);this.store=new TwinStore();this.exact=null;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
  try{const report=this.reportFits()?this.report!:await this.finalReport();if(epoch!==this.gen)return;this.replay={rp:openReplayV2(report),tick:0,playing:false};}finally{if(epoch===this.gen)this.replayPending=false;}
 }
 private stopReplay(){clearInterval(this.replayTimer);this.replayTimer=undefined;if(this.replay)this.replay.playing=false;}
 private track(v:RunView){for(const c of v.coffee?.cups??[]){const k=`${c.cupId}:${c.ownerKind}:${c.ownerId}`;if(!(k in this.seen))this.seen[k]=v.tick;}}
 private async call(task:()=>Promise<void>){
  if(this.busy)return;this.busy=true;this.notice='';this.rerender();
  try{await task();}
  catch(e){
   this.playing=false;
   if(stale(e))return;// asked for a page state that is gone: nothing to say, nothing to re-read
   if(e instanceof TwinRuntimeError&&e.code==='RUNTIME_PIN_MISMATCH')this.pinMismatch=e.reasonCodes;
   // LOOPBACK_BLOCKED: the browser gives the same TypeError for every cause, so the notice names them all and claims none
   const o=typeof location==='undefined'?'':location.origin;// this page's origin, for --allow-origin
   this.notice=e instanceof TwinRuntimeError&&e.code==='LOOPBACK_BLOCKED'?`LOOPBACK_BLOCKED: ${loopbackBlockedText(o)}`
    :e instanceof TwinRuntimeError&&e.code==='REPORT_TIMEOUT'?`REPORT_TIMEOUT: ${tr('Runtime không gửi báo cáo của lần chạy trong 30 s; hành động này không thực hiện. Thử lại khi runtime trả lời.','ランタイムが30秒以内に実行のレポートを返しませんでした。この操作は行っていません。ランタイムが応答したら再試行してください。','The runtime did not send the run\'s report within 30 s; this action was not done. Try again once the runtime answers.')}`
    :e instanceof TwinRuntimeError&&e.code==='PACED_STEP_TIMEOUT'?`PACED_STEP_TIMEOUT: ${tr('Runtime không trả lời một bước trong 30 s (đã gửi lại một lần). Tự chạy đã dừng; lần chạy giữ nguyên trạng thái runtime báo.','ランタイムが30秒以内にステップへ応答しませんでした(1回再送済み)。自動実行を停止しました。実行はランタイムが報告する状態のままです。','The runtime did not answer a step within 30 s (resent once). Auto-run stopped; the run stays as the runtime reports it.')}`
    // the request got no answer at all (the browser's own "Failed to fetch"): one sentence that names where it went
    :e instanceof TwinRuntimeError&&e.code==='RUNTIME_UNREACHABLE'||e instanceof TypeError&&/fetch|network|load failed/i.test(e.message)?(a=>`RUNTIME_UNREACHABLE: ${tr(`Không có trả lời từ runtime tại ${a} (runtime đã dừng hoặc mạng bị ngắt). Lần chạy giữ trạng thái runtime báo lần cuối; thử lại khi runtime trả lời.`,`${a} のランタイムから応答がありません(停止しているか、ネットワークが切れています)。実行はランタイムが最後に報告した状態のままです。応答が戻ったら再試行してください。`,`No answer from the runtime at ${a} (it stopped, or the network is down). The run stays as the runtime last reported it; try again once it answers.`)}`)(targetAddress(this.target())||`${o}/lab/v2`)
    :e instanceof TwinRuntimeError?`${tr('Runtime từ chối','ランタイムが拒否','Runtime refused')}: ${e.message}`:e instanceof Error?e.message:String(e);
   // a refused action leaves the run as the runtime has it: re-read instead of guessing
   // (the run first; its report follows off this path, so a failed report never holds the page twice)
   // after a report that timed out, no new report is asked by itself (the user's next action asks)
   if(this.view)try{this.applyView(await this.current(this.rt.get(this.view.run.id)));if(!(e instanceof TwinRuntimeError&&e.code==='REPORT_TIMEOUT'))this.refreshReport(true);}catch{/* keep the last snapshot */}
  }finally{this.busy=false;this.rerender();}
 }
 private async apply(v:RunView){this.applyView(v);const seq=++this.reportSeq;let r:RunReport|null=null;try{r=await this.fetchReport(v.run.id);}catch(e){if(stale(e))throw e;/* the last report of this run stays viewable (a lost session must not erase it); a run with none shows none */if(this.report?.manifest.runId===v.run.id)return;}this.takeReport(v.run.id,seq,r,false);}
 /** The run snapshot only (the action receipt is the pause acknowledgement; heartbeats only refresh it between receipts, e.g. another tab). */
 private applyView(v:RunView){if(v.run.status==='failed'||v.attention?.some(a=>/WORLD_UNKNOWN|WORLD_RESTART|ENGINE_|WORKER_|PLANT_|PHYSICAL_UNKNOWN/.test(a.reason)))this.clearWorld();if(this.world?.record.snapshot.runId!==v.run.id){this.world=null;this.worldView=null;}if(v.run.id!==this.view?.run.id){this.playback.clear();this.worldPlayback.clear();this.payloadCancelPaused=false;this.worldPollStopped=false;}this.view=v;this.track(v);this.link={...this.link,paused:v.run.status==='paused'};
  if(this.worldPollStopped&&v.run.backendSetId===CELL_SET&&!this.pairCurrent()){this.worldPollStopped=false;clearInterval(this.ticker);this.ticker=setInterval(()=>this.tick(),40);}}
 /** The report (trail, summary, caveats) may lag the live picture, which comes from the streams. Never on the paced loop's path:
  * one request at a time, the newest answer wins, at most once per second unless `final` (then queued behind one in flight). */
 private refreshReport(final=false){
  const v=this.view;if(!v)return;
  if(v.run.backendSetId===CELL_SET&&this.playing&&!final&&!(this.ui.inspectorOpen&&this.ui.tab==='report'))return;
  if(this.reportBusy){this.reportAgain||=final;return;}
  if(!final&&performance.now()<this.reportDue)return;
  this.reportBusy=true;this.reportDue=performance.now()+1000;const id=v.run.id,seq=++this.reportSeq;
  void this.fetchReport(id).then(r=>this.takeReport(id,seq,r),()=>{/* keep the last report */})
   .finally(()=>{this.reportBusy=false;if(this.reportAgain){this.reportAgain=false;this.refreshReport(true);}});
 }
 /** Every report request: aborted after STEP_TIMEOUT_MS as REPORT_TIMEOUT (a runtime that accepts and never answers never holds the page). */
 private fetchReport(id:string):Promise<RunReport>{
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_r,reject)=>{timer=setTimeout(()=>{c.abort();reject(new TwinRuntimeError('REPORT_TIMEOUT',[],0));},STEP_TIMEOUT_MS);});
  return this.current(Promise.race([this.rt.report(id,c.signal),timeout]).finally(()=>clearTimeout(timer)));
 }
 private act(kind:Parameters<TwinRuntime['action']>[1],payload?:Record<string,unknown>){return this.current(this.rt.action(this.view!,kind,payload)).then(v=>{if(kind==='pause'&&v.run.backendSetId===CELL_SET){this.applyView(v);this.refreshReport(true);return;}return this.apply(v);});}
 /** Recover display metadata from the recorded input; catalog entries provide labels/assets only. */
 private reclaimedPreset(v:RunView):TwinPreset {
  const input=v.lockedInput;
  if(!input)throw new TwinRuntimeError('RECLAIM_INPUTS_MISSING',[],502);
  if(input.scenarioId!==v.run.scenarioId||input.scenarioRevision!==v.run.scenarioRevision||input.seed!==v.run.seed||input.backendSetId!==v.run.backendSetId||input.mode!==v.run.mode||input.access!==v.run.access||!['mock','simulation'].includes(input.mode)||input.access!=='simulated'||!Number.isSafeInteger(input.seed))throw new TwinRuntimeError('RECLAIM_INPUTS_MISMATCH',[],502);
  let project:ReturnType<typeof validateProjectV2>;try{project=validateProjectV2(input.project);}catch{throw new TwinRuntimeError('RECLAIM_INPUTS_INVALID',[],502);}
  const labels=presets.find(p=>p.scenarioId===input.scenarioId);
  return {id:labels?.id??input.scenarioId,title:labels?.title??(()=>input.scenarioId),summary:labels?.summary??(()=>''),assets:labels?.assets??[],names:labels?.names??{},roles:labels?.roles??{entities:[],points:[]},
   mode:input.mode,project,seed:input.seed,scenarioId:input.scenarioId,scenarioRevision:input.scenarioRevision,backendSetId:input.backendSetId,
   // the locked engineering design (no receipt: a reclaimed run is read-only and never recompiled from here)
   ...input.engineering?{engineering:{project:structuredClone(input.engineering.project),receipt:null}}:{}};
 }
 private retired:string|null=null;
 /** The run the runtime no longer has (404): nothing more is asked about it. */
 private lostRun:string|null=null;
 /** The run whose evidence, record and archive are done. */
 private settled:string|null=null;
 /** Before the shown run is replaced: its evidence and the comparison record, both from its matching report, then it is archived.
  * A run the runtime no longer has (its RUN_NOT_FOUND for the report: a restart, run_lost) has no final report: that is said, and the new run is not blocked.
  * A RUN_NOT_FOUND from archive after the evidence was saved keeps that evidence and record. Any other failure blocks. */
 private async settlePrevious(){
  // once per run: create() asks before readiness (a finished run holds the host's slot) and again before the new run
  if(this.view&&(this.lostRun===this.view.run.id||this.settled===this.view.run.id))return;
  // only the runtime's own not-found answer for this run, from the report step, means the run is gone (a 404 that is not its JSON, or another not-found, proves nothing)
  const notFound=(e:unknown)=>e instanceof TwinRuntimeError&&e.status===404&&e.code==='RUN_NOT_FOUND';
  try{await this.saveEvidence();this.previous=this.view?await this.finalReport():this.report;}
  catch(e){
   if(!notFound(e)||!this.view)throw e;
   this.lostRun=this.view.run.id;this.previous=null;this.streams?.close();this.streams=null;clearInterval(this.ticker);
   this.notice=tr('Lần chạy trước không còn trên runtime (runtime khởi động lại hoặc mất lần chạy): không có báo cáo cuối, nên không lưu được bằng chứng của nó. Lần chạy mới vẫn được tạo.','前の実行はランタイムにありません(再起動または実行の喪失)。最終レポートがないため証跡は保存できませんでした。新しい実行は作成します。','The previous run is no longer on the runtime (restarted, or the run was lost): it has no final report, so its evidence could not be saved. The new run is created anyway.');
   return;
  }
  // its evidence and record are kept; a runtime that no longer has the run to archive changes nothing about them
  try{await this.retire();if(this.view)this.settled=this.view.run.id;}catch(e){
   if(!notFound(e)||!this.view)throw e;
   this.retired=this.settled=this.view.run.id;
   this.notice=tr('Bằng chứng của lần chạy trước đã lưu; runtime không còn lần chạy đó để lưu trữ (archive). Lần chạy mới vẫn được tạo.','前の実行の証跡は保存済みです。ランタイムにはアーカイブする実行がもうありません。新しい実行は作成します。','The previous run\'s evidence is saved; the runtime no longer had that run to archive. The new run is created anyway.');
  }
 }
 private async retire(){if(this.view&&!this.archived&&this.rt.archive&&this.retired!==this.view.run.id){this.streams?.close();this.streams=null;clearInterval(this.ticker);await this.rt.archive(this.view.run.id);this.retired=this.view.run.id;}}
 private async create(p:TwinPreset,start=true,faults?:readonly DriveFaultEntry[]){
  if(!this.health)throw new TwinRuntimeError('RUNTIME_UNAVAILABLE',[],0);
  const mismatch=this.pinBlock();if(mismatch)throw new TwinRuntimeError('RUNTIME_PIN_MISMATCH',mismatch,409);// never a run on a runtime the Lab is not pinned to
  // a finished run still owns the host's one Webots slot until it is archived: retire it before readiness, or the new run is refused WEBOTS_CAPACITY
  if(this.view&&(p.id==='mujoco-cell'||['completed','failed','cancelled'].includes(this.view.run.status)))await this.settlePrevious();
  if(this.health.features?.readiness){
   if(!this.rt.readiness)throw new TwinRuntimeError('READINESS_NOT_CHECKED',[],0);
   const ref=this.refOf(p);if(ref===null)throw new TwinRuntimeError('ENGINEERING_NOT_COMPILED',[],0);
   const snapshot=await (ref?this.rt.readiness(p.scenarioId,p.backendSetId,undefined,ref):this.rt.readiness(p.scenarioId,p.backendSetId,p.project));
   this.readiness=snapshot;this.watchReadinessExpiry();
   if(!ready(preflight(p,this.health,this.rt.paired,snapshot)))throw new TwinRuntimeError('RUNTIME_NOT_READY',snapshot.checks.flatMap(c=>c.reasonCodes),422);
  }
  // the schedule of this run is fixed here (a rerun passes the one its run had; a new run takes the studio's) and a schedule without a drive experiment is refused before the previous run is closed
  const studio=['mujoco-payload','mujoco-cell'].includes(p.id)&&this.driveFor===p.id;
  const block=faults===undefined&&studio?driveBlock(this.driveFaults.length,driveExperimentOf(p)):null;if(block)throw new TwinRuntimeError(block,[],0);
  this.runDrive=faults?structuredClone([...faults]):studio?structuredClone(this.driveFaults):undefined;
  await this.settlePrevious();
  this.worldAbort?.abort();this.worldAbort=null;this.worldBusy=false;this.exportAbort?.abort();this.clearWorld();this.gen++;this.payloadCancelPaused=false;this.archived=false;this.view=null;this.report=null;this.seen={};this.runPreset={...p,project:structuredClone(p.project)};this.stopReplay();this.replay=null;this.navigation=null;this.payloadBundle=null;const token=++this.sceneLoad;
  const ref=this.refOf(p);if(ref){if(p.backendSetId===MUJOCO_MOBILE_SET)this.payloadBundle=await loadPayloadBundle(this.rt,ref.bundleDigest).catch(()=>null);const s=await loadNavigationScene(this.rt,ref.bundleDigest).catch(()=>null);if(token===this.sceneLoad)this.navigation=s;}
  this.world=null;this.worldView=null;this.worldDrawing=null;this.worldRun='';const v=await this.current(this.rt.create(requestForPreset(p,this.runDrive),{sourceCommit:this.health.sourceCommit,schemaHash:this.health.schemaHash}));this.pinMismatch=null;
  if(p.id==='mujoco-payload'&&v.lockedInput?.engineering)this.runPreset={...this.runPreset!,project:structuredClone(v.lockedInput.engineering.runtimeProjection.project),assets:structuredClone(v.lockedInput.engineering.runtimeProjection.assets) as TwinPreset['assets']};
  await this.apply(v);this.rerender();this.openStreams(v);void this.refreshWorld();if(start){await this.act('start');if(this.clock()?.step&&p.id!=='mujoco-payload'&&p.id!=='mujoco-cell')await this.act('step',{ticks:STEP_TICKS});}
 }
 /** Cancellation needs native observations even when the source clock was paused. No new mission, force or observation tail. */
 private async cancelPayload(){
  if(this.runPreset?.id!=='mujoco-payload')return this.act('cancel');
  const epoch=this.gen,id=this.view?.run.id;let clockPaused=this.view?.run.status==='paused'||this.payloadCancelPaused;
  const current=()=>this.gen===epoch&&this.view?.run.id===id&&!this.left&&!this.archived&&!this.replay&&!this.view?.controlAccess;
  if(!current())return;
  this.playing=false;this.hiddenStop=false;this.payloadStopping=true;this.payloadStopPause=false;
  try{
   await this.act('cancel');if(!current())return;
   this.notice=tr('Đang chờ plant quan sát dừng sau yêu cầu hủy.','キャンセル後、プラントの停止観測を待っています。','Waiting for the plant to observe the requested stop.');this.rerender();
   if(clockPaused&&!this.payloadStopPause&&this.view?.run.status==='running'){await this.act('resume');if(!current())return;clockPaused=false;this.payloadCancelPaused=false;}
   for(let ticks=0;ticks<500&&current()&&!this.payloadStopPause&&this.view?.run.status==='running';ticks+=20){await this.act('step',{ticks:20,pace:{factor:1}});if(!current())return;}
   if(!current())return;
   if(this.payloadStopPause&&this.view?.run.status==='running'){
    if(!clockPaused){await this.act('pause');if(!current())return;}
    this.payloadCancelPaused=true;this.notice=tr('Đồng hồ đã tạm dừng theo yêu cầu; hủy vẫn chờ quan sát dừng.','操作によりクロックを一時停止しました。キャンセルは停止観測待ちです。','The clock is paused as requested; cancellation still awaits an observed stop.');
   }else this.notice=this.view?.run.status==='running'?tr('Hủy đang chờ quan sát dừng; đã hết cửa sổ 10 giây. Giữ trạng thái runtime, kiểm tra Chi tiết.','停止観測待ちのまま10秒の区間を終了しました。ランタイムの状態を保持し、詳細を確認してください。','Cancellation still awaits an observed stop after the 10 s window. The runtime state is retained; inspect Details.') : '';
  }finally{this.payloadStopping=false;this.payloadStopPause=false;}
 }
 private async play(){
  // nothing starts while another action holds the run or a pause is pending (Space, the button, a visible tab alike)
  // auto-run is the paced step (features.pacedStep, which every runtime the Lab is pinned to has); a runtime without it is stepped with +5 s
  if(this.busy||this.pausing||!this.view||!this.health?.features?.pacedStep||!clockControls(this.view,this.health).play)return;
  this.playing=true;this.hiddenStop=false;
  const live=()=>this.playing&&!!this.view&&['running','awaiting_confirmation'].includes(this.view.run.status);
  await this.call(async()=>{
   // one paced step in flight; the next goes when it returns, with its revision. The runtime holds each step at real time × factor:
   // no client timer paces anything, and a run nobody steps stands still (a hidden tab sends nothing after the step in flight)
   this.speedLog=[];this.measuredSpeed=undefined;
   this.pacedLoop=true;let priority:unknown=null;
   try{while(live()){if(document.visibilityState==='hidden'){this.hiddenStop=true;document.addEventListener('visibilitychange',this.onVisible);break;}await this.pacedStep();this.paint();}}
   // the loop ended for any reason: one report for where the run stands, and a priority Pause in flight is awaited and cleared
   finally{this.pacedLoop=false;this.refreshReport(true);priority=await this.priorityPause;this.priorityPause=null;}
   if(priority&&!(priority instanceof TwinRuntimeError&&priority.code==='REVISION_CONFLICT'))throw priority;
   // one press of Pause: the in-flight step has returned (this.view is its receipt), so pause carries the revision it returned
   if(this.pausing&&this.view&&['running','awaiting_confirmation'].includes(this.view.run.status)){
    await this.act('pause');this.pausing=false;// landed: the next render shows Resume
    // the pause control the user pressed becomes Resume: focus goes there, not to the page
    const a=typeof document.querySelector==='function'?document.activeElement as HTMLElement|null:null;if(!a||a===document.body||a.dataset?.action==='twin-pause')this.focusTo='#transport-twin-resume';
   }
  });
  this.playing=false;this.pausing=false;this.rerender();
 }
 /** The tab is shown again: auto-run resumes if it stopped only because the tab was hidden (a user's stop clears hiddenStop). */
 private onVisible=()=>{if(document.visibilityState==='hidden')return;document.removeEventListener('visibilitychange',this.onVisible);if(this.hiddenStop){this.hiddenStop=false;void this.play();}};
 /** One `step{ticks:20,pace:{factor}}` (the factor read now, so a change applies to the next step). A lost response is resent once with the same
  * actionId and body: the runtime returns the stored receipt instead of stepping again. A second failure stops the loop (call() shows it). */
 /** A step with no answer after STEP_TIMEOUT_MS is aborted and reported as lost (PACED_STEP_TIMEOUT). */
 private async stepOnce(v:RunView,payload:Record<string,unknown>,actionId:string){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),STEP_TIMEOUT_MS);
  try{return await this.current(this.rt.action(v,'step',payload,actionId,c.signal));}catch(e){if(c.signal.aborted)throw new TwinRuntimeError('PACED_STEP_TIMEOUT',[],0);throw e;}finally{clearTimeout(t);}
 }
 private async pacedStep(){
  const v=this.view!,payload={ticks:v.run.backendSetId===CELL_SET?50:PACED_TICKS,pace:{factor:this.runSpeed}},actionId=crypto.randomUUID();
  this.inFlightCell=v.run.backendSetId===CELL_SET?v:null;
  let next:RunView;try{next=await this.stepOnce(v,payload,actionId);}catch(e){if(this.view?.run.backendSetId===CELL_SET||stale(e)||!lostResponse(e))throw e;next=await this.stepOnce(v,payload,actionId);}finally{this.inFlightCell=null;}
  // the receipt is the view; the next step goes at once (the runtime re-anchors after 250 ms idle) and the report follows off this path
  this.applyView(next);this.refreshReport();
  // measured rate: simulated time advanced over wall time in the last 2 s (a slow plant or link shows here, never hidden behind the factor)
  const now=performance.now();this.speedLog=[...this.speedLog.filter(([t])=>now-t<=2000),[now,Number(next.simTimeNs)/1e9]];
  const [t0,s0]=this.speedLog[0]!,dt=(now-t0)/1000;this.measuredSpeed=dt>0?(Number(next.simTimeNs)/1e9-s0)/dt:undefined;
 }
 click(action:string,value?:string):void{
  // the Control tab's own actions: never the twin's run, whatever the twin is doing (replay, an opened report, a run in flight)
  if(action.startsWith('twin-ctl-'))return this.control.click(action,value);
  // following a problem to its object hands the view back to the viewport: the problems box closes
  if((action==='twin-select'||action==='twin-pick')&&value){const was=this.ui.problemsOpen;this.ui={...this.ui,problemsOpen:false};if(value===selectedEntity()&&was)this.rerender();return selectEntity(value);}
  // panels and boxes are view state: they never reach the runtime
  if(action==='twin-study-tab'&&(value==='run'||value==='study')){this.studyTab=value;return this.rerender();}
  if(action==='twin-study-replay'&&value){if(this.busy)return;const r=this.study?.runs.find(r=>r.runId===value),saved=this.saved.find(s=>s.report.manifest.runId===value&&s.report.navigation2d?.sceneDigest===r?.sceneDigest&&s.report.outcome.tick>=r!.replay.tick);if(!r||!saved){this.notice=tr('Hãy nhập thư mục bằng chứng của đúng lần chạy trước khi mở replay.','再生前に該当実行の証跡フォルダーを読み込んでください。','Import the evidence folder for this run before opening its replay.');return this.rerender();}this.studyTab='run';this.click('twin-open-evidence',saved.id);if(this.replay)this.replay.tick=r.replay.tick;return this.rerender();}
  if(action==='twin-inspector-toggle'||action==='twin-inspector-tab'){this.restoredControl=false;this.ui={...this.ui,inspectorOpen:action==='twin-inspector-tab'||!this.ui.inspectorOpen,tab:action==='twin-inspector-tab'&&TABS.includes(value as InspectorTab)?value as InspectorTab:this.ui.tab};saveUi(this.ui);return this.rerender();}
  if(action==='twin-tab-next'||action==='twin-tab-previous'){const tabs=TABS,i=tabs.indexOf(this.ui.tab),next=tabs[(i+(action==='twin-tab-next'?1:tabs.length-1))%tabs.length]!;
   this.focusTo=`#inspector-tab-${next}`;return this.click('twin-inspector-tab',next);}
  if(action==='twin-toggle-play')return this.click(this.replay?'twin-replay-play':this.playing?'twin-stop':'twin-play');
  if(action==='twin-watch'){this.ui={...this.ui,watch:!this.ui.watch};return this.rerender();}
  if(action==='twin-help'||action==='twin-help-close'&&this.helpOpen)return this.help();
  if(action==='twin-world-export')return void this.exportWorld();
  if(action==='twin-world-export-cancel'){this.exportAbort?.abort();return;}
  if(action==='twin-phase-follow'){this.storyCamera=storyCameraTransition(this.storyCamera,{type:'phase-follow',enabled:!this.storyCamera.phaseFollow});return this.paint();}
  if(action==='twin-story-camera'){this.storyCamera=storyCameraTransition(this.storyCamera,{type:'select',camera:value as StoryCamera,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});this.viewer?.camera(this.storyCamera.camera);return;}
  if(action==='twin-camera-home'){this.storyCamera=storyCameraTransition(this.storyCamera,{type:'manual-orbit'});return this.viewer?.home();}
  if(action==='twin-camera-fit'){this.storyCamera=storyCameraTransition(this.storyCamera,{type:'manual-orbit'});return this.viewer?.fit(this.vs.selected);}
  // one step per press: watch mode, then the open run-bar/viewport box, then the key list, then the inspector; the modal confirm closes itself
  if(action==='twin-escape'){
   const u=this.ui,box=Object.values(BOXES).find(k=>u[k]);if(this.confirming||this.reconcileTargets.length)return;// the modal confirm owns Escape (onKey leaves it alone)
   if(u.watch)this.ui={...u,watch:false};else if(box)this.ui={...u,[box]:false};else if(this.helpOpen)return this.help();else if(u.inspectorOpen){this.ui={...u,inspectorOpen:false};saveUi(this.ui);}else return;
   return this.paint();
  }
  if(Object.hasOwn(BOXES,action)){const k=BOXES[action as keyof typeof BOXES],open=!this.ui[k];this.ui={...this.ui,displayOpen:false,runtimeOpen:false,pickerOpen:false,problemsOpen:false,caveatOpen:false,[k]:open};return this.paint();}// in place during a paced run: opening a box replaces no control
  if(action==='twin-layer'&&this.vs.view==='3d'&&!THREE_D_LAYERS.includes(value as Layer))return;// drawn on the 2D plan only
  if(action==='twin-layer'){this.vs={...this.vs,layers:toggleLayer(this.vs.layers,value as Layer)};return this.rerender();}
  if(action==='twin-view'){if(value==='2d'){this.viewer?.dispose();this.viewer=null;}this.vs={...this.vs,view:value==='3d'&&!this.webglFailed?'3d':'2d'};return this.rerender();}
  // not paired: the pairing form comes back once the picker closes
  if(action==='twin-preset'){this.ui={...this.ui,pickerOpen:false,runtimeOpen:this.ui.runtimeOpen||!this.rt.paired};const p=presetById(value??'');if(p&&p!==this.preset){this.preset=p;if(p.id==='mujoco-payload')this.ui={...this.ui,inspectorOpen:true,tab:'setup'};if(p.speed)this.runSpeed=p.speed;if(p.mode==='simulation')this.scheduleDraft={...this.scheduleDraft,faultId:'cup-removed',targetId:''};void this.checkReadiness().then(()=>this.rerender());if(!this.view)selectEntity(null);}return this.rerender();}
  if(action==='twin-readiness')return void this.call(()=>this.checkReadiness());
  if(action==='twin-dismiss'){this.notice='';return this.rerender();}
  // a runtime on another origin, paired earlier in this tab (the bearer survived a reload): reaching it is still the user's click
  // the form's own submit (button or Enter) carries the fields; without the form (paired) Connect reaches the saved runtime with its bearer
  if(action==='twin-connect'){if(document.getElementById('twin-pair-form'))return;return this.connect(this.rt.paired?targetAddress(this.target()):this.addressDraft,this.tokenDraft);}
  if(action==='twin-disconnect'&&!this.busy&&!this.playing){this.control.invalidate();this.rt.forget();this.dropRuntime();this.runtimeError=null;this.ui={...this.ui,runtimeOpen:true};return this.rerender();}
  if(action==='twin-reclaim'&&value&&this.rt.reclaim)return void this.call(async()=>{
   const reclaimed=await this.current(this.rt.reclaim!(value));
   this.exportAbort?.abort();this.clearWorld();this.gen++;this.stopReplay();this.replay=null;this.archived=false;this.streams?.close();this.streams=null;clearInterval(this.ticker);
   this.view=null;this.report=null;this.runPreset=null;this.seen={};
   this.runPreset=this.reclaimedPreset(reclaimed);this.loadScene(reclaimed.lockedInput?.engineering?.ref.bundleDigest);await this.apply(reclaimed);this.openStreams(reclaimed);
   this.notice=tr('Đã mở lại để xem và đối soát. Không phát lại chuyển động.','表示と照合のみで再開しました。動作は再送されません。','Reopened for viewing and reconciliation. Motion is not replayed.');
  });
  if(action.startsWith('twin-drivefault-')){
   if(this.busy||this.playing||this.replay||this.archived)return;
   const catalog=faultCatalogOf(this.health),ctx=driveFaultContext(this.preset.id);if(!catalog.length||!ctx)return;
   this.driveOpen=true;
   if(action==='twin-drivefault-add'){
    this.readDriveFields();   // the fields are read where they are: a click that follows an edit must not depend on the edit's change event having been handled first
    const r=draftToEntry(this.driveDraft??defaultDraft(catalog,ctx),catalog);
    if(!r.ok)return this.driveRefuse(r.code);
    if(this.driveFaults.length>=MAX_DRIVE_FAULTS)return this.driveRefuse('FAULT_SCHEDULE_TOO_LONG');
    this.driveFaults=[...this.driveFaults,r.entry];this.driveMessage=null;this.driveCheck={state:'idle',codes:[]};return this.rerender();
   }
   if(action==='twin-drivefault-remove'){this.driveFaults=this.driveFaults.filter(e=>e.id!==value);this.driveCheck={state:'idle',codes:[]};return this.rerender();}
   if(action==='twin-drivefault-clear'){this.driveFaults=[];this.driveMessage=null;this.driveCheck={state:'idle',codes:[]};return this.rerender();}
   if(action==='twin-drivefault-export'){const url=URL.createObjectURL(new Blob([serialiseSchedule(this.driveFaults)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='drive-fault-schedule.json';a.click();URL.revokeObjectURL(url);return;}
   if(action==='twin-drivefault-check'){
    if(!this.rt.checkDriveFaults||!this.driveFaults.length||this.driveCheck.state==='checking')return;
    if(this.driveBlocked())return this.rerender();
    const body=this.driveBody(),key=JSON.stringify(body),epoch=this.gen;
    this.driveCheck={state:'checking',codes:[],key};this.rerender();
    return void this.rt.checkDriveFaults(body).then(r=>{if(epoch!==this.gen)return;this.driveCheck=r.ok?{state:'ok',codes:[],key}:{state:'refused',codes:r.codes,error:r.error,key};this.rerender();}).catch(e=>{if(epoch!==this.gen)return;this.driveCheck={state:'idle',codes:[]};this.driveMessage=e instanceof TwinRuntimeError?`${e.code}${e.reasonCodes.length?`: ${e.reasonCodes.join(', ')}`:''}`:String(e);this.rerender();});
   }
  }
  if(action==='twin-fault-jump'&&this.report&&!this.busy){
   // the report's fired entry: the replay cursor goes to its applied tick (the replay is opened first when it is not)
   const tick=Number(value);if(!Number.isInteger(tick)||tick<0)return;
   if(this.replay){this.replay.tick=Math.min(tick,this.replay.rp.range.toTick);this.scrubbed();return;}
   return void this.call(async()=>{await this.startReportReplay();if(this.replay)this.replay={...this.replay,tick:Math.min(tick,this.replay.rp.range.toTick)};});
  }
  if(action.startsWith('twin-schedule-')||action==='twin-project-export'){
   if(this.busy||this.playing||this.replay||this.archived)return;
   if(action==='twin-schedule-add'||action==='twin-schedule-remove'){try{this.preset={...this.preset,project:editSchedule(this.preset.project,action==='twin-schedule-add'?[...this.preset.project.faultSchedule??[],draftEntry(this.scheduleDraft,this.preset.project,this.preset.mode??'mock')]:(this.preset.project.faultSchedule??[]).filter(e=>e.id!==value),this.preset.mode??'mock')};this.readiness=null;}catch(error){this.notice=String(error);}return this.rerender();}
   if(action==='twin-schedule-save')return void this.call(()=>this.projects.saveV2(this.preset.project));
   if(action==='twin-schedule-load')return void this.call(async()=>{const p=await this.projects.loadV2(this.preset.project.id);if(p){this.preset={...this.preset,project:p};this.readiness=null;}});
   if(action==='twin-project-export'){const url=URL.createObjectURL(new Blob([JSON.stringify(this.preset.project,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lab-project.json';a.click();URL.revokeObjectURL(url);return;}
  }
  if(action==='twin-report-reload')return void this.call(async()=>{await this.finalReport();});
  if(action==='twin-save-evidence')return void this.call(()=>this.saveEvidence());
  if(action==='twin-open-evidence'&&value){const saved=this.saved.find(s=>s.id===value);if(!saved||this.busy)return;this.exportAbort?.abort();this.clearWorld();this.gen++;this.playing=false;this.streams?.close();this.streams=null;clearInterval(this.ticker);this.stopReplay();this.archived=true;this.report=structuredClone(saved.report);const preset=presets.find(p=>p.scenarioId===saved.report.manifest.scenario.id)??this.preset;this.runPreset={...preset,project:structuredClone(saved.project)};const m=saved.report.manifest;this.loadScene(m.engineering?.bundleDigest);if(saved.payloadBundle){this.sceneLoad++;this.payloadBundle=saved.payloadBundle;this.navigation=saved.payloadBundle.scene;}this.view={run:{schemaVersion:2,id:m.runId,mode:m.mode==='simulation'?'simulation':'mock',access:m.access,backendSetId:m.backendSetId,backends:m.backends.map(b=>b.id),status:saved.report.outcome.status as RunView['run']['status'],runRevision:0,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:m.sourceCommit,scenarioId:m.scenario.id,scenarioRevision:m.scenario.revision,seed:m.seed},tick:saved.report.outcome.tick,simTimeNs:saved.report.outcome.simTimeNs,model:m.backends[0]?.model??'unknown',entities:saved.project.entities.filter(e=>e.kind==='amr').map(e=>({id:e.id,kind:'amr',pose:{x:NaN,y:NaN,yawRad:NaN},quality:'stale',moving:false,hold:null,goal:null,path:[],distanceM:NaN})),workload:[],awaiting:[],attention:[],served:saved.report.outcome.served,coffee:null};this.replay={rp:openReplayV2(this.report),tick:saved.report.outcome.tick,playing:false};return this.rerender();}
  // export and replay are records of the run as shown: they wait for its matching report (finalReport)
  const current=!this.view||this.reportFits();// a matching report acts at once, as before; otherwise the action waits for the fetch
  if(action==='twin-export'&&this.report)return current?this.download(value??'json',this.report):void this.call(async()=>{this.download(value??'json',await this.finalReport());});
  if(action==='twin-replay'&&this.report&&!this.busy){
   return void this.call(()=>this.startReportReplay());
  }
  if(action==='twin-replay-exit'){this.stopReplay();this.replay=null;if(this.archived){this.exportAbort?.abort();this.clearWorld();this.gen++;this.archived=false;this.view=null;this.report=null;this.runPreset=null;}this.painted='';return this.rerender();}
  if(action==='twin-replay-play'&&this.replay){
   if(this.replay.playing){this.stopReplay();return this.rerender();}
   this.replay.playing=true;if(this.replay.tick>=this.replay.rp.range.toTick)this.replay.tick=0;
   // playback rate is a view setting: 10x recorded time; it never touches the runtime
   this.replayTimer=setInterval(()=>{const r=this.replay;if(!r){this.stopReplay();return;}r.tick=Math.min(r.rp.range.toTick,r.tick+25);this.scrubbed(true);if(r.tick>=r.rp.range.toTick){this.stopReplay();this.rerender();}},50);
   return this.rerender();
  }
  if(this.replay||this.archived)return;
  if(action==='twin-run')return void this.call(()=>this.create(this.resolve(this.preset)));
  if(action==='twin-reset')return this.view&&this.runPreset?void this.call(()=>this.create(this.runPreset!,false,this.runDrive??[])):undefined;
  if(action==='twin-start')return void this.call(()=>this.act('start'));
  if(action==='twin-rerun')return this.view&&this.runPreset?void this.call(()=>this.create(this.runPreset!,true,this.runDrive??[])):undefined;
  if(!this.view)return;
  if(this.view.controlAccess&&!['twin-reconcile','twin-confirm-cancel','twin-confirm-ok'].includes(action))return;
  if(action==='twin-step'&&this.clock()?.step)return void this.call(()=>this.act('step',{ticks:STEP_TICKS}));
  if(action==='twin-play')return void this.play();
  if(action==='twin-stop'){this.playing=false;this.hiddenStop=false;return this.rerender();}
  if(action==='twin-cancel')return void this.call(()=>this.cancelPayload());
  if(action==='twin-pause'&&this.payloadStopping){this.payloadStopPause=true;return this.paint();}
  if(action==='twin-pause'&&(this.playing||this.pausing)){if(this.playing&&this.health?.features?.pacedStep&&!this.pausing){this.pausing=true;this.playing=false;this.hiddenStop=false;if(this.inFlightCell){const admitted=this.inFlightCell;this.priorityPause=this.current(this.rt.action(admitted,'pause',{},crypto.randomUUID())).then(v=>{if(this.view&&v.run.runRevision>=this.view.run.runRevision)this.applyView(v);this.paint();return null;},e=>e);}this.paint();}return;}
  if(action==='twin-pause')return void this.call(()=>this.act('pause'));
  if(action==='twin-resume')return void this.call(async()=>{await this.act('resume');this.payloadCancelPaused=false;});
  if(action==='twin-fault')return void this.call(()=>this.act('injectFault',{faultId:this.fault}));
  if(action==='twin-restore-cup'){this.reconcileTargets=[];this.confirming=this.view.coffee?.jobs.find(j=>j.canRestoreCup)?.jobId??null;this.confirmationKind='restoreCup';return this.rerender();}
  if(action==='twin-reconcile'){this.confirmationKind='reconcile';this.reconcileTargets=this.knownReconciliationTargets();this.confirming=this.reconcileTargets.length===1?this.reconcileTargets[0]!:null;return this.rerender();}
  if(action==='twin-confirm-cancel'){this.confirming=null;this.reconcileTargets=[];return this.rerender();}
  if(action==='twin-confirm-ok'&&this.confirming){const subjectId=this.confirming;this.confirming=null;this.reconcileTargets=[];if(this.confirmationKind==='reconcile'&&!this.knownReconciliationTargets().includes(subjectId))return this.rerender();return void this.call(()=>this.act(this.confirmationKind,{subjectId}));}
 }
 /** Leaving a runtime (Disconnect, another address): its streams close and its run goes with it; that run can be reclaimed after reconnecting to it. */
 private dropRuntime(){
  this.exportAbort?.abort();this.clearWorld();this.gen++;this.streams?.close();this.streams=null;this.streamRun='';clearInterval(this.ticker);this.stopReplay();this.replay=null;this.archived=false;this.playing=false;this.hiddenStop=false;
  this.view=null;this.report=null;this.runPreset=null;this.seen={};this.link={state:'closed',lastHeartbeatMs:null,paused:false};
  this.health=null;this.healthChecked=false;this.readiness=null;this.pinMismatch=null;
 }
 private knownReconciliationTargets(){return this.view?[...new Set(this.view.attention.map(a=>reconciliationSubject(a,this.view!)).filter((id):id is string=>id!==null))]:[];}
 /** Whatever sits in the studio's fields now becomes the draft: an edit not yet committed by a change event must survive a repaint and be what Add uses. */
 private readDriveFields(){
  const catalog=faultCatalogOf(this.health),ctx=driveFaultContext(this.preset.id),field=(id:string)=>(document.getElementById(id) as HTMLInputElement|HTMLSelectElement|null)?.value;
  if(!catalog.length||!ctx||field('twin-df-fault')===undefined)return;
  const base=this.driveDraft??defaultDraft(catalog,ctx),item=catalog.find(f=>f.id===field('twin-df-fault'));if(!item)return;
  // the parameter inputs on the page belong to the fault the studio was last painted with: right after a fault is chosen they are still the previous fault's, and the new defaults stand
  if((document.querySelector('.drive-fault-draft') as HTMLElement|null)?.dataset.fault!==item.id)return;
  this.driveDraft={faultId:item.id,targetId:field('twin-df-target')??base.targetId,atMs:field('twin-df-at')??base.atMs,params:Object.fromEntries(Object.keys(item.params).map(k=>[k,field(`twin-df-p-${k}`)??(item.id===base.faultId?base.params[k]:undefined)??'']))};
 }
 /** A refusal of the studio's own, shown under the schedule (the runtime's refusals come from Check). */
 private driveRefuse(code:string){this.driveMessage=`${code} · ${faultCodeWords(code)}`;this.driveOpen=true;this.rerender();}
 private driveChange(id:string,value:string):boolean{
  if(this.busy||this.playing||this.replay||this.archived)return true;
  const catalog=faultCatalogOf(this.health),ctx=driveFaultContext(this.preset.id);if(!catalog.length||!ctx)return true;
  const draft=this.driveDraft??(this.driveDraft=defaultDraft(catalog,ctx));
  if(id==='twin-drive-experiment'){try{this.preset=selectDriveExperiment(this.preset,value);}catch{return true;}this.driveCheck={state:'idle',codes:[]};
   // the cell's experiment is a request field and changes nothing the runtime was asked to ready; a mobile run's is in its engineering project, which is compiled again
   if(this.preset.id!=='mujoco-cell'){this.readiness=null;void this.checkReadiness(this.preset).then(()=>this.rerender());}this.rerender();return true;}
  if(id==='twin-df-fault'){const item=catalog.find(f=>f.id===value);if(item)this.driveDraft={faultId:item.id,targetId:faultTargets(item,ctx)[0]??'',atMs:draft.atMs,params:defaultParams(item)};}
  else if(id==='twin-df-target')this.driveDraft={...draft,targetId:value};
  // a text field's change fires on blur, which is the mousedown of the next click: repainting there would swallow that click (the Add button), so the value is only kept
  else if(id==='twin-df-at'){this.driveDraft={...draft,atMs:value};return true;}
  else if(id.startsWith('twin-df-p-')){this.driveDraft={...draft,params:{...draft.params,[id.slice('twin-df-p-'.length)]:value}};return true;}
  else return false;
  this.rerender();return true;
 }
 change(id:string,value:string){if(id.startsWith('twin-ctl-'))return this.control.change(id,value);if((id==='twin-drive-experiment'||id.startsWith('twin-df-'))&&this.driveChange(id,value))return;if(id==='twin-world-experiment'&&this.health?.capabilities?.includes('sim3d_world_experiments_v1')&&this.health.worldExperiments?.some(e=>e.id===value&&e.requiresNewRun)&&this.preset.id==='mujoco-cell'&&!this.busy&&!this.playing&&(WORLD_EXPERIMENTS as readonly string[]).includes(value)){this.preset={...this.preset,worldExperimentId:value as TwinPreset['worldExperimentId']};return this.rerender();}if(id==='twin-payload-experiment'&&!this.busy&&!this.playing&&!this.replay&&!this.archived){this.preset=selectPayloadExperiment(this.preset,value);this.readiness=null;void this.checkReadiness(this.preset).then(()=>this.rerender());return this.rerender();}if(id==='twin-runtime-here'||id==='twin-runtime-other')return this.where(id==='twin-runtime-here');if(id==='twin-backend-set'&&!this.busy&&!this.playing&&!this.replay&&!this.archived){const set=backendSetOptions(this.health).find(s=>s.id===value&&s.selectable)?this.health!.backendSets.find(s=>s.id===value):undefined;if(set){const compatible=set.id===CELL_SET?presetById('mujoco-cell'):set.id===MUJOCO_MOBILE_SET?presetById('mujoco-payload'):set.id===WEBOTS_ARM_SET?presetById('webots-coffee'):set.id===MUJOCO_ARM_SET?presetById('mujoco-coffee'):['webots-coffee','mujoco-coffee'].includes(this.preset.id)?presetById(set.mode==='mock'?'coffee':'native-bv01'):set.mode==='simulation'&&this.preset.scenarioId==='BV01'?presetById('native-bv01'):set.mode==='mock'&&this.preset.id==='native-bv01'?presetById('coffee'):this.preset;if(compatible&&compatible.id!==this.preset.id&&compatible.speed)this.runSpeed=compatible.speed;this.preset={...(compatible??this.preset),mode:set.mode as 'mock'|'simulation',backendSetId:set.id};if(set.mode==='simulation')this.scheduleDraft={...this.scheduleDraft,faultId:'cup-removed',targetId:''};this.readiness=null;void this.checkReadiness(this.preset).then(()=>this.rerender());}return this.rerender();}if(id.startsWith('twin-schedule-')){const d=this.scheduleDraft;if(id==='twin-schedule-fault'){d.faultId=value;d.targetId='';}if(id==='twin-schedule-target')d.targetId=value;if(id==='twin-schedule-trigger'&&(value==='phase'||value==='elapsed_sim_ms')){d.trigger=value;d.value=value==='phase'?'grasp':'1000';}if(id==='twin-schedule-value')d.value=value;if(id==='twin-schedule-duration')d.durationMs=value;return this.rerender();}if(id==='twin-reconcile-target'&&this.confirmationKind==='reconcile'){this.confirming=this.reconcileTargets.includes(value)&&this.knownReconciliationTargets().includes(value)?value:null;return this.rerender();}if(id==='twin-run-speed'&&(SPEED_FACTORS as readonly number[]).includes(Number(value))){this.runSpeed=Number(value);this.paint();}if(id==='twin-speed-limit'){const n=Number(value);if(Number.isFinite(n)&&n>0&&n<=0.5){this.preset={...this.preset,project:{...this.preset.project,revision:this.preset.project.revision+1,entities:this.preset.project.entities.map(e=>e.kind==='amr'?{...e,speedLimitMps:n}:e)}};this.rerender();}}if(id==='twin-fault')this.fault=value;if(id==='twin-replay-cursor')this.input(id,value);}
 /** Scrub: update the replay body and the scene in place so the range input keeps focus and drag state. */
 input(id:string,value:string){
  if(id.startsWith('twin-ctl-'))return this.control.input(id,value);
  // the address error goes as soon as the field no longer holds the value that failed; no re-render, so focus and caret stay
  if(id==='twin-runtime-url'){this.addressDraft=value;this.radios(value);if(this.runtimeError==='INVALID_RUNTIME_URL'&&value!==this.failedAddress){this.runtimeError=null;document.getElementById('twin-runtime-url-error')?.remove();const f=document.getElementById(id);f?.removeAttribute('aria-invalid');f?.removeAttribute('aria-describedby');}return;}
  if(id!=='twin-replay-cursor'||!this.replay)return;this.replay.tick=Number(value);this.scrubbed();}
 private scrubbed(played=false){// played: moved by playback, so the scrubber follows even with focus (a drag is never overwritten)
  const r=this.replay!;morphInner(document.getElementById('twin-replay-body'),replayBody(r,this.vs.selected));
  const verification=document.querySelector('[data-testid="controller-verification"]');if(verification&&this.report)morphOuter(verification,controllerVerificationHtml(this.report,r.tick));
  if(this.report){morphOuter(document.getElementById('payload-physics')!,physicsHtml(this.report,r.tick));morphOuter(document.getElementById('payload-timeline')!,physicsTimeline(this.report,r.tick));}
  if(this.report)morphInner(document.getElementById('twin-navigation-evidence'),navigationAtCursor(this.report,r.tick));
  const range=document.getElementById('twin-replay-cursor') as HTMLInputElement|null;if(range&&(played||document.activeElement!==range))range.value=String(r.tick);
  this.painted='';this.tick();
 }
 private download(format:string,r:RunReport){
  const name=`mekoniq-run-${r.manifest.scenario.id}-seed${r.manifest.seed}-${r.manifest.runId.slice(0,8)}`;
  const [body,type,ext]=format==='csv'?[reportCsv(r),'text/csv','csv']:format==='html'?[reportHtml(r,this.previous?{compareWith:this.previous}:{}),'text/html','html']:[reportJson(r),'application/json','json'];
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type}));a.download=`${name}.${ext}`;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }
 submit(form:HTMLFormElement){
  if(form.id==='twin-ctl-form'){void this.control.run();return true;}
  if(form.id!=='twin-pair-form')return false;
  this.connect((form.querySelector('#twin-runtime-url') as HTMLInputElement|null)?.value??'',(form.querySelector('#twin-pair-token') as HTMLInputElement).value);
  return true;
 }
 /** "This machine" means this page's runtime on a page served from this machine, else the launcher's runtime at THIS_MACHINE; "another address" keeps what is typed.
  * Updated in place (no re-render): the field keeps focus and caret. */
 private where(here:boolean){
  const f=document.getElementById('twin-runtime-url') as HTMLInputElement|null;
  this.whereChoice=here?'here':'other';
  if(here){const v=onLoopbackPage()?'':THIS_MACHINE;if(f)f.value=v;this.input('twin-runtime-url',v);}else f?.focus();
 }
 private radios(value:string){const d=value.trim().replace(/\/(lab\/v2\/?)?$/,''),here=!d&&onLoopbackPage()||d===THIS_MACHINE;this.whereChoice=here?'here':'other';
  for(const [id,on] of [['twin-runtime-here',here],['twin-runtime-other',!here]] as const){const r=document.getElementById(id) as HTMLInputElement|null;if(r)r.checked=on;}}
 /** The runtime box's one way in (Pair and Connect): parse the address, save it, reach the runtime (health), compare its commit with the pin, then pair with the code
  * (none needed while a bearer for that runtime is held). Nothing is sent before this click to any runtime but a loopback page's own (mayAutoProbe). */
 private connect(address:string,token:string){
  // a page from the web has no runtime of its own: the empty address is never sent there
  if(!address.trim()&&!onLoopbackPage()){this.runtimeError='NO_RUNTIME_ON_THIS_PAGE';this.ui={...this.ui,runtimeOpen:true};this.paint();return;}
  let t:RuntimeTarget;try{t=parseTarget(address,location.origin);}catch{this.addressDraft=address;this.failedAddress=address;this.runtimeError='INVALID_RUNTIME_URL';this.paint();return;}
  this.runtimeError=null;this.tokenDraft='';
  // another address: drop the old session and everything learned from the old runtime; the new one is reached by this click
  if(t.base!==this.target().base){this.control.invalidate(t.base);saveTarget(t.kind==='same_origin'?null:address);this.rt.retarget?.(t);this.dropRuntime();}
  this.addressDraft=targetAddress(t);
  void this.call(async()=>{
   try{
    if(!this.health)try{this.health=await this.current(net(this.rt.health()));}finally{this.healthChecked=true;this.settleRestoredTab();}
    if(t.kind!=='same_origin')this.pinExpected=await pinnedCommit().catch(()=>this.pinExpected);
    // a commit that is not the pin blocks creating runs (pinBlock), never pairing, viewing, reclaiming or reading reports: the box stays open and shows both commits
    if(!this.rt.paired){if(!token)throw new TwinRuntimeError('NO_PAIRING_CODE',[],0);this.control.invalidate();await net(this.rt.pair(token));this.notice=tr('Runtime v2 đã ghép nối.','ランタイムv2とペアリングしました。','Runtime v2 paired.');}
    this.ui={...this.ui,runtimeOpen:!!this.pinBlock()};await this.checkReadiness();
   }catch(e){
    // said once, in the box (a runtime that was not there at all is said by boxError()); anything else is the page's notice
    if(!(e instanceof TwinRuntimeError))throw e;
    this.runtimeError=!this.health&&t.kind==='same_origin'?null:e.code;this.ui={...this.ui,runtimeOpen:true};
   }
  });
 }
 private help(){/* the key list: opening it moves focus to its close button; closing it returns focus to the control that had it (found again after the re-render) */const a=document.activeElement as HTMLElement|null;this.helpOpen=!this.helpOpen;if(this.helpOpen)this.helpReturn=a?.id?`#${a.id}`:a?.dataset?.action?`[data-action="${a.dataset.action}"]`:null;this.focusTo=this.helpOpen?'#twin-shortcuts [data-action="twin-help-close"]':this.helpReturn;this.rerender();}
 get selected(){return selectedEntity();}
}
