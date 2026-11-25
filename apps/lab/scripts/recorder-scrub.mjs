/** Remove local paths and credential-shaped values before evidence is stored or hashed. */
export function scrubEvidence(text,{workspace,home,node},kind){
 const marker=name=>kind==='junit'?`&lt;${name}&gt;`:`<${name}>`;
 const scrub=t=>t.replaceAll(node,'node').replaceAll(workspace,marker('workspace')).replaceAll(home,marker('home'))
  .replace(/\/(private\/)?var\/folders\/[^"\s)]*/g,marker('tmp')).replace(/\/private\/tmp\/[^"\s)]*/g,marker('tmp')).replace(/(?<![\w<])\/tmp\/[^"\s)]*/g,marker('tmp'))
  .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,marker('jwt')).replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g,marker('supabase-key'));
 // Keep XML delimiters and attribute quotes outside path matching so temporary paths cannot consume markup.
 return kind==='junit'?text.replace(/[^<>"']+/g,scrub):scrub(text);
}
