import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalize} from 'json-canonicalize';
import {catalog,loadEnabledProfiles,type IntegrationProfile} from '../../integrations/core/src/profile';
export type RigKind='payment'|'einvoice'|'channel';
export type Fixture={name:string;kind:'emulated'|'recorded';body:Record<string,unknown>};
/** A fixture is {provenance:{kind,redacted,sha256,source},body}. The hash binds the body to its provenance, so an edited "recording" is refused instead of silently trusted. */
export function loadFixture(name:string,dir='tests/fixtures/providers'):Fixture{
 const raw=JSON.parse(readFileSync(`${dir}/${name}.json`,'utf8')) as {provenance:{kind:string;redacted:boolean;sha256:string;source:string};body:Record<string,unknown>};
 if(!raw.provenance||!['emulated','recorded'].includes(raw.provenance.kind)||raw.provenance.redacted!==true||!raw.provenance.source)throw new Error('FIXTURE_PROVENANCE_MISSING:'+name);
 if(createHash('sha256').update(canonicalize(raw.body as never)).digest('hex')!==raw.provenance.sha256)throw new Error('FIXTURE_HASH_MISMATCH:'+name);
 return {name,kind:raw.provenance.kind as Fixture['kind'],body:raw.body};
}
export const fixtureHash=(body:unknown)=>createHash('sha256').update(canonicalize(body as never)).digest('hex');
export type RigBase={profile:IntegrationProfile;/** true unless the profile has recorded provider evidence: an emulated rig proves OUR behaviour, never a provider's */emulated:boolean;calls:{name:string;at:number}[];callCount(name:string):number;fixture(name:string):Fixture;close():Promise<void>};
/** Each provider task declares the methods of its simulator here (declaration merging), so `createProviderRig('payment')` is typed without this file importing the simulators. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RigApis {}
export type RigFactory<T>=(base:RigBase)=>Promise<T&{close?:()=>Promise<void>}>;
const factories=new Map<RigKind,RigFactory<object>>();
/** Each provider task (payment, e-invoice, channel) registers the simulator for its kind; the rig itself only resolves the profile, records calls and checks fixtures. */
export function registerRigKind<T extends object>(kind:RigKind,factory:RigFactory<T>){factories.set(kind,factory as RigFactory<object>);}
/** No enabled profile / no registered rig is a failing prerequisite, never a skipped (green) test. */
export async function createProviderRig<K extends RigKind>(kind:K,options:{profileId?:string;fixtureDir?:string;profiles?:IntegrationProfile[]}={}):Promise<RigBase&(K extends keyof RigApis?RigApis[K]:object)>{
 const factory=factories.get(kind);if(!factory)throw new Error(`PREREQUISITE: no provider rig is registered for "${kind}"`);
 const candidates=loadEnabledProfiles(options.profiles??catalog,'sandbox').filter(p=>p.kind===kind&&(!options.profileId||p.id===options.profileId));
 const profile=candidates[0];if(!profile)throw new Error(`PREREQUISITE: no enabled "${kind}" profile${options.profileId?` named ${options.profileId}`:''} (see docs/integrations/profile-onboarding.md)`);
 const calls:RigBase['calls']=[];
 const base:RigBase={profile,emulated:profile.mode==='simulation'||!profile.evidence.sandbox,calls,callCount:name=>calls.filter(c=>c.name===name).length,fixture:name=>loadFixture(name,options.fixtureDir),close:async()=>{}};
 const rig=await factory(base);
 return Object.assign(base,rig,{close:async()=>{await rig.close?.();}}) as RigBase&(K extends keyof RigApis?RigApis[K]:object);
}
