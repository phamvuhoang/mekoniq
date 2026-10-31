/** Inject a clock at application boundaries; reducers receive timestamps explicitly. */
export interface Clock { nowMs(): number }
export function utcEpochMs(timestamp: string): number {
  if (!/Z$/.test(timestamp)) throw new Error('INVALID_UTC_TIMESTAMP');
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error('INVALID_UTC_TIMESTAMP');
  return value;
}
export function businessDateAt(timestamp:string,timeZone:string):string {
 const date=new Date(utcEpochMs(timestamp));
 const fields=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value=(name:string)=>fields.find(field=>field.type===name)!.value;
 return `${value('year')}-${value('month')}-${value('day')}`;
}
