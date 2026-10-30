export async function pullJournal(url:string,cursor:string,headers:HeadersInit={}) {
 const endpoint=new URL(url);endpoint.searchParams.set('after',cursor);
 const response=await fetch(endpoint,{headers,cache:'no-store'});if(!response.ok)throw new Error(`SYNC_UNAVAILABLE:${response.status}`);
 return response.json();
}
