import {cellPreset} from '../twin/cell';
import {payloadPreset} from '../twin/payload';
// Twin presets: a server-owned scenario id + backend set, run against a fixture project. Names are entity labels (data), not UI copy.
import nativeFixture from '../../fixtures/twins/native-bv01-v2.json' with {type:'json'};
import coffeeFixture from '../../fixtures/twins/coffee-cell-v2.json' with {type:'json'};
import restaurantFixture from '../../fixtures/twins/restaurant-v2.json' with {type:'json'};
import serveDesign from '../../fixtures/engineering/serve-demo-v1/serve-project.json' with {type:'json'};
import fleetDesign from '../../fixtures/engineering/serve-demo-v1/serve-fleet-project.json' with {type:'json'};
import serve3dDesign from '../../fixtures/engineering/serve-3d-v1/serve-3d-project.json' with {type:'json'};
import fleet3dDesign from '../../fixtures/engineering/serve-3d-v1/serve-3d-fleet-project.json' with {type:'json'};
import xarmCell from '../../fixtures/engineering/xarm6-g2-v1/coffee-cell-project.json' with {type:'json'};
import type {AssetRevision,LabProjectV2} from '../shared/types';
import {tr} from '../i18n';
/** Present only on an engineering preset: the exact draft that was compiled and the receipt for it. */
export interface EngineeringPresetInput {project:import('../shared/engineering').EngineeringProject;receipt:import('../shared/engineering').BundleReceipt|null}
/** `speed`: the auto-run factor set when the preset is chosen (absent: the current speed stays). `view`: what the 3D view's home framing shows (absent: the whole floor;
 * `arm_cell`: the arm cell, derived from the scene by viewer/twin3d homeRegion). */
export interface TwinPreset {worldExperimentId?:import('../twin/cell').WorldExperiment;engineering?:EngineeringPresetInput;speed?:number;view?:'arm_cell';mode?:'mock'|'simulation';id:string;title:()=>string;summary:()=>string;scenarioId:string;scenarioRevision:number;backendSetId:string;seed:number;
 project:LabProjectV2;assets:AssetRevision[];names:Record<string,string>;roles:{entities:LabProjectV2['entities'][number]['kind'][];points:string[]};}
