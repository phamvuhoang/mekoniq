// SIM-10 scenario matrix: one row per verification id (lab/docs/specs/2026-11-05-digital-twin/verification.md §FD/BV/SYS) bound to the
// runner scenarios of the registry, requirement refs, fixtures, tests, backend support, an oracle and the invariants/measurements the
// evidence builder evaluates. `admitScenario` answers before any effect: a missing required backend is unavailable, never a mock fallback.
// backendSupport is what THIS runtime implements (hardware is plan 03+), not the spec's M/S/H wish list, which lives in requirementIds.
import {defaultCatalog,type CapabilityCatalog,type Mode} from './capabilities';
import {scenarioRegistry,type ScenarioDefinition} from './scenario-registry';
export interface MatrixRow {
 id:string;title:string;requirementIds:string[];
 /** Registry scenarios the row owns ([] = covered by domain/acceptance tests only). */
 runnerScenarios:string[];fixtures:string[];
 /** `path::test title` or a bare file; the file must exist in the source checkout. */
 tests:string[];backendSupport:{mock:boolean;simulation:boolean;hardware:boolean};oracle:string;
 /** Physics/plant quantities only a simulation backend can produce; not_run in mock, named so a report never silently omits them. */
 measurements:string[];
 /** Business invariants evaluated on the journal-backed report in every mode (reports/simulation-evidence.ts). */
 invariants:string[];
 /** The row needs the coffee cell (process model + arm) besides the AMR. */
 cell:boolean;
}
const R='tests/fixtures/digital-twin/restaurant-v2.json',K='tests/fixtures/digital-twin/corridor-v2.json',SC='tests/fixtures/digital-twin/scenarios',CUP='tests/fixtures/digital-twin/assets/cup-v1.json';
const ACC=(id:string)=>`tests/acceptance/lab-v2-mock.acceptance.test.ts::${id}`,MOCK=(t:string)=>`tests/integration/lab-v2-mock.test.ts::${t}`,MIX=(t:string)=>`tests/integration/lab-v2-mixed.test.ts::${t}`;
const FOOD=['served-after-handoff','arrival-from-observation'],PHYS=['contacts','minSeparationM','physical-stop','sensor-evidence'];
const BEV=[...FOOD,'cup-ownership-traceable','recipe-steps-in-order','no-measured-provenance-from-model'];
const amr={mock:true,simulation:true,hardware:false},business={mock:true,simulation:false,hardware:false};
const armsim={mock:true,simulation:true,hardware:false},ARMC='integrations/arm-controller/tests';
export const armRows:readonly MatrixRow[]=[
 {id:'ARM01',title:'Pose/joint fixture: independent FK, seeded IK, approach->grasp->place trace with commanded and actual apart',requirementIds:['ARM-01','ARM-03','UX-13','UX-14','UX-15'],runnerScenarios:[],fixtures:['integrations/arm-controller/models/puma560-reference/reference-poses.json'],cell:true,
  tests:['tests/integration/lab-v2-arm-model.test.ts','tests/integration/lab-v2-arm.test.ts',`${ARMC}/test_model_units.py`],backendSupport:armsim,oracle:'units and frames explicit; FK/IK residual under the fixture tolerance; commanded and actual joints never merged; controller_sim origin from the bridge',measurements:['controller-trace'],invariants:[]},
 {id:'ARM02',title:'Target outside the workspace, joint limit or invalid configuration refused with a reason',requirementIds:['ARM-03'],runnerScenarios:[],fixtures:['integrations/arm-controller/models/puma560-reference/reference-poses.json'],cell:true,
  tests:['tests/integration/lab-v2-arm-model.test.ts',`${ARMC}/test_model_units.py`,`${ARMC}/test_arbiter.py`],backendSupport:armsim,oracle:'solver/controller refuses with a structured reason; nothing is clipped into a success; no trajectory outside the limits',measurements:['controller-rejection'],invariants:[]},
 {id:'ARM03',title:'Self, scene/fixture/robot and attached-cup swept-path collision over the whole trajectory, thin obstacle between samples',requirementIds:['ARM-04','SIM-05','UX-19'],runnerScenarios:[],fixtures:['tests/fixtures/digital-twin/arm-fk-golden.json'],cell:true,
  tests:['tests/integration/lab-v2-arm-collision-evidence.test.ts','tests/integration/lab-v2-arm-safety-model.test.ts','tests/integration/lab-v2-arm-scene.test.ts','tests/integration/lab-v2-arm-inactive-scene.test.ts','robotics/simulation/tests/test_arm_swept_path.py'],backendSupport:armsim,
  oracle:'geometric checker over every interval with a conservative bound; allowed contacts only per phase; missing checker/geometry/trace or a revision mismatch is not_run and blocks R-SIM; a viewer overlap is never evidence',measurements:['collision-check','swept-path-coverage'],invariants:[]},
 {id:'ARM04',title:'Near singularity, IK branch change, velocity/acceleration beyond limits',requirementIds:['ARM-03'],runnerScenarios:[],fixtures:['integrations/arm-controller/models/puma560-reference/reference-poses.json'],cell:true,
  tests:['tests/integration/lab-v2-arm-model.test.ts',`${ARMC}/test_model_units.py`],backendSupport:armsim,oracle:'continuity kept or refused by policy; trajectory bounded by real limits; solver/controller trace recorded',measurements:['controller-continuity'],invariants:[]},
 {id:'ARM05',title:'Following error, stop or E-stop during motion, then reset',requirementIds:['ARM-05','ARM-07','HW-03'],runnerScenarios:[],fixtures:['tests/fixtures/digital-twin/arm/messages.json'],cell:true,
  tests:['tests/integration/lab-v2-arm-faults.test.ts',`${ARMC}/test_arbiter.py`,`${ARMC}/test_hmi_actions.py`],backendSupport:armsim,oracle:'request, ACK and observed stop kept apart; reset never resumes; actual joint and cup state reconciled',measurements:['physical-stop'],invariants:['cup-ownership-traceable']},
 {id:'ARM06',title:'Lost link or reboot after accepted and before completed',requirementIds:['ARM-06','ARM-07','BV-06'],runnerScenarios:[],fixtures:['tests/fixtures/digital-twin/arm/messages.json','integrations/arm-controller/tests/fixtures/coffee-handoff.json'],cell:true,
  tests:['tests/integration/lab-v2-arm.test.ts',`${ARMC}/test_bridge_recovery.py`,'tests/integration/lab-v2-recovery.test.ts'],backendSupport:armsim,oracle:'no blind resend; unknown keeps resource/cup ownership until reconcile; reconnect never runs by itself',measurements:['controller-reconcile'],invariants:['cup-ownership-traceable']},
];
export const scenarioMatrix:readonly MatrixRow[]=[
 ...armRows,
 {id:'FD01',title:'One order, one robot: kitchen -> table -> parking',requirementIds:['FD-01','FD-02','FD-04','FD-08'],runnerScenarios:['FD01'],fixtures:[R],cell:false,
  tests:[MOCK('FD01: same seed and inputs give the same canonical outcome, built from journal events and three observed legs'),'tests/integration/lab-v2-sil-campaign.test.ts','tests/integration/lab-v2-simulation-report.test.ts',ACC('FD01')],
  backendSupport:amr,oracle:'served only after CargoLoaded and DeliveryHandedOff in the journal; arrival from an observed completion; parked, never charging',measurements:PHYS,invariants:[...FOOD,'parked-not-charging']},
 {id:'FD02',title:'Two tables on one batched mission with food and an identified cup',requirementIds:['FD-01','FD-04','FD-08'],runnerScenarios:['FD02','FD02-cups'],fixtures:[R,CUP],cell:true,
  tests:[MIX('FD02-cups carries food and its identified coffee cup on one mission, then serves each allocation once'),ACC('FD02')],
  backendSupport:amr,oracle:'each handoff transfers only its own allocation; cup ids never mix; remaining stops and cargo match the journal',measurements:PHYS,invariants:[...FOOD,'cup-ownership-traceable']},
 {id:'FD03',title:'A person crosses the route on schedule, then leaves',requirementIds:['FD-02','FD-03','SIM-10'],runnerScenarios:['FD03'],fixtures:[R,`${SC}/fd03-crossing.json`],cell:false,
  tests:[MOCK('contact with an injected obstacle fails the leg; no arrival, no completion, contact counted'),ACC('FD03'),'robotics/simulation/tests/test_dynamic_scene.py'],
  backendSupport:amr,oracle:'no modelled contact; resume carries a reason; SIL adds sampled trajectory, contacts and separation from the engine',measurements:[...PHYS,'sampled-trajectory'],invariants:[...FOOD,'no-false-arrival']},
 {id:'FD04',title:'A chair blocks the table; the only lane closes, then reopens',requirementIds:['FD-02','FD-03','SIM-10'],runnerScenarios:['FD04','FD04-blocked','FD04-reopen'],fixtures:[R,`${SC}/fd04-blocked.json`],cell:false,
  tests:[MOCK('unreachable goal is rejected by the model and never completes the mission'),ACC('FD04-chair'),ACC('FD04-blocked'),ACC('FD04-reopen')],
  backendSupport:amr,oracle:'no false arrival; blocked/no-path/attention carry a reason; no teleport; reopening resumes by policy only',measurements:[...PHYS,'sampled-trajectory'],invariants:[...FOOD,'no-false-arrival']},
 {id:'FD05',title:'Payload, battery, capability or target binding refused before native start',requirementIds:['FD-05'],runnerScenarios:['FD05-payload','FD05-battery','FD05-capability','FD05-binding'],fixtures:[R],cell:false,
  tests:[ACC('FD05'),'tests/integration/robot-admission.test.ts'],backendSupport:business,oracle:'admission refuses with the exact code; nothing is served and no cargo is reduced',measurements:[],invariants:['arrival-from-observation']},
 {id:'FD06',title:'Cancel or retarget while the robot holds food or a cup',requirementIds:['FD-04','FD-06'],runnerScenarios:[],fixtures:[R,CUP],cell:true,
  tests:[MIX('cancelling a mixed mission after both loads retains the cup on its robot until the return confirmation'),ACC('FD06-cancel'),ACC('FD06-retarget')],
  backendSupport:business,oracle:'the mission stops on evidence; cargo stays recorded with a disposition; nothing is reported delivered',measurements:[],invariants:['cup-ownership-traceable']},
 {id:'FD07',title:'Two robots contend for one narrow corridor and the pickup slot',requirementIds:['FD-07','SIM-10'],runnerScenarios:['FD07'],fixtures:[K,`${SC}/fd07-corridor.json`],cell:false,
  tests:[MOCK('FD07: two robots never own the constrained corridor at once; one progresses at a time and both deliver'),'tests/integration/lab-v2-zone-bridge.test.ts','tests/integration/lab-v2-sil-campaign.test.ts','robotics/simulation/tests/test_two_robots.py',ACC('FD07'),ACC('FD07-ttl')],
  backendSupport:amr,oracle:'one zone owner at a time by policy; unknown never releases a zone on TTL alone; both robots deliver',measurements:[...PHYS,'sampled-trajectory'],invariants:[...FOOD,'no-false-arrival','parked-not-charging']},
 {id:'FD08',title:'Map revision change, stale pose and lost localization before arrival',requirementIds:['UX-14','UX-16','UX-17','FD-05'],runnerScenarios:[],fixtures:[R,`${SC}/fd08-localization.json`],cell:false,
  tests:['tests/integration/lab-v2-simulated-navigation.test.ts',ACC('FD08-localization'),ACC('FD08-map'),ACC('FD08-rebind')],
  backendSupport:amr,oracle:'dispatch/arrival blocked or attention raised; last known pose marked stale; a new map needs new bindings',measurements:[...PHYS,'localization-covariance','map-identity'],invariants:['arrival-from-observation']},
 {id:'BV01',title:'Espresso and iced milk coffee: recipe -> verify -> arm -> robot -> table',requirementIds:['BV-01','BV-03','BV-04','BV-05','BV-08','SIM-08'],runnerScenarios:['BV01'],fixtures:['tests/fixtures/digital-twin/sil/bv01.json',CUP,'tests/fixtures/digital-twin/assets/service-robot-v1.json'],cell:true,
  tests:['tests/integration/lab-v2-bv01-sil.test.ts',MOCK('v2 gateway runs the coffee set once every mock backend of it is enabled; hardware stays denied'),'tests/integration/beverage-handoff.test.ts','tests/integration/beverage-simulator.test.ts','tests/integration/coffee-transfer.test.ts',ACC('BV01')],
  backendSupport:amr,oracle:'recipe steps at the locked revision; espresso runs no ice or milk; one cup owner; verified dose before pickup; the right cup at the table',measurements:PHYS,invariants:[...BEV,'espresso-without-ice-or-milk','parked-not-charging']},
 {id:'BV02',title:'No cup, wrong cup type/capacity, or cup removed mid-brew',requirementIds:['BV-02','BV-07'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/coffee-policy.test.ts',ACC('BV02-nocup'),ACC('BV02-type'),ACC('BV02-removed')],backendSupport:amr,oracle:'no start without a cup; a lost cup follows the interlock policy with partial/unknown recorded; never cup-ready',measurements:['cup-presence'],invariants:['cup-ownership-traceable','no-measured-provenance-from-model']},
 {id:'BV03',title:'Milk out, ice jam, two orders on one machine/arm, pickup robot not ready',requirementIds:['BV-02','BV-07'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/coffee-simulation-resources.test.ts','tests/integration/beverage-simulator.test.ts',ACC('BV03-milk'),ACC('BV03-ice'),ACC('BV03-contention')],backendSupport:amr,oracle:'resources are never shared against policy; fail/queue carry a reason; partial quantities are kept; a retry never adds blindly',measurements:['milk-level','ice-mass','cell-busy'],invariants:['recipe-steps-in-order','no-measured-provenance-from-model']},
 {id:'BV04',title:'Brew/dispense timeout, under/over dose, sensor outlier',requirementIds:['BV-03','SIM-08'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/coffee-simulation-evidence.test.ts','tests/integration/coffee-policy.test.ts',ACC('BV04-timeout'),ACC('BV04-tolerance')],backendSupport:amr,oracle:'not ready outside tolerance or without a trusted measurement; requested/observed/accepted kept apart',measurements:['dose-measurement','brew-timeout'],invariants:['recipe-steps-in-order','no-measured-provenance-from-model']},
 {id:'BV05',title:'Lost ACK after accepted brew/dispense, disconnect/reboot, duplicate command id',requirementIds:['BV-06','SIM-08'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/beverage-simulator.test.ts','tests/integration/coffee-recovery.test.ts',ACC('BV05')],backendSupport:amr,oracle:'one effect or an unknown with reconcile; never a second brew/dispense; cup and liquid lifecycle never reset',measurements:['ack-loss','reconcile-state'],invariants:['recipe-steps-in-order','no-measured-provenance-from-model']},
 {id:'BV06',title:'Cup/order/recipe revision mismatch, wrong step order, over capacity',requirementIds:['BV-01','BV-05'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/coffee-policy.test.ts','tests/integration/coffee-simulation-evidence.test.ts',ACC('BV06-order')],backendSupport:business,oracle:'refused before the invalid step; no other cup goes to the order; no new recipe revision for an old run',measurements:[],invariants:['recipe-steps-in-order']},
 {id:'BV07',title:'Pickup timeout, dock error, arm not done placing, cancel mid-cycle',requirementIds:['BV-05','BV-07','SIM-08'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/beverage-handoff.test.ts','tests/integration/coffee-transfer.test.ts',ACC('BV07-dock'),ACC('BV07-drop'),ACC('BV07-cancel')],backendSupport:amr,oracle:'the robot never leaves without the right cup; arm and robot never own a cup together; full/partial/unknown cups get a disposition',measurements:['dock-error','tray-presence','release-ack'],invariants:['cup-ownership-traceable']},
 {id:'BV08',title:'Machine not ready, cleaning overdue, milk batch or sensor freshness below policy',requirementIds:['BV-02','BV-07','BV-08'],runnerScenarios:[],fixtures:[CUP],cell:true,
  tests:['tests/integration/coffee-policy.test.ts',ACC('BV08-ready'),ACC('BV08-cleaning')],backendSupport:business,oracle:'the related step is blocked with a reason code; fresh readiness reopens only the allowed step; interlocks survive reboot',measurements:[],invariants:['recipe-steps-in-order']},
 {id:'SYS01',title:'Same inputs under different render rates, background tabs and run speeds',requirementIds:['QA-02','QA-03','QA-04'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-sim-clock.test.ts',ACC('SYS01')],backendSupport:amr,oracle:'canonical trace and assertions identical; render is never the clock; the manifest names the backend set',measurements:['clock-barrier'],invariants:['arrival-from-observation']},
 {id:'SYS02',title:'UI, gateway or executor loss; crash after accept; reconnect and reclaim',requirementIds:['FD-06','BV-06','QA-05','QA-11'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-sim-recovery.test.ts','tests/integration/lab-v2-recovery.test.ts',ACC('SYS02-executor'),ACC('SYS02-ui')],backendSupport:amr,oracle:'no owner change or duplicated effect; stale and unknown kept apart; the recovery trace is complete',measurements:['worker-loss-unknown'],invariants:['arrival-from-observation']},
 {id:'SYS03',title:'Duplicate, reordered and delayed observations; stale retained completion',requirementIds:['QA-05','QA-10'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-sim-clock.test.ts','tests/integration/coffee-simulation-resources.test.ts',ACC('SYS03')],backendSupport:amr,oracle:'no terminal state revives; served or dose never counted twice; correlation and sequence stay valid',measurements:['telemetry-ingest'],invariants:['arrival-from-observation']},
 {id:'SYS04',title:'Edited geometry/recipe/profile, old or malformed imports, reopened saved runs',requirementIds:['UX-12','UX-16','UX-20','QA-09'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-checkpoint-compat.test.ts',ACC('SYS04')],backendSupport:business,oracle:'explicit migration; a bad import never corrupts the project; old reports stay immutable and scoped stale',measurements:[],invariants:[]},
 {id:'SYS05',title:'Replay, scrub, import and export of reports with action-like fields',requirementIds:['UX-09','QA-06'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-report.test.ts',ACC('SYS05')],backendSupport:amr,oracle:'no effect or control network call from a replay; unknown input refused or kept inert by schema',measurements:['replay-inert'],invariants:[]},
 {id:'SYS06',title:'Backend missing or wrong version; mode change mid-run; backend death mid-run',requirementIds:['UX-19','QA-07','SIM-10'],runnerScenarios:[],fixtures:[R],cell:false,
  tests:['tests/integration/lab-v2-scenario-matrix.test.ts::missing required backend cannot silently produce a passing run','tests/integration/lab-v2-contracts.test.ts',ACC('SYS06')],backendSupport:amr,oracle:'blocked with a reason; no fallback; the run backend is immutable; unknown stays unknown',measurements:['backend-admission'],invariants:[]},
 {id:'IR-FD01',title:'One order, one robot on the IR-SIM 2D plant: kitchen -> table -> parking (FD01 business template)',requirementIds:['FD-01','FD-02','FD-04','FD-08','SIM-10'],runnerScenarios:['IR-FD01'],fixtures:['robotics/navigation-2d/fixtures/serve-demo-v1/serve-project.json'],cell:false,
  tests:['tests/integration/irsim-mission.test.ts','tests/integration/irsim-recovery.test.ts','tests/integration/irsim-readiness.test.ts','tests/security/irsim-authority.test.ts'],
  backendSupport:{mock:false,simulation:true,hardware:false},oracle:'served only after CargoLoaded and DeliveryHandedOff in the journal; navigation arrival ends a leg only; cancel only on a stopped observation; a lost step ACK stays unknown and is never resent',
  measurements:['sampled-trajectory','worker-loss-unknown'],invariants:[...FOOD,'no-false-arrival','parked-not-charging']},
 {id:'IR-FD03',title:'A person crosses the route on the IR-SIM 2D plant: hold/replan on LiDAR, no contact, resume (FD03 business template)',requirementIds:['FD-03','SIM-10'],runnerScenarios:['IR-FD03'],fixtures:['robotics/navigation-2d/fixtures/serve-demo-v1/serve-project.json'],cell:false,
  tests:['tests/integration/irsim-faults.test.ts','tests/integration/irsim-batch.test.ts'],backendSupport:{mock:false,simulation:true,hardware:false},oracle:'the scheduled actor is seen by the LiDAR (observation refs), never touched (polygon separation > 0, no engine contact), and the order is served after the handoff',
  measurements:['sampled-trajectory','actor-schedule'],invariants:[...FOOD,'no-false-arrival']},
 {id:'IR-FD04',title:'The destination handoff is walled in on the IR-SIM 2D plant: no_path before driving, nothing served (FD04 business template)',requirementIds:['FD-04','SIM-10'],runnerScenarios:['IR-FD04'],fixtures:['robotics/navigation-2d/fixtures/serve-demo-v1/serve-enclosed-project.json'],cell:false,
  tests:['tests/integration/irsim-faults.test.ts','tests/integration/irsim-batch.test.ts'],backendSupport:{mock:false,simulation:true,hardware:false},oracle:'NO_PATH attention within 10 ticks of the leg start, never blocked/timeout; zero served',measurements:['sampled-trajectory'],invariants:[...FOOD,'no-false-arrival']},
 {id:'IR-FD04-blocked',title:'A person stands on the destination handoff on the IR-SIM 2D plant: blocked, never no_path (FD04-blocked business template)',requirementIds:['FD-04','SIM-10'],runnerScenarios:['IR-FD04-blocked'],fixtures:['robotics/navigation-2d/fixtures/serve-demo-v1/serve-project.json'],cell:false,
  tests:['tests/integration/irsim-faults.test.ts','tests/integration/irsim-batch.test.ts'],backendSupport:{mock:false,simulation:true,hardware:false},oracle:'blocked no earlier than the no-progress window and before the goal deadline; zero served; no contact with the person',measurements:['sampled-trajectory','actor-schedule'],invariants:[...FOOD,'no-false-arrival']},
 {id:'IR-FD07',title:'Two robots with distinct drives and LiDARs take turns through a reserved aisle on the IR-SIM 2D plant (FD07 business template; movers serialized by the source)',requirementIds:['FD-07','SIM-06','SIM-10'],runnerScenarios:['IR-FD07'],fixtures:['robotics/navigation-2d/fixtures/serve-demo-v1/serve-fleet-project.json'],cell:false,
  tests:['tests/integration/irsim-fleet.test.ts','tests/integration/irsim-batch.test.ts'],backendSupport:{mock:false,simulation:true,hardware:false},oracle:'source-driven: the venue-movement reservation moves one robot at a time, so the aisle zone is reserved and released per leg (footprint inside only while granted, release after a whole-footprint exit, renewed, no TTL release) but never contended here; both robots move and deliver within 12,000 ticks; the customer walks away from both routes (schedule applied, no contact; not an avoidance test). Zone contention is proven only by the campaign-only contention rig IR-RIG-ZONE (goals given to the controller directly, no missions)',
  measurements:['sampled-trajectory','zone-reservations','robot-separation'],invariants:[...FOOD,'no-false-arrival','parked-not-charging']},
 {id:'CAMPAIGN-FD02-FD07-BV01-BV03',title:'Concurrent food, corridor and coffee deliveries sharing robots and the cell',requirementIds:['FD-01','FD-07','BV-01','BV-02','BV-07','SIM-10'],runnerScenarios:['CAMPAIGN-FD02-FD07-BV01-BV03'],fixtures:[R,CUP,'tests/fixtures/digital-twin/campaigns/food-beverage.json'],cell:true,
  tests:[MIX('the versioned food, corridor and coffee campaign executes both AMRs and queues the second coffee job without sharing a cup'),'tests/unit/lab-sil-cli.test.ts'],
  backendSupport:amr,oracle:'drinks count as served only after the final handoff; queue, travel, human wait and cell busy measured apart',measurements:PHYS,invariants:BEV},
];
export interface MatrixIssue {id:string;code:string}
export function validateMatrix(rows:readonly MatrixRow[],o:{exists(path:string):boolean}):{ok:boolean;issues:MatrixIssue[]}{
 const issues:MatrixIssue[]=[],seen=new Set<string>();
 for(const r of rows){
  if(seen.has(r.id))issues.push({id:r.id,code:'DUPLICATE_ID'});seen.add(r.id);
  if(!r.requirementIds.length)issues.push({id:r.id,code:'NO_REQUIREMENTS'});
  if(!r.tests.length)issues.push({id:r.id,code:'NO_TESTS'});
  if(r.backendSupport.simulation&&!r.measurements.length)issues.push({id:r.id,code:'ZERO_MEASUREMENTS'});
  for(const s of r.runnerScenarios)if(!scenarioRegistry.has(s))issues.push({id:r.id,code:`UNKNOWN_RUNNER_SCENARIO:${s}`});
  if(!r.cell&&r.runnerScenarios.some(s=>scenarioRegistry.get(s)?.coffee))issues.push({id:r.id,code:'CELL_REQUIRED_BY_RUNNER_SCENARIO'});
  for(const f of new Set(r.tests.map(t=>t.split('::')[0]!)))if(!o.exists(f))issues.push({id:r.id,code:`TEST_FILE_MISSING:${f}`});
 }
 return {ok:!issues.length,issues};
}
const BACKENDS:Record<'mock'|'simulation',{amr:string;cell:string[]}>={mock:{amr:'mock_amr',cell:['mock_coffee','mock_arm']},simulation:{amr:'gazebo_nav2',cell:['linuxcnc_sim','coffee_io_sim']}};
/** The one formula every admission level uses (matrix, SIL preflight, orchestrator, Lab fixture): the AMR backend, plus the cell when the scenario/row needs it. A set may offer more. */
const needsCell=(target:ScenarioDefinition|MatrixRow)=>'cell' in target?target.cell:!!target.coffee;
export interface BackendResolution {ok:boolean;required:string[];reasonCodes:string[]}
const ownedScenarios=(target:ScenarioDefinition|MatrixRow)=>'runnerScenarios' in target?[target.id,...target.runnerScenarios]:[target.id];
/** IR-* scenarios run only on a set that lists them; the legacy mode formula never maps them onto mock or Gazebo backends. */
const providerVariant=(target:ScenarioDefinition|MatrixRow)=>ownedScenarios(target).some(id=>id.startsWith('IR-'));
/**
 * Non-throwing form of requiredBackends. Without a set id the answer is the legacy mode formula. With one, the set must exist and match the mode (no fallback);
 * engineering sets (those declaring scenarioIds) must support the scenario and supply every role it needs; legacy sets keep the legacy formula.
 */
export function resolveBackends(target:ScenarioDefinition|MatrixRow,mode:'mock'|'simulation',backendSetId?:string,catalog:CapabilityCatalog=defaultCatalog):BackendResolution{
 const fail=(code:string):BackendResolution=>({ok:false,required:[],reasonCodes:[code]});
 const legacy=():BackendResolution=>providerVariant(target)?fail('SCENARIO_UNSUPPORTED_BY_SET'):{ok:true,required:[BACKENDS[mode].amr,...needsCell(target)?BACKENDS[mode].cell:[]],reasonCodes:[]};
 if(backendSetId===undefined)return legacy();
 const set=Object.hasOwn(catalog.sets,backendSetId)?catalog.sets[backendSetId]:undefined;
 if(!set)return fail('BACKEND_SET_UNKNOWN');
 if(set.mode!==mode)return fail('MODE_BACKEND_MISMATCH');
 if(!set.scenarioIds)return legacy();
 if(!ownedScenarios(target).some(id=>set.scenarioIds!.includes(id)))return fail('SCENARIO_UNSUPPORTED_BY_SET');
 const roles=set.providers,cell=needsCell(target);
 if(!roles?.amr||cell&&(!roles.arm||!roles.coffee))return fail('SCENARIO_BACKEND_MISSING');
 return {ok:true,required:[roles.amr,...cell?[roles.arm!,roles.coffee!]:[]],reasonCodes:[]};
}
/** Backends a scenario needs. The two-argument form is the legacy mode-only answer; pass the backend set (and the server catalog) on every execution path. */
export function requiredBackends(target:ScenarioDefinition|MatrixRow,mode:'mock'|'simulation',backendSetId?:string,catalog?:CapabilityCatalog){
 const r=resolveBackends(target,mode,backendSetId,catalog);
 if(!r.ok)throw new Error(r.reasonCodes[0]);
 return r.required;
}
/** Health view: scenario id -> backend set id -> what that pairing needs. Only sets of a mode the scenario can run in are listed. */
export function requirementsByBackendSet(catalog:CapabilityCatalog=defaultCatalog,options:{engineering?:boolean}={}):Record<string,Record<string,{supported:boolean;required:string[];reasonCodes:string[]}>>{
 return Object.fromEntries([...scenarioRegistry].map(([id,def])=>[id,Object.fromEntries(Object.entries(catalog.sets).filter(([,s])=>s.mode==='mock'||s.mode==='simulation').map(([setId,s])=>{if(s.scenarioIds&&!options.engineering)return [setId,{supported:false,required:[],reasonCodes:['ENGINEERING_CAPABILITY_REQUIRED']}];const r=resolveBackends(def,s.mode as 'mock'|'simulation',setId,catalog);return [setId,{supported:r.ok,required:r.required,reasonCodes:r.reasonCodes}];}))]));
}
export interface Admission {status:'admitted'|'unavailable'|'unsupported';reasons:string[];required:string[];effects:never[]}
/**
 * Preflight only (server-side `available` from the capability catalog, never from a browser); it never schedules an effect. `id` is a registry
 * scenario (what actually runs) or a matrix row; a row owning runner scenarios needs their union, a row without one cannot be admitted as a run.
 */
export async function admitScenario(id:string,o:{mode:Mode;backendSetId:string;available:readonly string[];catalog?:CapabilityCatalog}):Promise<Admission>{
 const none:never[]=[],def=scenarioRegistry.get(id),row=scenarioMatrix.find(r=>r.id===id)??scenarioMatrix.find(r=>r.runnerScenarios.includes(id));
 if(!row)return {status:'unsupported',reasons:['SCENARIO_UNKNOWN'],required:[],effects:none};
 const runners=def?[def]:row.runnerScenarios.map(s=>scenarioRegistry.get(s)!).filter(Boolean);
 if(!runners.length)return {status:'unsupported',reasons:['NO_RUNNER_SCENARIO'],required:[],effects:none};
 const mode=o.mode;
 if(mode==='hardware'||!row.backendSupport[mode])return {status:'unsupported',reasons:[`MODE_UNSUPPORTED:${mode}`],required:[],effects:none};
 const sets=(o.catalog??defaultCatalog).sets,set=Object.hasOwn(sets,o.backendSetId)?sets[o.backendSetId]:undefined;
 if(!set)return {status:'unavailable',reasons:['BACKEND_SET_UNKNOWN'],required:[],effects:none};
 if(set.mode!==mode)return {status:'unavailable',reasons:['MODE_BACKEND_MISMATCH'],required:[],effects:none};
 const resolutions=runners.map(d=>resolveBackends(d,mode,o.backendSetId,o.catalog));
 if(resolutions.some(r=>!r.ok))return {status:'unavailable',reasons:[...new Set(resolutions.flatMap(r=>r.reasonCodes))],required:[],effects:none};
 const required=[...new Set(resolutions.flatMap(r=>r.required))],missing=required.filter(b=>!set.backends.includes(b)||!o.available.includes(b));
 return {status:missing.length?'unavailable':'admitted',reasons:missing.map(b=>`BACKEND_MISSING:${b}`),required,effects:none};
}
