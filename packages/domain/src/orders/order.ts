import type { JsonObject } from '../../../contracts/src/index';
import { fail } from '../restaurant-context';
export function assertMutableOrder(state:JsonObject):void {
 if(state.status==='closed') return fail('ORDER_CLOSED');
 if(state.billId || state.status==='billed') return fail('ORDER_FROZEN');
 if(state.status==='cancelled') return fail('ORDER_CANCELLED');
}
export function lineReferences(state:JsonObject):JsonObject[] { return (state.lines ?? []) as JsonObject[]; }
