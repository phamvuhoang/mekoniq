// One browser storage key per run. A tombstone masks an entry in the legacy aggregate
// without rewriting it while another tab is reading or updating a different run.
export class RunEntries<T> {
 private fallback=new Map<string,T|null>();
 constructor(private legacy:(raw:unknown)=>Record<string,T>){}
 private prefix(namespace:string){return namespace+'::run::';}
 read(namespace:string):Record<string,T>{
  const entries:Record<string,T>=Object.create(null),prefix=this.prefix(namespace);
  const apply=(key:string,value:T|null)=>{const id=key.slice(prefix.length);if(value===null)delete entries[id];else entries[id]=value;};
  try{
   Object.assign(entries,this.legacy(JSON.parse(localStorage.getItem(namespace)??'null')));
   for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))apply(key,JSON.parse(localStorage.getItem(key)??'null'));}
  }catch{/* Storage restrictions leave the current page's entries usable. */}
  for(const [key,value] of this.fallback)if(key.startsWith(prefix))apply(key,value);
  return entries;
 }
 write(namespace:string,id:string,value:T|null){
  const key=this.prefix(namespace)+id;
  try{
   if(value!==null)localStorage.setItem(key,JSON.stringify(value));
   else if(Object.hasOwn(this.legacy(JSON.parse(localStorage.getItem(namespace)??'null')),id))localStorage.setItem(key,'null');
   else localStorage.removeItem(key);
   this.fallback.delete(key);
  }catch{this.fallback.set(key,value);}
 }
}
