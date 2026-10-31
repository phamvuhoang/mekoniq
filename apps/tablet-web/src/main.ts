import './styles.css';
import {Capacitor} from '@capacitor/core';
import {hashPayload} from '../../../packages/contracts/src/index';
import type {CommandEnvelope,CommandResult,JsonObject,Snapshot} from '../../../packages/contracts/src/index';
import type {TabletTransport,TabletSession} from './transport/session';
import {developmentTransport} from './transport/http';
import {el,field,button,dictionaries,type Language,type ScreenContext} from './ui';
import {routeScreen,canOpen} from './router';
import {SyncStatus} from '../../../packages/ui/src/SyncStatus';
import {OfflineBanner} from '../../../packages/ui/src/OfflineBanner';
declare const __DEV_LAB__:boolean;
const app=document.querySelector<HTMLDivElement>('#app')!;
let language:Language=localStorage.getItem('mekoniq-language')==='en'?'en':'vi';
let transport:TabletTransport|undefined,session:TabletSession|undefined,snapshots:Snapshot[]=[];
const retries=new Map<string,string>();
let toast=el('p',undefined,'toast');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
const notify=(text:string,error=false)=>{toast.textContent=text;toast.classList.toggle('error',error);};
const context=():ScreenContext=>({language,session:session!,snapshots,command,refresh,notify});
async function command(type:string,payload:JsonObject,expectedVersion?:number,key?:string):Promise<CommandResult>{
 if(!session||!transport)throw new Error('ENROLLMENT_REQUIRED');
 const fingerprint=hashPayload({type,payload,expectedVersion:expectedVersion??null});
 const operationId=key??retries.get(fingerprint)??crypto.randomUUID();retries.set(fingerprint,operationId);
 const now=new Date().toISOString();
 const envelope:CommandEnvelope={schemaVersion:1,organizationId:session.organizationId,venueId:session.venueId,actorRef:session.actorId,deviceId:session.deviceId,deviceEpoch:session.deviceEpoch,coordinatorEpoch:session.coordinatorEpoch,policyRevision:session.policyRevision,operationId,type,payload,payloadHash:hashPayload(payload),occurredAt:now,recordedAt:now,...(expectedVersion!==undefined?{expectedVersion}:{})};
 try{const result=await transport.command(envelope);if(result.ack!=='none')session.level=result.ack;if(result.status==='accepted'){retries.delete(fingerprint);session.level=result.ack==='none'?'unknown':result.ack;}if(result.status==='unknown'){session.level='unknown';session.mode='isolated';}return result;}
 catch(error){session.level='unknown';session.mode='isolated';throw error;}
}
async function refresh(){if(!transport)return;session=await transport.session();snapshots=await transport.snapshots();render();}
function render(){
 if(!session)return;
 document.documentElement.lang=language;
 const words=dictionaries[language],c=context();
 const header=el('header',undefined,'topbar');
 const brand=el('a','MEKONIQ','brand');brand.href='/device';
 const right=el('div',undefined,'header-actions');
 const lang=button(language==='vi'?'EN':'VI',()=>{language=language==='vi'?'en':'vi';localStorage.setItem('mekoniq-language',language);render();},'quiet');lang.setAttribute('aria-label',language==='vi'?'Switch to English':'Chuyển sang tiếng Việt');
 right.append(SyncStatus({level:session.level,language}),lang);header.append(brand,right);
 const nav=el('nav',undefined,'main-nav');nav.setAttribute('aria-label',language==='vi'?'Điều hướng chính':'Primary navigation');
 for(const [path,key,permission] of [['/device','device',''],['/pos','pos','order.write'],['/kitchen','kitchen','kitchen.write'],['/fleet','fleet','mission.write'],['/checkout','checkout','payment.cash'],['/settings','settings','']] as const){if(!canOpen(c,permission))continue;const a=el('a',words[key]);a.href=path;if(location.pathname===path)a.setAttribute('aria-current','page');nav.append(a);}
 const main=el('main');main.id='main';main.tabIndex=-1;
 const path=location.pathname==='/'?'/device':location.pathname;
 const heading=el('div',undefined,'page-heading');const title=path==='/settings'?words.settings:(words as Record<string,string>)[path.slice(1)]??words.device;
 heading.append(el('div',language==='vi'?'VẬN HÀNH NHÀ HÀNG':'RESTAURANT OPERATIONS','eyebrow'),el('h1',title),button(words.refresh,async()=>{try{await refresh();}catch(error){notify(String(error),true);}},'quiet'));
 main.append(OfflineBanner(session.mode,language),heading,routeScreen(path,c));
 toast=el('p',toast.textContent??'','toast');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
 app.replaceChildren(header,nav,main,toast);
}
async function boot(){
 try{
  if(Capacitor.isNativePlatform()){const {nativeTransport}=await import('../../tablet-android/src/ui-entry');transport=await nativeTransport();}
  else if(__DEV_LAB__){transport=developmentTransport();}
  else throw new Error('ENROLLMENT_REQUIRED');
  await refresh();
 }catch(error){
  app.replaceChildren(el('main',undefined,'enrollment'));
  const main=app.firstElementChild!;main.append(el('p','MEKONIQ','eyebrow'),el('h1',dictionaries[language].enroll),el('p',language==='vi'?'Mở ứng dụng Android đã cài và hoàn tất cấp quyền thiết bị. Dữ liệu bán hàng cần lưu trữ native.':'Open the installed Android app and complete device enrollment. Business records require native storage.'),el('p',error instanceof Error?error.message:'UNAVAILABLE','muted'),button(dictionaries[language].retry,boot));
  if(Capacitor.isNativePlatform()){
    const access=field(language==='vi'?'Phiên quản lý để cấp quyền thiết bị':'Manager session for device enrollment','','password');access.input.autocomplete='off';
    const enroll=button(language==='vi'?'Cấp quyền thiết bị':'Enroll device',async()=>{try{const {Identity}=await import('../../tablet-android/src/lan-bridge');await Identity.enroll({accessToken:access.input.value});access.input.value='';await boot();}catch(e){main.append(el('p',e instanceof Error?e.message:'ENROLLMENT_FAILED','error'));}});
    const refresh=button(language==='vi'?'Áp dụng quyền đã cấp':'Apply granted permissions',async()=>{try{const {Identity}=await import('../../tablet-android/src/lan-bridge');await Identity.refreshProvisioning({accessToken:access.input.value});access.input.value='';await boot();}catch(e){main.append(el('p',e instanceof Error?e.message:'PROVISION_FAILED','error'));}});
    main.append(access.node,enroll,refresh);
  }
 }
}
document.addEventListener('click',event=>{const a=(event.target as Element).closest('a');if(!a||a.origin!==location.origin||!a.pathname.startsWith('/'))return;event.preventDefault();history.pushState(null,'',a.pathname+location.search);render();});
window.addEventListener('popstate',render);
window.addEventListener('pagehide',()=>{void transport?.close();});
setInterval(()=>{if(!transport||!session||document.hidden)return;void Promise.all([transport.session(),transport.snapshots()]).then(([nextSession,next])=>{const changed=JSON.stringify(next)!==JSON.stringify(snapshots);session=nextSession;snapshots=next;if(changed){if(document.activeElement?.matches('input,textarea,select'))notify(language==='vi'?'Dữ liệu đã thay đổi. Bản nháp vẫn được giữ; chọn Làm mới khi sẵn sàng.':'New data is available. Your draft is preserved; refresh when ready.');else render();}}).catch(()=>{if(session){session.mode='isolated';session.level='unknown';}});},2000);
void boot();
