// Per-run keys allow independent writes from different tabs. Null masks a legacy
// aggregate entry without rewriting another run's proof.
const decode=(raw:string|null):unknown=>{try{return JSON.parse(raw??'null');}catch{return undefined;}};
export class RunEntries<T> {
 private fallback=new Map<string,T|null>();
 constructor(private legacy:(raw:unknown)=>Record<string,T>,private valid:(value:unknown,id:string)=>value is T){}
 private prefix(namespace:string){return namespace+'::run::';}
 read(namespace:string):Record<string,T>{
  const entries:Record<string,T>=Object.create(null),prefix=this.prefix(namespace);
  const apply=(key:string,value:unknown)=>{const id=key.slice(prefix.length);if(value===null)delete entries[id];else if(this.valid(value,id))entries[id]=value;};
  try{
   Object.assign(entries,this.legacy(decode(localStorage.getItem(namespace))));
   for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))apply(key,decode(localStorage.getItem(key)));}
  }catch{/* Storage restrictions leave the current page's entries usable. */}
  for(const [key,value] of this.fallback)if(key.startsWith(prefix))apply(key,value);
  return entries;
 }
 write(namespace:string,id:string,value:T|null){
  const key=this.prefix(namespace)+id;
  try{
   if(value!==null)localStorage.setItem(key,JSON.stringify(value));
   else if(Object.hasOwn(this.legacy(decode(localStorage.getItem(namespace))),id))localStorage.setItem(key,'null');
   else localStorage.removeItem(key);
   this.fallback.delete(key);
  }catch{this.fallback.set(key,value);}
 }
}