export const presets:TwinPreset[]=[
 {id:'coffee',title:()=>tr('Cà phê sữa đá','アイスミルクコーヒー','Iced milk coffee'),summary:()=>tr('BV01 · espresso + cà phê sữa đá · máy pha → arm → khay robot → bàn','BV01 · エスプレッソ + アイスミルクコーヒー · マシン → アーム → ロボットトレイ → テーブル','BV01 · espresso + iced milk coffee · machine → arm → robot tray → table'),
  scenarioId:'BV01',scenarioRevision:1,backendSetId:'mock-default',seed:42,project:coffeeFixture.project as LabProjectV2,assets:coffeeFixture.assets as AssetRevision[],
  names:{'coffee-1':'Coffee cell','arm-1':'Arm-1','amr-1':'AMR-1','cups-1':'Cup station'},roles:{entities:['amr','arm','coffee_machine'],points:['coffee_pickup','table','parking']}},
 {id:'delivery',title:()=>tr('Một đơn giao món','1件の配膳','One delivery order'),summary:()=>tr('FD01 · bếp → bàn → điểm chờ, một robot','FD01 · 厨房 → テーブル → 待機、ロボット1台','FD01 · kitchen → table → parking, one robot'),
  scenarioId:'FD01',scenarioRevision:1,backendSetId:'mock-amr',seed:42,project:restaurantFixture.project as LabProjectV2,assets:restaurantFixture.assets as AssetRevision[],
  names:{'amr-1':'AMR-1'},roles:{entities:['amr'],points:['kitchen','table','parking']}},
];
const mixedProject:LabProjectV2=structuredClone(coffeeFixture.project as LabProjectV2);
mixedProject.entities.push({...structuredClone(mixedProject.entities.find(e=>e.kind==='amr')!),id:'amr-2'});
mixedProject.world={...mixedProject.world,width:10,height:6,points:[...mixedProject.world.points.map(p=>p.kind==='table'?{...p,x:8.5,y:1.5}:p),{id:'parking-2',name:'Parking 2',kind:'parking',x:0.8,y:5},{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:3},{id:'table-2',name:'T02',kind:'table',x:8.5,y:4.5}],obstacles:[{id:'wall-south',x:4.5,y:0,width:1,height:2.5},{id:'wall-north',x:4.5,y:3.5,width:1,height:2.5}]};
for(const [id,scenarioId,seed,title,summary] of [
 ['mixed','FD02-cups',42,()=>tr('Món ăn và cà phê cùng chuyến','料理とコーヒーを同じ便で','Food and coffee together'),()=>tr('Một mission giao món ăn và cốc cà phê đã xác định.','1つのミッションで料理と識別済みカップを配送。','One mission carries food and its identified coffee cup.')],
 ['campaign','CAMPAIGN-FD02-FD07-BV01-BV03',3,()=>tr('Chiến dịch hai robot','2台ロボットの連続シナリオ','Two-robot campaign'),()=>tr('Hai AMR dùng chung hành lang, món ăn và hai recipe cà phê.','2台のAMRが通路を共有し、料理と2種のコーヒーを配送。','Two AMRs share a corridor while delivering food and two coffee recipes.')],
] as const)presets.push({...presets[0]!,id,scenarioId,seed,title,summary,project:structuredClone(mixedProject),names:{...presets[0]!.names,'amr-2':'AMR-2'},roles:{entities:['amr','arm','coffee_machine'],points:['kitchen','coffee_pickup','table','parking']}});
presets.push({...presets[0]!,id:'native-bv01',mode:'simulation',backendSetId:'coffee-simulation',seed:23,project:nativeFixture.project as LabProjectV2,assets:nativeFixture.assets as AssetRevision[],title:()=>tr('BV01 native SIM','BV01 ネイティブSIM','BV01 native SIM'),summary:()=>tr('Gazebo + LinuxCNC · hình học PUMA560 SIM đã ghim · chưa xác minh phần cứng','Gazebo + LinuxCNC · 固定PUMA560 SIM形状 · 実機未検証','Gazebo + LinuxCNC · pinned PUMA560 SIM geometry · no hardware validation')});
/** IR-SIM 2D FD01 on the Serve robot: runs only from a receipt the Assembly page compiled for exactly the open Serve design (never from this fixture copy). */
export const IRSIM_SET='engineering-irsim-2d-v1',IRSIM_PROFILE='engineering-irsim-2d-v1';
presets.push({id:'irsim-fd01',mode:'simulation',scenarioId:'IR-FD01',scenarioRevision:1,backendSetId:IRSIM_SET,seed:5,project:structuredClone(serveDesign.runtimeProject) as LabProjectV2,assets:[],names:{'amr-1':'Serve-1'},roles:{entities:['amr'],points:['kitchen','table','parking']},
 engineering:{project:structuredClone(serveDesign) as unknown as import('../shared/engineering').EngineeringProject,receipt:null},
 title:()=>tr('IR-SIM 2D · giao món FD01','IR-SIM 2D · FD01配膳','IR-SIM 2D · FD01 delivery'),summary:()=>tr('Robot Serve · nhà hàng 10 bàn · mô phỏng 2D di động, không phải Gazebo hay phần cứng','Serveロボット · 10卓レストラン · ポータブル2D、Gazebo・実機ではない','Serve robot · 10-table restaurant · portable 2D, not Gazebo or hardware')});
/** IR-SIM 2D FD07 on the two-robot Serve fleet: runs only from a receipt the Assembly page compiled for the open fleet design. The source moves one robot at a time
 * (venue-movement reservation); the aisle zone and the customer are the runtime's server-side scenario fixture and are not drawn by the Lab. */
