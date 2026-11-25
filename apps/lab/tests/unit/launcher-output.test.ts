import {expect,test} from 'vitest';
// @ts-expect-error JavaScript CLI boundary
import {pairingOutput,validatedRuntimePort} from '../../scripts/launcher-output.mjs';
test('pairing output redacts a token even when every character arrives in a separate chunk',()=>{
 let output='';const filter=pairingOutput((s:string)=>output+=s);
 for(const c of 'Ready\nOpen UI and enter this one-use pairing code (expires in 5 minutes): private-token\nReady in 50 ms.\n')filter.write(c);
 filter.end();expect(output).not.toContain('private-token');expect(output).toContain('<redacted>');expect(output).toContain('Ready in 50 ms.');
});
test('runtime proxy refuses operational ports and malformed input before connecting',()=>{
 expect(validatedRuntimePort(undefined)).toBe(4176);expect(validatedRuntimePort('4176')).toBe(4176);
 for(const p of ['1880','1884','bad','0','65536','4176.5',''])expect(()=>validatedRuntimePort(p)).toThrow('INVALID_RUNTIME_PORT');
});
