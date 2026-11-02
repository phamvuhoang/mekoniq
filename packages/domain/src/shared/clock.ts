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
/** Venue-local ISO weekday (Mon=1..Sun=7) and minutes since local midnight for a UTC timestamp. */
export function localTimeAt(timestamp:string,timeZone:string):{weekday:number;minutes:number} {
 const fields=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utcEpochMs(timestamp)));
 const value=(name:string)=>fields.find(field=>field.type===name)!.value;
 return {weekday:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(value('weekday'))+1,minutes:(Number(value('hour'))%24)*60+Number(value('minute'))};
}
