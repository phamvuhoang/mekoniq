import {test,expect} from '@playwright/test';
// The in-place update (src/ui/morph.ts) in a real browser: a kept element never changes what it does. Needs only the Lab UI (no runtime):
// node scripts/test-mock-e2e.mjs morph.spec.ts, or pnpm exec playwright test morph.spec.ts (which starts pnpm dev).
test('a row removed above: no kept element takes another row\'s action; unchanged rows keep their nodes',async({page})=>{
 await page.goto('/');
 const r=await page.evaluate(async()=>{
  const {morph}=await import('/src/ui/morph.ts' as string) as typeof import('../../src/ui/morph');
  const list=(ids:string[])=>{const t=document.createElement('template');t.innerHTML=`<ul>${ids.map(id=>`<li><button data-action="twin-select" data-value="${id}">${id}</button></li>`).join('')}</ul>`;return t.content.firstElementChild!;};
  const host=list(['a','b','c']);document.body.append(host);
  const before=[...host.querySelectorAll('button')],was=before.map(b=>b.dataset.value);
  morph(host,list(['b','c']));// the first row is gone
  const changed=before.filter((b,i)=>b.isConnected&&b.dataset.value!==was[i]);// a kept node that now carries another row's action
  const now=[...host.querySelectorAll('button')].map(b=>b.dataset.value);
  // nothing changed: every node is kept
  const same=list(['b','c']);const keep=[...host.querySelectorAll('button')];morph(host,same);
  return {changed:changed.length,now,kept:keep.every(b=>b.isConnected)};
 });
 expect(r.now).toEqual(['b','c']);
 expect(r.changed).toBe(0);
 expect(r.kept).toBe(true);
});
