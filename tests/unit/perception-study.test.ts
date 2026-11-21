import {expect,test} from 'vitest';
import {PERCEPTION_STUDY_POINTS,wilsonInterval,rigOffsetM} from '../../packages/lab-runtime/src/v2/perception/perception-study';
test('the Wilson interval matches the reference values',()=>{
 expect(wilsonInterval(8,10).low).toBeCloseTo(0.4902,3);expect(wilsonInterval(8,10).high).toBeCloseTo(0.9433,3);
 expect(wilsonInterval(0,10).low).toBe(0);expect(wilsonInterval(0,10).high).toBeCloseTo(0.2775,3);
 expect(wilsonInterval(10,10).high).toBe(1);expect(()=>wilsonInterval(0,0)).toThrow('POPULATION_EMPTY');
});
test('the registered study has 92 rig runs, one seed for the deterministic points',()=>{
 expect(PERCEPTION_STUDY_POINTS.reduce((n,p)=>n+p.seeds.length,0)).toBe(92);
 expect(new Set(PERCEPTION_STUDY_POINTS.map(p=>p.id)).size).toBe(PERCEPTION_STUDY_POINTS.length);
 for(const p of PERCEPTION_STUDY_POINTS){expect(new Set(p.seeds).size).toBe(p.seeds.length);if(p.truthOffsetM===0&&!p.nudge&&(p.profileId===null||p.mode==='belief_ground_truth'))expect(p.seeds).toHaveLength(1);}
 expect(PERCEPTION_STUDY_POINTS.filter(p=>p.mode==='belief_estimated'&&p.profileId===null)).toEqual([]);
 expect(PERCEPTION_STUDY_POINTS.filter(p=>p.mode!=='belief_estimated'&&p.profileId!==null)).toEqual([]);
});
test('the same seed gives the same offset direction, and the magnitude is the declared one',()=>{
 const a=rigOffsetM(7,0.02),b=rigOffsetM(7,0.02);expect(a).toEqual(b);expect(Math.hypot(a[0],a[1])).toBeCloseTo(0.02,12);
 expect(rigOffsetM(7,0)).toEqual([0,0]);expect(rigOffsetM(8,0.02)).not.toEqual(a);
});
