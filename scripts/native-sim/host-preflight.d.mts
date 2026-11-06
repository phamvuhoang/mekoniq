export function resourceDecision(input:{systemFreeBytes:number;vmFreeBytes:number;sameVolume:boolean;memoryBytes:number}):{canProvision:boolean;blockers:string[];runConcurrently:boolean;vmBudgetGiB:number;systemReserveGiB:number};
export function hostPreflight(vmRoot?:string):Promise<Record<string,unknown>>;
