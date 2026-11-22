import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {maturityBadgeHtml,maturityOf,overallLevel,type MaturityLevels} from '../../src/reports/calibration';

const all=(l:string)=>({geometry:l,inertia:l,drive:l,contact:l,sensing:l}) as unknown as MaturityLevels;
beforeEach(()=>setLocale('en'));

test('health carries the maturity of each group of each plant; a health without it, or with an unknown level or group, has none',()=>{
 expect(maturityOf({modelMaturity:{mujoco_arm:all('assumed')}})).toEqual({mujoco_arm:all('assumed')});
 for(const bad of [undefined,null,{},{modelMaturity:null},{modelMaturity:{mujoco_arm:all('certified')}},{modelMaturity:{mujoco_arm:{geometry:'assumed'}}},{modelMaturity:{mujoco_arm:{...all('assumed'),qualified:'assumed'}}},{modelMaturity:{mujoco_arm:all('assumed')},x:1}].slice(0,7))expect(maturityOf(bad),JSON.stringify(bad)).toBeNull();
});
test('a plant is as mature as its weakest group',()=>{
 expect(overallLevel({...all('calibrated'),contact:'assumed'})).toBe('assumed');expect(overallLevel(all('nominal'))).toBe('nominal');expect(overallLevel({...all('calibrated'),drive:'illustrative'})).toBe('illustrative');
});
test('the badge names the level in words (not by colour alone), lists every group, and says a level is not a safety statement',()=>{
 const html=maturityBadgeHtml(all('assumed'),{testid:'model-maturity'});
 expect(html).toContain('data-testid="model-maturity"');expect(html).toContain('data-level="assumed"');expect(html).toMatch(/assumed/i);
 for(const g of ['geometry','inertia','drive','contact','sensing'])expect(html).toContain(`data-group="${g}"`);
 expect(html).toMatch(/not a safety/i);
});
test('a calibrated group reads "calibrated" and nothing else about the others changes',()=>{
 const html=maturityBadgeHtml({...all('assumed'),drive:'calibrated'},{testid:'x'});
 expect(html).toContain('data-level="assumed"');expect(html).toMatch(/data-group="drive"[^>]*data-level="calibrated"|data-level="calibrated"[^>]*data-group="drive"/);
});
test('three languages, each with its own words; no plant, no badge',()=>{
 setLocale('ja');const ja=maturityBadgeHtml(all('nominal'),{testid:'x'});setLocale('vi');const vi_=maturityBadgeHtml(all('nominal'),{testid:'x'});setLocale('en');const en=maturityBadgeHtml(all('nominal'),{testid:'x'});
 expect(new Set([ja,vi_,en]).size).toBe(3);expect(maturityBadgeHtml(null,{testid:'x'})).toBe('');
});
