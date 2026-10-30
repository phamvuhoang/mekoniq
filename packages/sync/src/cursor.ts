function cursorValue(value:string){if(!/^(0|[1-9][0-9]*)$/.test(value)||value.length>40)throw new Error('INVALID_CURSOR');return BigInt(value);}
export function contiguousCursor(values:string[],previous:string) {
 let cursor=cursorValue(previous);const received=new Set(values.map(v=>String(cursorValue(v))));
 while(received.has(String(cursor+1n)))cursor+=1n;
 return String(cursor);
}
