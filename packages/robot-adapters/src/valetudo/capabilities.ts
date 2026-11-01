import type { RobotManifest } from '../contract';
/** Pinned upstream: Valetudo 2026.10.0 (docs/operations/valetudo-profile.md, tests/fixtures/valetudo/pin.json). */
export const VALETUDO_PIN={version:'2026.10.0',source:'https://github.com/Hypfer/Valetudo/tree/2026.10.0'} as const;
export const routes={
 robot:'/api/v2/robot',capabilities:'/api/v2/robot/capabilities',attributes:'/api/v2/robot/state/attributes',map:'/api/v2/robot/state/map',
 goto:'/api/v2/robot/capabilities/GoToLocationCapability',hostInfo:'/api/v2/system/host/info',basicControl:'/api/v2/robot/capabilities/BasicControlCapability',
} as const;
/** GoTo moves the robot, BasicControl stop is the only way to end a GoTo. There is no movement-speed capability (FanSpeedControl is suction). */
export const REQUIRED_CAPABILITIES=['GoToLocationCapability','BasicControlCapability'];
/**
 * Provisioned per robot (never from the WebView or cloud request bodies). Tolerances are calibration knobs for the commissioned robot, not
 * universal truths: arriveToleranceM (trial reference 0.40 m), goalToleranceCm (go_to_target vs. the sent goal), stationaryCm/stationaryMs
 * (two idle samples that far apart in time, that close in space), freshMs (newest sample age), tripTimeoutMs (no arrival ⇒ unknown).
 */
export interface ValetudoProfile {
 robotId:string;transport:'rest'|'mqtt'|'native';endpoint?:string;mqtt?:{topicPrefix:string;identifier:string};
 mapId:string;mapRevision:string;mapFingerprint:string;frame:string;firmware:string;validation:RobotManifest['validation'];
 capabilities:RobotManifest['capabilities'];maxLoadMinor:string;trays:number;offlineExecution:boolean;
 arriveToleranceM:number;goalToleranceCm:number;stationaryCm:number;stationaryMs:number;freshMs:number;tripTimeoutMs:number;requestTimeoutMs:number;maxMapBytes:number;
}
const privateV4=(h:string)=>{
 const m=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if(!m) return undefined;
 const [a,b]=[Number(m[1]),Number(m[2])]; if(m.slice(1).some(x=>Number(x)>255)) return false;
 return {lan:a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168),loopback:a===127};
};
/** Only a provisioned http(s) origin on a private LAN address or mDNS `.local` host; no credentials, path, query or fragment. */
export function lanEndpoint(raw:string,options:{allowLoopback?:boolean}={}):string {
 let url:URL; try{url=new URL(raw);}catch{throw new Error('INVALID_ENDPOINT');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!=='')) throw new Error('INVALID_ENDPOINT');
 const v4=privateV4(url.hostname),ok=v4===undefined?/^[a-z0-9-]{1,63}\.local$/i.test(url.hostname):Boolean(v4&&(v4.lan||(options.allowLoopback&&v4.loopback)));
 if(!ok) throw new Error('ENDPOINT_NOT_LAN');
 return url.origin;
}
const topicId=/^[A-Za-z0-9-]{1,64}$/;
export function validateProfile(p:ValetudoProfile,options:{allowLoopback?:boolean}={}):ValetudoProfile {
 if(!p.robotId||!p.mapId||!p.mapRevision||!p.mapFingerprint||!p.frame) throw new Error('INVALID_PROFILE');
 if(p.transport==='rest'||p.transport==='native') lanEndpoint(String(p.endpoint),options);
 else if(p.transport==='mqtt') {if(!p.mqtt||!topicId.test(p.mqtt.topicPrefix)||!topicId.test(p.mqtt.identifier)) throw new Error('INVALID_MQTT_TOPIC');}
 else throw new Error('UNSUPPORTED_TRANSPORT');
 for(const key of ['arriveToleranceM','goalToleranceCm','stationaryCm','stationaryMs','freshMs','tripTimeoutMs','requestTimeoutMs','maxMapBytes'] as const) if(!(Number.isFinite(p[key])&&p[key]>0)) throw new Error('INVALID_PROFILE');
 return p;
}
export function missingCapabilities(reported:string[]):string[] {return REQUIRED_CAPABILITIES.filter(c=>!reported.includes(c));}
