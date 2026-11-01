import type { NativeExecutionState } from '../contract';
import type { GoalRecord } from './completion';
/**
 * Valetudo has no goal query (GoToLocationCapability is fire-and-forget, no goal id), so a command without a journal row, or one whose send
 * outcome was never recorded, is `unknown` and is never resent. The journal row is the only memory of what was sent.
 */
export function executionState(goal:GoalRecord|undefined,transport:string):NativeExecutionState {
 if(!goal) return {status:'unknown',evidence:{reason:'NO_GOAL_QUERY',transport}};
 const last=goal.samples.at(-1);
 const status=goal.state==='cancelling'?'executing':goal.state;
 return {status,evidence:{transport,...(goal.reason?{reason:goal.reason}:{}),...(goal.ackAtMs!==undefined?{ackAtMs:goal.ackAtMs}:{}),samples:goal.samples.length,motionSeen:Boolean(goal.motionSeen),...(last?{lastStatus:last.status ?? 'unreachable',lastReceivedAtMs:last.receivedAtMs}:{})}};
}
