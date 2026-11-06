import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
test('brand contract and actual sRGB foreground contrasts',()=>{
 const t=JSON.parse(readFileSync('packages/ui/brand/tokens.json','utf8')); const all={...t.primitives,...t.semantic};
 const resolve=(k:string):string=>all[k].startsWith('var(')?resolve(all[k].slice(4,-1)):all[k];
 const luminance=(c:string)=>{const v=c.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
 const ratio=(a:string,b:string)=>{const x=luminance(resolve(a)),y=luminance(resolve(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 expect(all['--mekoniq-deep']).toBe('#071D21');expect(all['--mekoniq-motion']).toBe('#B9FB75');expect(all['--mekoniq-logo-orange']).toBe('#FFAA76');expect(all['--mq-on-primary']).toBe('var(--mekoniq-deep)');
 for(const bg of ['--mq-bg','--mq-surface','--mq-surface-raised'])for(const fg of ['--mq-text','--mq-text-muted','--mq-info','--mq-success','--mq-warning','--mq-danger'])expect(ratio(fg,bg)).toBeGreaterThanOrEqual(4.5);
 expect(ratio('--mq-on-primary','--mq-primary')).toBeGreaterThanOrEqual(4.5);expect(ratio('--mq-on-danger','--mq-danger')).toBeGreaterThanOrEqual(4.5);expect(ratio('--mq-control-border','--mq-surface-raised')).toBeGreaterThanOrEqual(3);
});
test('token generator rejects unresolved/cyclic aliases and stays deterministic',async()=>{
 // @ts-expect-error Node script has no TypeScript declaration
 const {renderTokens}=await import('../../scripts/build-brand.mjs');
 const t=JSON.parse(readFileSync('packages/ui/brand/tokens.json','utf8'));
 expect(renderTokens(t)).toBe(readFileSync('packages/ui/brand/tokens.css','utf8'));
 const unknown=structuredClone(t);unknown.semantic['--mq-bg']='var(--mekoniq-unknown)';expect(()=>renderTokens(unknown)).toThrow('Unknown alias');
 const cyclic=structuredClone(t);cyclic.semantic['--mq-bg']='var(--mq-bg)';expect(()=>renderTokens(cyclic)).toThrow('Cyclic alias');
});

test('token aliases reject unknown references and cycles with CSS whitespace',async()=>{
 // @ts-expect-error Node script has no TypeScript declaration
 const {renderTokens}=await import('../../scripts/build-brand.mjs');
 const t=JSON.parse(readFileSync('packages/ui/brand/tokens.json','utf8'));
 t.semantic['--mq-bg']='var( --mekoniq-unknown )';expect(()=>renderTokens(t)).toThrow('Unknown alias');
 t.semantic['--mq-bg']='var( --mq-bg )';expect(()=>renderTokens(t)).toThrow('Cyclic alias');
});
