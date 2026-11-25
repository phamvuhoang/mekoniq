// Layer toggles and legend. Each overlay states its provenance; status is always text or pattern, never color alone.
import {tr} from '../i18n';
/** footprint = physical footprint, path = planned path, contacts = collision; safety/observed/scan exist for IR-SIM 2D runs (compiled navigation scene). */
export type Layer='footprint'|'safety'|'path'|'observed'|'scan'|'contacts'|'frames';
export type Layers=Record<Layer,boolean>;
export const LAYERS:Layer[]=['footprint','safety','path','observed','scan','contacts','frames'];
/** What the 3D view draws; the rest (clearance/contact markers, LiDAR points) is drawn on the 2D plan only and is disabled in 3D with ONLY_2D_REASON. */
export const THREE_D_LAYERS:readonly Layer[]=['footprint','safety','path','observed','frames'];
export const ONLY_2D_REASON=()=>tr('Chỉ vẽ trên mặt bằng 2D; chuyển sang 2D để xem lớp này.','2D平面図でのみ描画されます。表示するには2Dに切り替えてください。','Drawn on the 2D plan only; switch to 2D to see this layer.');
export const defaultLayers=():Layers=>({footprint:true,safety:false,path:true,observed:false,scan:false,contacts:false,frames:false});
export const layerLabel=(l:Layer)=>({footprint:tr('Vùng chiếm chỗ','フットプリント','Footprint'),safety:tr('Vùng an toàn','安全エンベロープ','Safety envelope'),path:tr('Đường đi','経路','Path'),observed:tr('Đường đã đi','走行軌跡','Observed path'),scan:'LiDAR',contacts:tr('Tiếp xúc','接触','Contacts'),frames:tr('Khung tọa độ','座標系','Frames')})[l];
/** Where an IR-SIM layer's data comes from, with units; shown beside the layer, never implied by color. */
export const layerProvenance=(l:Layer)=>({footprint:tr('compiled · khung drive → base · m','コンパイル済み · drive→base座標 · m','compiled · drive → base frame · m'),safety:tr('chính sách mô hình (biên an toàn) · không phải chứng nhận phanh · m','モデル方針(安全余裕)· 制動証明ではない · m','model policy (safety margin) · not a braking certificate · m'),
 path:tr('runtime không gửi đường kế hoạch cho trình duyệt','計画経路はブラウザに送られません','planned path is not sent to the browser by this runtime'),observed:tr('telemetry của plant mô phỏng (IR-SIM hoặc Webots) (mất mẫu được, không nối qua khoảng trống) · m','シミュレーションプラント(IR-SIMまたはWebots)のテレメトリ(欠落あり、欠落は結ばない)· m','simulated-plant telemetry (IR-SIM or Webots) (lossy, never joined across gaps) · m'),
 scan:tr('LiDAR tại pose của đúng tick mẫu · m','サンプルtickの姿勢でのLiDAR · m','LiDAR at the pose of its own sample tick · m'),contacts:tr('từ evidence bền của runtime','ランタイムの永続証跡から','from the runtime durable evidence'),frames:'map / base_link'})[l];
export const toggleLayer=(layers:Layers,l:Layer):Layers=>({...layers,[l]:!layers[l]});
/** Legend: what each mark means. Mock "observed" values come from the backend's observation stream (a model), not from a sensor. */
export const legend=()=>[
 {id:'modeled',mark:'solid',label:tr('Mô hình','モデル','Modeled'),note:tr('hình học / tham số minh họa','参考形状・パラメータ','illustrative geometry / parameters')},
 {id:'observed',mark:'filled',label:tr('Quan sát','観測','Observed'),note:tr('từ luồng quan sát của backend (mock = mô hình)','バックエンド観測(モック=モデル)','from the backend observation stream (mock = model)')},
 {id:'commanded',mark:'dashed-line',label:tr('Lệnh','指令','Commanded'),note:tr('đã phát không có nghĩa đã đến','発行≠到着','issued is not arrived')},
 {id:'derived',mark:'dotted',label:tr('Suy ra','推定','Derived'),note:tr('vị trí cell suy ra từ điểm bàn giao','受渡点から推定した配置','cell placement derived from the handoff point')},
 {id:'unknown',mark:'dashed',label:tr('Chưa rõ','不明','Unknown'),note:tr('không hiển thị thành 0 hay trạng thái tốt','0や正常として表示しない','never shown as zero or healthy')},
];
