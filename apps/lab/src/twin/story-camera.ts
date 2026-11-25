/** Pure view state. A camera never changes Source execution or evidence. */
export type StoryCamera='overview'|'cell'|'amr';
export interface StoryCameraState {camera:StoryCamera;follow:boolean;phaseFollow:boolean;instant:boolean}
export type StoryCameraEvent={type:'manual-orbit'}|{type:'enable-follow';enabled:boolean}|{type:'phase-follow';enabled:boolean}|{type:'select'|'phase';camera:StoryCamera;reducedMotion?:boolean};
export function storyCameraTransition(state:StoryCameraState,event:StoryCameraEvent):StoryCameraState{
 if(event.type==='manual-orbit')return {...state,follow:false,phaseFollow:false};
 if(event.type==='enable-follow')return {...state,camera:event.enabled?'amr':state.camera,follow:event.enabled};
 if(event.type==='phase-follow')return {...state,phaseFollow:event.enabled};
 if(event.type==='phase'&&!state.phaseFollow)return state;
 return {...state,camera:event.camera,follow:event.camera==='amr',instant:!!event.reducedMotion};
}
