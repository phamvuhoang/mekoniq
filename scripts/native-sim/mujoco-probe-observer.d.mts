export function observeSpawn<T>(original:(...args:unknown[])=>T,record:(event:unknown)=>void,ownedRoot:string):(...args:unknown[])=>T;
