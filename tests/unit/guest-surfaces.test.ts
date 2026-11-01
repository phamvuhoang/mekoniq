import {expect,test} from 'vitest';
import {endGuestDraft,guestDraft,guestSubmit} from '../../apps/tablet-web/src/screens/Kiosk';
import type {ScreenContext} from '../../apps/tablet-web/src/ui';
import type {CommandResult} from '../../packages/contracts/src/index';
test('a guest cart belongs to one seating and is dropped when the seating changes or the kiosk ends',()=>{
 const a=guestDraft('kiosk:token-a');a.lines.set('tea',2n);
 expect(guestDraft('kiosk:token-a')).toBe(a);
 const b=guestDraft('robot:sim-1:session-b');expect(b.lines.size).toBe(0);expect(b.operationId).not.toBe(a.operationId);
 expect(guestDraft('kiosk:token-a').lines.size).toBe(0); // the old seating's items never come back
 guestDraft('kiosk:token-a').lines.set('rice',1n);endGuestDraft();expect(guestDraft('kiosk:token-a').lines.size).toBe(0);
});
test('a guest submit reports success only on accepted and resends with the caller\'s operation id',async()=>{
 const seen:(string|undefined)[]=[],results:CommandResult['status'][]=['unknown','rejected','accepted'];
 const c={language:'en',notify:()=>{},refresh:async()=>{},command:async(_t:string,_p:unknown,_v?:number,key?:string)=>{seen.push(key);return {status:results.shift()!,code:'X',value:{},duplicate:false,ack:'none',operationId:key??''} as CommandResult;}} as unknown as ScreenContext;
 const cart=guestDraft('kiosk:retry');
 expect(await guestSubmit(c,'Guest.PlaceOrder',{},cart.operationId)).toBe(false);
 expect(await guestSubmit(c,'Guest.PlaceOrder',{},cart.operationId)).toBe(false);
 expect(await guestSubmit(c,'Guest.PlaceOrder',{},cart.operationId)).toBe(true);
 expect(new Set(seen)).toEqual(new Set([cart.operationId]));
});
