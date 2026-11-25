import {expect,test} from 'vitest';
import {storyCameraTransition} from '../../src/twin/story-camera';
test('manual orbit disables follow until explicitly enabled; reduced motion uses instant transitions',()=>{
 let state=storyCameraTransition({camera:'overview',follow:false,phaseFollow:false,instant:false},{type:'enable-follow',enabled:true});
 expect(state).toMatchObject({camera:'amr',follow:true});
 state=storyCameraTransition(state,{type:'manual-orbit'});expect(state.follow).toBe(false);
 expect(storyCameraTransition(state,{type:'phase',camera:'cell'}).camera).toBe('amr');
 state=storyCameraTransition(state,{type:'phase-follow',enabled:true});
 expect(storyCameraTransition(state,{type:'phase',camera:'cell',reducedMotion:true})).toMatchObject({camera:'cell',instant:true});
});

test('phase following is opt-in and explicit camera selection resets follow deterministically',()=>{
 const initial={camera:'overview' as const,follow:false,phaseFollow:false,instant:false};
 expect(storyCameraTransition(initial,{type:'phase',camera:'cell'})).toBe(initial);
 expect(storyCameraTransition({...initial,follow:true},{type:'select',camera:'overview',reducedMotion:true})).toMatchObject({camera:'overview',follow:false,instant:true});
});
