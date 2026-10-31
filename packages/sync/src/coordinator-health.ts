export type CoordinatorHealth={serviceUp:boolean;runtimeLastSeenMs:number;nowMs:number;storeWritable:boolean};
export function coordinatorReady(state:CoordinatorHealth):boolean {
 const age=state.nowMs-state.runtimeLastSeenMs;
 return state.serviceUp&&state.storeWritable&&Number.isFinite(age)&&age>=0&&age<=2000;
}
