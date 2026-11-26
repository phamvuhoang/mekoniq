export interface SuiteR5 {id:string;repo:'source'|'lab';kind:'vitest'|'playwright';files?:string[];command?:string[]}
export interface CaseR5 {suites?:string[];input?:string;notRun?:string}
export const SUITES_R5:SuiteR5[];
export const CASES_R5:Record<string,CaseR5>;
export const GATES_R5:Record<string,string[]>;
export const EXTERNAL_GATES_R5:Record<string,string>;
export const CLOSING_GATES_R5:string[];
export function tableR5():{documentType:string;campaign:boolean;cases:Record<string,CaseR5>;gates:Record<string,string[]>;suites:SuiteR5[]};
export function qualifyR5Structure(input:unknown):unknown;
export function checkR5Structure(m:unknown,read:unknown):string[];
export function validateR5Selectors(table:{suites:SuiteR5[]},roots:Record<string,string>):void;
export const CUTTABLE_R5:Record<string,{cases:string[];releaseName:string}>;
export function checkR5Closing(m:unknown,options?:{cut?:string[];cloudSupplementIssues?:string[]|null}):{closed:boolean;releaseName:string|null;issues:string[]};
