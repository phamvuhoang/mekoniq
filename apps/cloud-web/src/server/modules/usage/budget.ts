export function usageState(used:number|null,limit:number){
 if(used===null)return 'unknown';if(!Number.isFinite(used)||used<0||!Number.isFinite(limit)||limit<=0)throw new Error('INVALID_USAGE');
 return used>=limit*.85?'critical':used>=limit*.70?'warning':'normal';
}
export type UsageMeasure={metric:string;used:number|null;limit:number;source:string|null;measuredAt:string|null;estimate:boolean;scope:'project'|'organization'};
export function budgetReport(measures:UsageMeasure[]){return measures.map(m=>({...m,state:usageState(m.used,m.limit),remaining:m.used===null?null:Math.max(0,m.limit-m.used)}));}
