import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {admittedLoad,payloadPreset,trayPreset,selectTrayExperiment,TRAY_EXPERIMENT_IDS,trayExperimentLabel,isMobilePreset,MUJOCO_MOBILE_SET} from '../../src/twin/payload';
import {presetById,presets} from '../../src/scenarios/catalog';
import {requestForPreset} from '../../src/scenarios/controls';
beforeEach(()=>setLocale('en'));

test('the tray preset is MJ-TRAY01 on the MuJoCo mobile set, starting at the nominal variant, with no receipt yet',()=>{
 const p=trayPreset();
 expect(p).toMatchObject({id:'mujoco-tray',mode:'simulation',scenarioId:'MJ-TRAY01',scenarioRevision:1,backendSetId:MUJOCO_MOBILE_SET,speed:1});
 expect(p.engineering!.project.mujocoExperimentId).toBe('tray-nominal-v1');expect(p.engineering!.project.requestedProfile).toBe(MUJOCO_MOBILE_SET);expect(p.engineering!.receipt).toBeNull();
 expect(p.engineering!.project.driveExperimentId).toBeUndefined();   // the variant implies its drive experiment; the project does not name one
 expect(p.title()).toMatch(/tray/i);
});

test('it is in the catalog beside the payload preset and runs only from a compiled receipt',()=>{
 expect(presetById('mujoco-tray')).toBeDefined();expect(presets.map(x=>x.id)).toContain('mujoco-payload');
 expect(()=>requestForPreset(presetById('mujoco-tray')!)).toThrow();
});

test('the five registered variants are the only ids, each selection is a fresh draft and voids the receipt',()=>{
 expect([...TRAY_EXPERIMENT_IDS].sort()).toEqual(['tray-accel-high-v1','tray-low-friction-v1','tray-nominal-v1','tray-person-crossing-v1','tray-torque-limited-v1']);
 const p=trayPreset();
 for(const id of TRAY_EXPERIMENT_IDS){
  const next=selectTrayExperiment({...p,engineering:{...p.engineering!,receipt:{state:'compiled'} as never}},id);
  expect(next.engineering!.project.mujocoExperimentId).toBe(id);expect(next.engineering!.receipt).toBeNull();
  expect(trayExperimentLabel(id)).not.toBe(id);
 }
 expect(p.engineering!.project.mujocoExperimentId).toBe('tray-nominal-v1');   // not edited in place
 for(const bad of ['payload-center-v1','tray-nominal-v2','','__proto__'])expect(()=>selectTrayExperiment(p,bad),bad).toThrow('MUJOCO_EXPERIMENT_UNREGISTERED');
 expect(()=>selectTrayExperiment(payloadPreset(),'tray-nominal-v1')).toThrow('MUJOCO_EXPERIMENT_UNREGISTERED');
});

test('both MuJoCo mobile presets are mobile presets, nothing else is',()=>{
 expect(isMobilePreset('mujoco-payload')).toBe(true);expect(isMobilePreset('mujoco-tray')).toBe(true);
 for(const id of ['mujoco-cell','mujoco-coffee','delivery','','mujoco-trays'])expect(isMobilePreset(id),id).toBe(false);
});

test('the labels are in all three languages',()=>{
 const seen=new Set<string>();
 for(const l of ['vi','ja','en'] as const){setLocale(l);for(const id of TRAY_EXPERIMENT_IDS)seen.add(l+trayExperimentLabel(id));}
 expect(seen.size).toBe(15);
});

test('the twin admits exactly the registered loads, the two three-cup tray loads included, and nothing else',()=>{
 for(const id of ['empty','cup-center','cup-offset','cup-triple','cup-triple-low-friction'])expect(admittedLoad(id),id).not.toBeNull();
 expect(admittedLoad('cup-triple')!.props).toHaveLength(3);expect(admittedLoad('cup-triple-low-friction')!.props.map(p=>p.propId)).toEqual(['cup-1','cup-2','cup-3']);
 for(const bad of ['cup-quad','','__proto__','constructor'])expect(admittedLoad(bad),bad).toBeNull();
});
