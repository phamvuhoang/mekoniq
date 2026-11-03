import type { ModuleRegistry } from '../modules';
import { changed, done, expectVersion, fail, handle, requireState, text } from '../restaurant-context';
import { assertMutableOrder, lineReferences } from './order';
import { sessionForOrder, ticketsFor } from './commands';
/**
 * Order.SendCourse {orderId,course,action:'fire'|'hold',expectedVersion}. Lines of course >=2 are placed 'held' (the station does not see them).
 * Fire releases a course's held tickets; hold re-holds tickets the station has not accepted yet. Each ticket stays on its own station,
 * so kitchen and bar progress (and partially-ready) independently.
 */
export function registerCourses(registry:ModuleRegistry):void {
 handle(registry,'Order.SendCourse',(c,s)=>{
  const order=requireState(s,'order',text(c.payload.orderId)); expectVersion(c,order); assertMutableOrder(order.state);
  const session=sessionForOrder(s,order.state) ?? fail('NOT_FOUND');
  if(session.state.status!=='open'||session.state.frozenBillId) return fail('SESSION_FROZEN');
  const course=c.payload.course, action=c.payload.action ?? 'fire';
  if(typeof course!=='number'||!Number.isInteger(course)||course<1||course>9) return fail('INVALID_COURSE');
  if(action!=='fire'&&action!=='hold') return fail('INVALID_COURSE_ACTION');
  const [from,to]=action==='fire'?['held','queued']:['queued','held'];
  const tickets=lineReferences(order.state).filter(l=>l.course===course).flatMap(l=>ticketsFor(s,String(l.id))).filter(t=>t.state.status===from);
  if(!tickets.length) return fail('NOTHING_TO_SEND');
  const courses={...((order.state.courses ?? {}) as Record<string,string>),[String(course)]:action==='fire'?'fired':'held'};
  return done([changed(action==='fire'?'CourseFired':'CourseHeld',order,{courses}),...tickets.map(t=>changed(action==='fire'?'KitchenTicketFired':'KitchenTicketHeld',t,{status:to,...(action==='fire'?{firedAt:c.recordedAt}:{})}))],{orderId:order.ref.id,course,action,lineIds:tickets.map(t=>t.ref.id),stationIds:[...new Set(tickets.map(t=>String(t.state.stationId)))]});
 });
}
