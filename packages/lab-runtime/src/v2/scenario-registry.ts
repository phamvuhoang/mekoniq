// Server-owned scenario catalog. Definitions are declarative data (orders, confirmation policy); there is no user-supplied script.
import type {LabProjectV2} from '../../../contracts/generated/lab-v2';
import {hashJson} from './hash';
export interface ScenarioDefinition {
 id:string;revision:number;title:string;
 /** AMR entities used, taken in entity-id order; each gets the parking point at the same index (point-id order). */
 robots:number;
 /** Scripted guests. `table` indexes the project's table points in id order; `atTick` is an inclusive range drawn from the actor's own PRNG stream. */
 orders:readonly {actor:string;table:number;quantity:number;atTick:readonly [number,number]}[];
 /** scripted: staff confirms load/handoff `delayTicks` after the observed arrival; human: the run waits for a `confirm` action. */
 confirm:{mode:'scripted'|'human';delayTicks:number};
 /** Return to the robot's own parking point (never a dock/charger) after its last delivery. */
 park:boolean;
 maxTicks:number;
 /** Coffee orders served by the project's coffee cell (first coffee_machine + first arm entity, its coffee_pickup point is the bar station). */
 coffee?:{orders:readonly {actor:string;table:number;recipe:string;atTick:readonly [number,number]}[]};
 /** One mission carries every food order (all allocations), created once the last order is placed: load once, one handoff stop per table. */
 batch?:boolean;
 /** Batch the food allocations with the first verified coffee cup on the same mission. */
 mixFoodCoffee?:boolean;
 /** Scheduled world obstacles (person, chair, closed lane) in world metres: present from `atTick` until before `untilTick` (or the end). */
 obstacles?:readonly {id:string;x:number;y:number;width:number;height:number;atTick:number;untilTick?:number}[];
 /** Robot venue configuration of this scenario (admission inputs): battery %, claimed capabilities, and whether table waypoints are taught. */
 fleet?:{battery?:number;capabilities?:readonly string[];unbindTables?:boolean};
 /** Mission payload (grams, integer string) checked against the robot's maxLoadMinor at admission. */
 loadMinor?:string;
 /** Request the first robot by id, so admission answers with that robot's own first reason instead of NO_CAPABLE_ROBOT. */
 requestRobot?:boolean;
 /** A provider variant of a business template (IR-*): the template's business rules (roles, confirmations, parking), recorded under its own id; a workload or
 * duration that differs from the template is pinned in the variant's own definition (and so its hash), never changed under the template's id. */
 basedOn?:{id:string;revision:number};
}
// FD03/FD04 obstacles are world coordinates of the fixture layouts (restaurant-v2: kitchen lane x~1, table T01 at 3,1.1; corridor: gap at x 4.5-5.5,
// y 2.5-3.5). On another layout they land elsewhere; the run still reports what the model did, but the scenario intent then does not hold.
const FD01={orders:[{actor:'guest-1',table:0,quantity:1,atTick:[25,500] as const}],confirm:{mode:'scripted' as const,delayTicks:50},park:true};
const FD07={orders:[{actor:'guest-1',table:0,quantity:1,atTick:[10,10] as const},{actor:'guest-2',table:1,quantity:1,atTick:[12,12] as const}],confirm:{mode:'scripted' as const,delayTicks:50},park:true};
const fixedOrder={robots:1,orders:[{actor:'guest-1',table:0,quantity:1,atTick:[10,10] as const}],confirm:{mode:'scripted' as const,delayTicks:50},park:true,maxTicks:90000};
const corridorGap={x:4.5,y:2.5,width:1,height:1};
const irOrder={...fixedOrder,maxTicks:30000};
export const scenarioRegistry:ReadonlyMap<string,ScenarioDefinition>=new Map<string,ScenarioDefinition>([
 ['FD01',{id:'FD01',revision:1,title:'One order, one robot: kitchen -> table -> parking',robots:1,...FD01,maxTicks:90000}],
 ['FD07',{id:'FD07',revision:1,title:'Two robots contend for one narrow corridor',robots:2,...FD07,maxTicks:180000}],
 ['FD02',{id:'FD02',revision:1,title:'Two tables on one batched mission: each handoff transfers only its own allocation',robots:1,batch:true,orders:[{actor:'guest-1',table:0,quantity:1,atTick:[10,200]},{actor:'guest-2',table:1,quantity:2,atTick:[10,200]}],confirm:{mode:'scripted',delayTicks:50},park:true,maxTicks:90000}],
 // a person (0.4 m) walks across the kitchen lane in 0.2 m steps every 15 ticks (0.67 m/s) while the robot drives up it
 ['FD03',{id:'FD03',revision:1,title:'A person crosses the route; the robot waits or replans in the model and resumes',...fixedOrder,obstacles:Array.from({length:12},(_,i)=>({id:`person-${i}`,x:i*0.2,y:5.6,width:0.4,height:0.4,atTick:375+i*15,untilTick:390+i*15}))}],
 ['FD04',{id:'FD04',revision:1,title:'A chair blocks the destination table: no false arrival',...fixedOrder,obstacles:[{id:'chair',x:2.75,y:0.85,width:0.5,height:0.5,atTick:0}]}],
 ['FD04-blocked',{id:'FD04-blocked',revision:1,title:'The only lane closes while the robot travels: hold, then no path',...fixedOrder,park:false,obstacles:[{id:'lane-closed',...corridorGap,atTick:400}]}],
 ['FD04-reopen',{id:'FD04-reopen',revision:1,title:'The only lane closes and reopens inside the hold window: resume by policy',...fixedOrder,obstacles:[{id:'lane-closed',...corridorGap,atTick:400,untilTick:590}]}],
 ['FD05-payload',{id:'FD05-payload',revision:1,title:'Payload above the robot limit is refused before native start',...fixedOrder,requestRobot:true,loadMinor:'20000'}],
 ['FD05-battery',{id:'FD05-battery',revision:1,title:'Battery below admission is refused before native start',...fixedOrder,requestRobot:true,fleet:{battery:10}}],
 ['FD05-capability',{id:'FD05-capability',revision:1,title:'Missing delivery capability is refused before native start',...fixedOrder,requestRobot:true,fleet:{capabilities:[]}}],
 ['FD05-binding',{id:'FD05-binding',revision:1,title:'Missing target binding is refused before native start',...fixedOrder,requestRobot:true,fleet:{unbindTables:true}}],
 ['BV01',{id:'BV01',revision:1,title:'Espresso and iced milk coffee: recipe -> verify -> arm -> robot -> table',robots:1,orders:[],coffee:{orders:[{actor:'guest-1',table:0,recipe:'espresso',atTick:[10,10]},{actor:'guest-2',table:0,recipe:'iced-milk-coffee',atTick:[20,20]}]},confirm:{mode:'scripted',delayTicks:50},park:true,maxTicks:180000}],
 ['FD02-cups',{id:'FD02-cups',revision:1,title:'One mission loads food and an identified coffee cup, then hands off both allocations',robots:1,batch:true,mixFoodCoffee:true,orders:[{actor:'food-guest',table:0,quantity:1,atTick:[10,10]}],coffee:{orders:[{actor:'coffee-guest',table:0,recipe:'espresso',atTick:[12,12]}]},confirm:{mode:'scripted',delayTicks:50},park:true,maxTicks:180000}],
 ['CAMPAIGN-FD02-FD07-BV01-BV03',{id:'CAMPAIGN-FD02-FD07-BV01-BV03',revision:1,title:'Concurrent food, corridor and coffee deliveries (ends after customer handoffs)',robots:2,orders:[{actor:'food-a',table:0,quantity:1,atTick:[10,10]},{actor:'food-b',table:1,quantity:1,atTick:[12,12]}],coffee:{orders:[{actor:'coffee-a',table:0,recipe:'espresso',atTick:[10,10]},{actor:'coffee-b',table:0,recipe:'iced-milk-coffee',atTick:[12,12]}]},confirm:{mode:'scripted',delayTicks:50},park:false,maxTicks:180000}],
 // IR-SIM 2D variant of FD01 (same business template); capped at the provider's 30,000-tick (10 min sim) run quota
 ['IR-FD01',{id:'IR-FD01',revision:1,title:'One order, one robot on the IR-SIM 2D plant: kitchen -> table -> parking',robots:1,...FD01,maxTicks:30000,basedOn:{id:'FD01',revision:1}}],
 // C02 IR-SIM variants: the business template of their FD scenario under the 30,000-tick provider quota; actors and reservation zones are the server-owned
 // scenario fixture (navigation2d/scenario-fixtures.ts), pinned into the run's configuration hash; never the legacy obstacle schedules
 ['IR-FD03',{id:'IR-FD03',revision:1,title:'A person crosses the route on the IR-SIM 2D plant: the robot holds or replans on LiDAR and resumes',...irOrder,basedOn:{id:'FD03',revision:1}}],
 ['IR-FD04',{id:'IR-FD04',revision:1,title:'The destination handoff is walled in on the IR-SIM 2D plant: no_path, no false arrival, nothing served',...irOrder,basedOn:{id:'FD04',revision:1}}],
 ['IR-FD04-blocked',{id:'IR-FD04-blocked',revision:1,title:'A person stands on the destination handoff on the IR-SIM 2D plant: blocked after the no-progress window, never no_path',...irOrder,park:false,basedOn:{id:'FD04-blocked',revision:1}}],
 // the FD07 template exactly (two robots, T01/T02, scripted confirmations, park) under the 12,000-tick campaign bound (verification.md IR04 override, in this hash)
 ['IR-FD07',{id:'IR-FD07',revision:1,title:'Two robots with their own drives and LiDARs share a reserved aisle on the IR-SIM 2D plant while a customer walks across',robots:2,...FD07,maxTicks:12000,basedOn:{id:'FD07',revision:1}}],
]);
export const scenarioHash=(d:ScenarioDefinition)=>hashJson(d);
const ID=/^[A-Za-z0-9_.:-]{1,200}$/,int=(n:unknown,min:number,max:number)=>Number.isSafeInteger(n)&&(n as number)>=min&&(n as number)<=max;
/** Shape check for definitions handed in by in-process providers (tests); the built-in ones pass it too. Mock duration is capped at 8 h sim. */
export function checkScenario(d:ScenarioDefinition):void {
 const ok=ID.test(d.id)&&int(d.revision,1,2**31)&&int(d.robots,1,8)&&int(d.maxTicks,1,1440000)&&['scripted','human'].includes(d.confirm.mode)&&int(d.confirm.delayTicks,0,1440000)&&typeof d.park==='boolean'&&d.orders.length+(d.coffee?.orders.length??0)>=1&&d.orders.length<=50&&(d.coffee?.orders.length??0)<=20
  &&d.orders.every(o=>ID.test(o.actor)&&int(o.table,0,199)&&int(o.quantity,1,10)&&int(o.atTick[0],0,d.maxTicks)&&int(o.atTick[1],o.atTick[0],d.maxTicks))
  &&(d.coffee?.orders??[]).every(o=>ID.test(o.actor)&&ID.test(o.recipe)&&int(o.table,0,199)&&int(o.atTick[0],0,d.maxTicks)&&int(o.atTick[1],o.atTick[0],d.maxTicks))
  &&(d.batch===undefined||typeof d.batch==='boolean')&&(d.mixFoodCoffee===undefined||typeof d.mixFoodCoffee==='boolean'&&(!d.mixFoodCoffee||!!d.batch&&!!d.coffee&&d.orders.length>0))&&(d.requestRobot===undefined||typeof d.requestRobot==='boolean')&&(d.loadMinor===undefined||/^[0-9]{1,12}$/.test(d.loadMinor))
  &&(d.obstacles??[]).length<=50&&(d.obstacles??[]).every(o=>ID.test(o.id)&&[o.x,o.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1000)&&[o.width,o.height].every(n=>Number.isFinite(n)&&n>0&&n<=1000)&&int(o.atTick,0,d.maxTicks)&&(o.untilTick===undefined||int(o.untilTick,o.atTick+1,d.maxTicks)))
  &&(!d.fleet||(d.fleet.battery===undefined||int(d.fleet.battery,0,100))&&(d.fleet.capabilities===undefined||d.fleet.capabilities.length<=10&&d.fleet.capabilities.every(c=>ID.test(c)))&&(d.fleet.unbindTables===undefined||typeof d.fleet.unbindTables==='boolean'));
 if(!ok)throw new Error('INVALID_SCENARIO');
}
export interface Roles {robots:{id:string;parkingId:string}[];stationId:string;tables:string[];coffee?:{stationId:string;cellId:string;armId:string}}
/** Bind scenario roles to this project's entities and points; nothing depends on fixed names such as kitchen/table-1/sim-1. */
export function resolveRoles(d:ScenarioDefinition,p:LabProjectV2):Roles {
 const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0,points=(k:string)=>p.world.points.filter(x=>x.kind===k).sort(byId).map(x=>x.id);
 const amrs=p.entities.filter(e=>e.kind==='amr').sort(byId).slice(0,d.robots),parking=points('parking'),stations=points('kitchen'),tables=points('table');
 const first=(k:string)=>p.entities.filter(e=>e.kind===k).sort(byId)[0]?.id,bar=points('coffee_pickup')[0],cellId=first('coffee_machine'),armId=first('arm');
 const coffee=d.coffee?(bar&&cellId&&armId?{stationId:bar,cellId,armId}:null):undefined;
 if(amrs.length<d.robots||parking.length<d.robots||(d.orders.length&&!stations.length)||coffee===null||[...d.orders,...d.coffee?.orders??[]].some(o=>o.table>=tables.length))throw new Error('SCENARIO_ROLE_UNBOUND');
 return {robots:amrs.map((e,i)=>({id:e.id,parkingId:parking[i]!})),stationId:stations[0]??coffee!.stationId,tables,...coffee?{coffee}:{}};
}