presets.push({id:'irsim-fd07',mode:'simulation',scenarioId:'IR-FD07',scenarioRevision:1,backendSetId:IRSIM_SET,seed:7,project:structuredClone(fleetDesign.runtimeProject) as LabProjectV2,assets:[],names:{robot01:'Serve-1',robot02:'Serve-2'},roles:{entities:['amr'],points:['kitchen','table','parking']},
 engineering:{project:structuredClone(fleetDesign) as unknown as import('../shared/engineering').EngineeringProject,receipt:null},
 title:()=>tr('IR-SIM 2D · hai robot FD07','IR-SIM 2D · 2台FD07','IR-SIM 2D · two robots FD07'),summary:()=>tr('Hai robot Serve khác bánh xe và LiDAR · nguồn cho chạy lần lượt từng robot · vùng lối đi đặt trước và khách đi bộ chỉ có ở phía máy chủ, không vẽ ở đây · mô phỏng 2D, không phải phần cứng','車輪とLiDARが異なるServe 2台 · ソースは1台ずつ走行させる · 予約通路ゾーンと歩行者はサーバー側のみで、ここには描画されない · ポータブル2D、実機ではない','Two Serve robots with different wheels and LiDARs · the source moves one robot at a time · the reserved aisle zone and the walking customer are server-side only and not drawn here · portable 2D, not hardware')});
/** Webots 3D on the Serve robot with casters (serve-3d-v1): same rule as IR-SIM, it runs only from a receipt compiled for exactly the open 3D design. Every physical parameter is assumed. */
export const WEBOTS_SET='engineering-webots-3d-v1',WEBOTS_PROFILE='engineering-webots-3d-v1';
presets.push({id:'webots-fd01',mode:'simulation',scenarioId:'WB-FD01',scenarioRevision:1,backendSetId:WEBOTS_SET,seed:5,project:structuredClone(serve3dDesign.runtimeProject) as LabProjectV2,assets:[],names:{'amr-1':'Serve-1'},roles:{entities:['amr'],points:['kitchen','table','parking']},
 engineering:{project:structuredClone(serve3dDesign) as unknown as import('../shared/engineering').EngineeringProject,receipt:null},
 title:()=>tr('Webots 3D · giao món FD01','Webots 3D · FD01配膳','Webots 3D · FD01 delivery'),summary:()=>tr('Robot Serve có bánh phụ · nhà hàng 10 bàn · vật lý cứng 3D trên Webots R2025a, tham số giả định, chưa hiệu chuẩn · không phải Gazebo hay phần cứng','キャスター付きServeロボット · 10卓レストラン · Webots R2025aの剛体3D物理、仮定パラメータで未校正 · Gazebo・実機ではない','Serve robot with casters · 10-table restaurant · rigid-body 3D physics on Webots R2025a, assumed and uncalibrated parameters · not Gazebo or hardware')});
/** Webots 3D FD07 on the two-robot Serve fleet; the source moves one robot at a time and the aisle zone is server-side only. */
presets.push({id:'webots-fd07',mode:'simulation',scenarioId:'WB-FD07',scenarioRevision:1,backendSetId:WEBOTS_SET,seed:7,project:structuredClone(fleet3dDesign.runtimeProject) as LabProjectV2,assets:[],names:{robot01:'Serve-1',robot02:'Serve-2'},roles:{entities:['amr'],points:['kitchen','table','parking']},
 engineering:{project:structuredClone(fleet3dDesign) as unknown as import('../shared/engineering').EngineeringProject,receipt:null},
 title:()=>tr('Webots 3D · hai robot FD07','Webots 3D · 2台FD07','Webots 3D · two robots FD07'),summary:()=>tr('Hai robot Serve có bánh phụ · nguồn cho chạy lần lượt từng robot · vùng lối đi đặt trước chỉ có ở phía máy chủ · Webots R2025a, tham số giả định, chưa hiệu chuẩn','キャスター付きServe 2台 · ソースは1台ずつ走行させる · 予約通路ゾーンはサーバー側のみ · Webots R2025a、仮定パラメータで未校正','Two Serve robots with casters · the source moves one robot at a time · the reserved aisle zone is server-side only · Webots R2025a, assumed and uncalibrated parameters')});
