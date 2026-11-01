import { hashPayload } from '../../../contracts/src/canonical';
/** One telemetry observation, native Valetudo units (cm, map space). receivedAtMs is the executor's receive time: Valetudo state carries no timestamp. */
export interface ValetudoSample {
 receivedAtMs:number;reachable:boolean;status?:string;flag?:string;error?:string;
 position?:{x:number;y:number;angle?:number};goToTarget?:{x:number;y:number};mapFingerprint?:string;
 /** Host uptime (GET /api/v2/system/host/info): a decrease is a reboot, even one shorter than the poll interval. */
 uptimeS?:number;
 /** MQTT retained delivery: the broker's last value from before we subscribed, never evidence of the present. */
 retained?:boolean;
}
const STATUS=['error','docked','idle','returning','cleaning','paused','manual_control','moving'];
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v)) throw new Error('INVALID_VALETUDO_PAYLOAD');return v as Record<string,unknown>;};
const point=(e:Record<string,unknown>|undefined)=>{
 const p=e?.points;
 return Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n))?{x:p[0] as number,y:p[1] as number}:undefined;
};
/**
 * ValetudoMap v2 (backend/lib/entities/map/ValetudoMap.js @2026.10.0): cm coordinates, `robot_position` / `go_to_target` PointMapEntity.
 * Valetudo has no map identity (metaData.nonce is regenerated per map object), so the fingerprint is a change detector over size, pixelSize
 * and segment ids: a different fingerprint proves a different map, an equal one proves nothing, which is why bindings stay operator-confirmed.
 */
export function parseMap(value:unknown):{fingerprint:string;position?:{x:number;y:number;angle?:number};goToTarget?:{x:number;y:number}} {
 const map=obj(value),meta=obj(map.metaData),size=obj(map.size);
 if(meta.version!==2||!Number.isInteger(map.pixelSize)||!Number.isInteger(size.x)||!Number.isInteger(size.y)||!Array.isArray(map.layers)||!Array.isArray(map.entities)) throw new Error('UNSUPPORTED_MAP_VERSION');
 const segments=(map.layers as unknown[]).map(obj).filter(l=>l.type==='segment').map(l=>String(obj(l.metaData ?? {}).segmentId ?? '')).sort();
 const entities=(map.entities as unknown[]).map(obj),robot=entities.find(e=>e.type==='robot_position'),target=entities.find(e=>e.type==='go_to_target');
 const at=point(robot),angle=robot?obj(robot.metaData ?? {}).angle:undefined;
 return {fingerprint:hashPayload({size:{x:size.x as number,y:size.y as number},pixelSize:map.pixelSize as number,segments}),...(at?{position:{...at,...(typeof angle==='number'?{angle}:{})}}:{}),...(point(target)?{goToTarget:point(target)}:{})};
}
/** StatusStateAttribute from GET /api/v2/robot/state/attributes (array of serialized attributes with __class). */
export function parseStatus(value:unknown):{status:string;flag?:string;error?:string} {
 if(!Array.isArray(value)) throw new Error('INVALID_VALETUDO_PAYLOAD');
 const attr=value.map(obj).find(a=>a.__class==='StatusStateAttribute');
 if(!attr||!STATUS.includes(String(attr.value))) throw new Error('STATUS_UNAVAILABLE');
 const error=attr.error?String(obj(attr.error).message ?? 'error'):undefined;
 return {status:String(attr.value),...(typeof attr.flag==='string'?{flag:attr.flag}:{}),...(error?{error}:{})};
}
export function sampleOf(attributes:unknown,map:unknown,receivedAtMs:number,hostInfo?:unknown):ValetudoSample {
 const status=parseStatus(attributes),parsed=parseMap(map),uptime=hostInfo===undefined?undefined:obj(hostInfo).uptime;
 if(hostInfo!==undefined&&!(typeof uptime==='number'&&Number.isFinite(uptime))) throw new Error('INVALID_VALETUDO_PAYLOAD');
 return {receivedAtMs,reachable:true,...status,...(typeof uptime==='number'?{uptimeS:uptime}:{}),mapFingerprint:parsed.fingerprint,...(parsed.position?{position:parsed.position}:{}),...(parsed.goToTarget?{goToTarget:parsed.goToTarget}:{})};
}
