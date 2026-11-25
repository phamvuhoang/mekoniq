import {afterEach,expect,test,vi} from 'vitest';
import {parseTarget,loadTarget,saveTarget,requestInit,mayAutoProbe,loadToken,saveToken} from '../../src/runtime/target';
afterEach(()=>vi.unstubAllGlobals());
const memory=()=>{const m=new Map<string,string>();return {m,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k)};};

test('parseTarget: empty is this page\'s runtime; http only for loopback hosts; anything else must be https',()=>{
 expect(parseTarget(null,'https://lab.example')).toEqual({base:'/lab/v2',kind:'same_origin'});
 expect(parseTarget('  ','https://lab.example')).toEqual({base:'/lab/v2',kind:'same_origin'});
 expect(parseTarget('http://127.0.0.1:4176','https://lab.example')).toEqual({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'});
 expect(parseTarget('http://localhost:4176/','https://lab.example')).toEqual({base:'http://localhost:4176/lab/v2',kind:'loopback'});
 expect(parseTarget('http://[::1]:4176/lab/v2','https://lab.example')).toEqual({base:'http://[::1]:4176/lab/v2',kind:'loopback'});
 expect(parseTarget('https://rt.example','https://lab.example')).toEqual({base:'https://rt.example/lab/v2',kind:'remote'});
 // the page's own origin typed out is still the page's own runtime (cookie session)
 expect(parseTarget('http://127.0.0.1:4175','http://127.0.0.1:4175')).toEqual({base:'/lab/v2',kind:'same_origin'});
 for(const bad of ['http://rt.example','ftp://x','javascript:1','rt.example','https://user:pw@rt.example','https://rt.example/other','https://rt.example/?q=1','https://rt.example/#x'])
  expect(()=>parseTarget(bad,'https://lab.example'),bad).toThrow('INVALID_RUNTIME_URL');
});

test('the unspecified address is refused in every scheme; https to a loopback host or name is refused (a local runtime is reached by http only)',()=>{
 for(const bad of ['http://0.0.0.0:4176','https://0.0.0.0','http://[::]:4176','https://[::]','http://0:4176',
  'https://127.0.0.1','https://127.0.0.2','https://127.1','https://localhost','https://app.localhost','https://[::1]','https://[::ffff:127.0.0.1]','https://[::ffff:7f00:2]',
  'http://127.0.0.2:4176','http://[::ffff:127.0.0.1]:4176'])
  expect(()=>parseTarget(bad,'https://lab.example'),bad).toThrow('INVALID_RUNTIME_URL');
 expect(parseTarget('https://128.0.0.1','https://lab.example').kind).toBe('remote');
 expect(parseTarget('https://notlocalhost.example','https://lab.example').kind).toBe('remote');
});

test('hosts are classified by their parsed IP literal: mapped forms of the unspecified and loopback addresses are refused; a DNS name starting with 127. is an ordinary remote host',()=>{
 for(const bad of ['https://[::ffff:0:0]','http://[::ffff:0.0.0.0]:4176','https://[::ffff:0.0.0.0]','https://0x7f.1','https://[::7f00:1]','https://2130706433'])
  expect(()=>parseTarget(bad,'https://lab.example'),bad).toThrow('INVALID_RUNTIME_URL');
 for(const ok of ['https://127.example.com','https://127.0.0.1.example.com','https://0.example.com','https://localhost.example.com'])
  expect(parseTarget(ok,'https://lab.example'),ok).toMatchObject({kind:'remote'});
});

test('requestInit: same origin keeps the cookie; other targets send the bearer, no cookie, and loopback names its address space',()=>{
 expect(requestInit({base:'/lab/v2',kind:'same_origin'},'tok')).toEqual({credentials:'same-origin'});
 expect(requestInit({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'},'tok')).toEqual({credentials:'omit',headers:{Authorization:'Bearer tok'},targetAddressSpace:'loopback'});
 expect(requestInit({base:'https://rt.example/lab/v2',kind:'remote'},'tok')).toEqual({credentials:'omit',headers:{Authorization:'Bearer tok'}});
 expect(requestInit({base:'https://rt.example/lab/v2',kind:'remote'},'')).toEqual({credentials:'omit',headers:{}});
});

test('mayAutoProbe: only a loopback page, and only its own origin',()=>{
 const same=parseTarget(null,'x'),loop=parseTarget('http://127.0.0.1:4176','x'),remote=parseTarget('https://rt.example','x');
 expect(mayAutoProbe(same,'127.0.0.1')).toBe(true);expect(mayAutoProbe(same,'localhost')).toBe(true);expect(mayAutoProbe(same,'[::1]')).toBe(true);
 expect(mayAutoProbe(loop,'127.0.0.1')).toBe(false);expect(mayAutoProbe(remote,'localhost')).toBe(false);
 for(const t of [same,loop,remote])expect(mayAutoProbe(t,'lab.example')).toBe(false);
});

test('the address lives in localStorage; the token in sessionStorage under the runtime base; both survive storage being unavailable',()=>{
 const local=memory(),session=memory();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);
 expect(loadTarget('https://lab.example').kind).toBe('same_origin');
 saveTarget('http://127.0.0.1:4176');expect(local.m.get('mekoniq-lab-runtime')).toBe('http://127.0.0.1:4176');
 expect(loadTarget('https://lab.example')).toEqual({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'});
 local.m.set('mekoniq-lab-runtime','http://rt.example');expect(loadTarget('https://lab.example').kind).toBe('same_origin');// an invalid saved value is ignored
 saveTarget(null);expect(local.m.has('mekoniq-lab-runtime')).toBe(false);
 const t=parseTarget('https://rt.example','x');saveToken(t,'s3');
 expect([...session.m.entries()]).toEqual([['mekoniq-lab-session:https://rt.example/lab/v2','s3']]);expect(local.m.size).toBe(0);
 expect(loadToken(t)).toBe('s3');expect(loadToken(parseTarget('http://127.0.0.1:4176','x'))).toBe('');
 saveToken(t,'');expect(session.m.size).toBe(0);
 const broken={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}};
 vi.stubGlobal('localStorage',broken);vi.stubGlobal('sessionStorage',broken);
 expect(()=>{saveTarget('https://rt.example');saveToken(t,'x');}).not.toThrow();
 expect(loadTarget('https://lab.example').kind).toBe('same_origin');expect(loadToken(t)).toBe('');
});
