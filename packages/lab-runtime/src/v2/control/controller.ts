// R4-A §5.3: the controller contract. Controllers are pure: no clock, no randomness, no truth; they see DriveFeedbackV1 only.
import type {DriveCommandV1,DriveFeedbackV1} from './drive-io';
export interface ControllerEvent {tick:number;code:string;axisId?:string;detail?:string}
export interface MotionController<State,Setpoint,Config> {
 readonly id:string;
 readonly revision:number;
 init(config:Config):State;
 step(state:State,input:{tick:number;setpoint:Setpoint;feedback:readonly DriveFeedbackV1[]}):{state:State;commands:DriveCommandV1[];events:ControllerEvent[]};
}
