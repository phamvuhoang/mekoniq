import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('original artwork remains byte exact and inert',()=>{
 const manifest=JSON.parse(readFileSync('../lab/docs/specs/2026-11-06-brand-ui-unification/assets-manifest.json','utf8'));
 for(const f of manifest.files){const b=readFileSync(`packages/ui/brand/${f.file}`);expect(createHash('sha256').update(b).digest('hex')).toBe(f.sha256);if(f.file.endsWith('.svg'))expect(b.toString()).not.toMatch(/<script|<foreignObject|\son\w+\s*=|(?:href|src)=["'](?:https?:|\/\/)/i);}
});
