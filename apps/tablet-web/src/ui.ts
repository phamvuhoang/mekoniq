import type {CommandResult,JsonObject,Snapshot} from '../../../packages/contracts/src/index';
import type {TabletSession} from './transport/session';
import vi from '../../../packages/ui/locales/vi.json';
import en from '../../../packages/ui/locales/en.json';
export type Language='vi'|'en';
export type ScreenContext={language:Language;session:TabletSession;snapshots:Snapshot[];command:(type:string,payload:JsonObject,expectedVersion?:number,key?:string)=>Promise<CommandResult>;refresh:()=>Promise<void>;notify:(text:string,error?:boolean)=>void};
export const dictionaries={vi,en};
export function tr(c:Pick<ScreenContext,'language'>,vi:string,en:string){return c.language==='vi'?vi:en;}
export function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string):HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export function button(text:string,action:()=>void|Promise<void>,className=''):HTMLButtonElement {
 const node=el('button',text,className);node.type='button';node.addEventListener('click',()=>{if(node.disabled)return;node.disabled=true;Promise.resolve().then(action).finally(()=>{if(node.isConnected)node.disabled=false;});});return node;
}
export function field(label:string,initial='',type='text'):{node:HTMLLabelElement;input:HTMLInputElement}{const node=el('label');node.append(el('span',label));const input=el('input');input.type=type;input.value=initial;node.append(input);return {node,input};}
export function select(label:string,options:{id:string;name:string}[],initial=''):{node:HTMLLabelElement;input:HTMLSelectElement}{const node=el('label');node.append(el('span',label));const input=el('select');for(const option of options){const n=el('option',option.name);n.value=option.id;input.append(n);}input.value=initial||options[0]?.id||'';node.append(input);return {node,input};}
export function panel(title:string,...children:Node[]):HTMLElement {const node=el('section',undefined,'panel');node.append(el('h2',title),...children);return node;}
export function list(c:ScreenContext,kind:string){return c.snapshots.filter(s=>s.ref.kind===kind);}
export function money(minor:unknown,currency='VND'){try{return new Intl.NumberFormat('vi-VN',{style:'currency',currency,maximumFractionDigits:0}).format(BigInt(String(minor)));}catch{return String(minor)+' '+currency;}}
export function summary(snapshot:Snapshot):HTMLElement {const row=el('article',undefined,'record');row.append(el('strong',String(snapshot.state.name??snapshot.ref.id)),el('span',String(snapshot.state.status??snapshot.state.availability??''),'badge'));return row;}
export async function act(c:ScreenContext,type:string,payload:JsonObject,expectedVersion?:number,key?:string){
 try{const result=await c.command(type,payload,expectedVersion,key);if(result.status!=='accepted'){c.notify(result.code??result.status,true);return result;}c.notify(tr(c,'Đã ghi nhận','Recorded'));await c.refresh();return result;}
 catch(error){c.notify(error instanceof Error?error.message:'UNAVAILABLE',true);return undefined;}
}
