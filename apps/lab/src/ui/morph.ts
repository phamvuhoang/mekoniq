// Update a rendered region in place: every node whose tag (and id) did not change is kept, so a button under the pointer, an open select and the
// focused control survive a re-render; only attributes and text are rewritten. Children are matched by position, or by id when they have one.
// `skip(el)` keeps an element's children untouched (a canvas a viewer owns).
/** A kept element never changes what it is or does: the same id, data-action and data-value. Otherwise it is replaced, so a click that spans the
 * update is lost (safe) instead of reaching another row's action. */
const sameRole=(a:Element,b:Element)=>a.id===b.id&&['data-action','data-value'].every(k=>a.getAttribute(k)===b.getAttribute(k));
export function morph(from:Element,to:Element,skip:(el:Element)=>boolean=()=>false):void{
 for(const {name} of [...from.attributes])if(!to.hasAttribute(name))from.removeAttribute(name);
 for(const {name,value} of [...to.attributes])if(from.getAttribute(name)!==value)from.setAttribute(name,value);
 if(skip(from))return;
 const ids=new Map<string,Element>();for(const c of from.children)if(c.id)ids.set(c.id,c);
 const next=[...to.childNodes];
 next.forEach((n,i)=>{
  let o:ChildNode|null=from.childNodes[i]??null;
  const keyed=n instanceof Element&&n.id?ids.get(n.id):undefined;
  if(keyed&&keyed!==o){from.insertBefore(keyed,o);o=keyed;}
  if(!o)from.appendChild(n);
  else if(o.nodeType!==n.nodeType||o.nodeName!==n.nodeName||o instanceof Element&&n instanceof Element&&!sameRole(o,n))from.replaceChild(n,o);
  else if(o instanceof Element)morph(o,n as Element,skip);
  else if(o.nodeValue!==n.nodeValue)o.nodeValue=n.nodeValue;
 });
 while(from.childNodes.length>next.length)from.lastChild!.remove();
}
