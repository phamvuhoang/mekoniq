import {expect,test} from 'vitest';
import {WorldPlayback} from '../../src/twin/world-playback';
const poses=(x:number)=>({arms:{arm:{jointsRad:[x],gripperOpeningM:x}},bodies:{amr:{positionM:[x,0,0] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]}},cups:{cup:{positionM:[x,0,1] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]}}});
test('received committed world endpoints interpolate together, stop at newest, and expire',()=>{
 const p=new WorldPlayback();p.feed('run/boot/rev/scene','0',0,poses(0));p.feed('run/boot/rev/scene','100000000',100,poses(1));
 const a=p.at(200)!;expect(a).toMatchObject({bodies:{amr:{positionM:[.5,0,0]}}});expect(a.bodies.amr!.positionM[0]).toBeCloseTo(.5);expect(a.arms.arm!.jointsRad[0]).toBeCloseTo(.5);expect(a.cups!.cup!.positionM[0]).toBeCloseTo(.5);expect(p.at(400)!.bodies.amr!.positionM[0]).toBe(1);expect(p.at(601)).toBeNull();
});
test('run boot revision, missing sample gap and prop membership invalidate interpolation',()=>{
 const p=new WorldPlayback();p.feed('a','0',0,poses(0));p.feed('a','100000000',100,poses(1));p.feed('b','120000000',120,poses(8));expect(p.at(120)!.bodies.amr!.positionM[0]).toBe(8);
 p.feed('b','140000000',700,poses(10));expect(p.at(700)!.bodies.amr!.positionM[0]).toBe(10);const withoutCup={...poses(11),cups:{}};p.feed('b','160000000',720,withoutCup);expect(p.at(720)!.cups).toEqual({});p.clear();expect(p.at(721)).toBeNull();
});
