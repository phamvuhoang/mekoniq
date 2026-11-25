import {expect,test} from 'vitest';
import {verifyRuntime} from '../../src/runtime/compatibility';
test('blocks run when pinned source and contracts differ',()=>{
 expect(verifyRuntime({sourceCommit:'a',schemaHash:'s1',protocolMajor:1},{sourceCommit:'b',schemaHash:'s2',protocolMajor:2})).toEqual({ok:false,reasons:['SOURCE_MISMATCH','CONTRACT_MISMATCH']});
});
test('allows matching immutable runtime identity',()=>{
 expect(verifyRuntime({sourceCommit:'a',schemaHash:'s1',protocolMajor:1},{sourceCommit:'a',schemaHash:'s1',protocolMajor:1})).toEqual({ok:true,reasons:[]});
});