/** WB-BV01: the coffee cell with the arm as a Webots plant (R1.1). The scene is built by the runtime from this project (no engineering bundle); the arm's joints are the engine's, the grip is an event, and every physical parameter is assumed. */
export const WEBOTS_ARM_SET='engineering-webots-arm-v1';
presets.push({...presets[0]!,id:'webots-coffee',mode:'simulation',scenarioId:'WB-BV01',backendSetId:WEBOTS_ARM_SET,seed:42,project:structuredClone(coffeeFixture.project) as LabProjectV2,assets:coffeeFixture.assets as AssetRevision[],
 title:()=>tr('Webots · cà phê với tay máy 3D','Webots · 3Dアームでコーヒー','Webots · coffee with a 3D arm'),summary:()=>tr('BV01 · tay máy 6 khớp là plant Webots R2025a (servo vị trí, gắp là sự kiện) · tham số giả định, chưa hiệu chuẩn · không phải Gazebo hay phần cứng','BV01 · 6軸アームはWebots R2025aのプラント(位置サーボ、把持はイベント) · 仮定パラメータで未校正 · Gazebo・実機ではない','BV01 · the 6-joint arm is a Webots R2025a plant (position servo, grip is an event) · assumed and uncalibrated parameters · not Gazebo or hardware')});
/** MJ-BV01: the coffee cell with the xArm 6 and its Gripper G2 as a MuJoCo plant (R2a). The runtime builds the cell from this project (no engineering bundle); the arm grips by
 * simulated contact, masses and limits are manufacturer nominal values, everything else is assumed, nothing is calibrated. It starts at 1× so the motion is seen at its own pace. */
export const MUJOCO_ARM_SET='engineering-mujoco-arm-v1';
presets.push({...presets[0]!,id:'mujoco-coffee',mode:'simulation',scenarioId:'MJ-BV01',backendSetId:MUJOCO_ARM_SET,seed:42,speed:1,view:'arm_cell',project:structuredClone(xarmCell) as LabProjectV2,assets:[],
 title:()=>tr('MuJoCo · cà phê với tay máy xArm 6','MuJoCo · xArm 6でコーヒー','MuJoCo · coffee with the xArm 6'),summary:()=>tr('BV01 · xArm 6 với kẹp G2 là plant MuJoCo (bộ truyền động vị trí, gắp bằng tiếp xúc mô phỏng) · khối lượng và giới hạn danh định của nhà sản xuất, còn lại giả định, chưa hiệu chuẩn · không phải phần cứng','BV01 · グリッパーG2付きxArm 6はMuJoCoのプラント(位置アクチュエータ、把持は模擬接触) · 質量と制限はメーカー公称値、他は仮定で未校正 · 実機ではない','BV01 · the xArm 6 with its G2 gripper is a MuJoCo plant (position actuators, grip by simulated contact) · manufacturer nominal masses and limits, everything else assumed, not calibrated · not hardware')});
presets.push(payloadPreset());
presets.push(cellPreset());
export const presetById=(id:string)=>presets.find(p=>p.id===id);
/** Display name of an entity, point, cup or job; unknown ids are shown as-is, never invented. */
export function nameOf(preset:TwinPreset|undefined,id:string):string {
 const name=preset?.names[id]??preset?.project.world.points.find(p=>p.id===id)?.name??id;
 const common:Record<string,string>={'Coffee cell':tr('Trạm cà phê','コーヒーセル','Coffee cell'),'Cup station':tr('Trạm cốc','カップ置場','Cup station'),'Arm-1':tr('Cánh tay 1','アーム1','Arm-1'),'Parking':tr('Điểm chờ','待機場所','Parking'),'Kitchen':tr('Bếp','厨房','Kitchen'),'Dock':tr('Trạm sạc','充電場所','Dock')};
 return common[name]??name;
}
