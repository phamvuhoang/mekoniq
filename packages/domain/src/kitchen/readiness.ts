import { fail, quantity } from '../restaurant-context';
export function preparedQuantity(current:string,delta:string,total:string):string {
 const updated=BigInt(current)+BigInt(quantity(delta));
 if(updated>BigInt(total)) return fail('PREPARATION_EXCEEDS_ORDER');
 return String(updated);
}
