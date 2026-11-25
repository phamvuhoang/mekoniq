// V07 (R4.2 §6.3): the Control tab's plots are plain inline SVG strings (no script, no library) with a table alternative.
import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'vi',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'vi'}};});
import {setLocale} from '../../src/i18n';
import {linePlot,plotTable} from '../../src/ui/svg-plot';
beforeEach(()=>setLocale('vi'));
const opts={width:640,height:200,xLabel:'t (s)',yLabel:'rad/s'};
const wave=(n:number,f:(i:number)=>number)=>Array.from({length:n},(_,i)=>[i*0.002,f(i)] as const);

test('5,000 points per series give exactly one polyline per series, no script, a title and a description; a dashed series is dashed',()=>{
 const svg=linePlot([{id:'target',label:'Lệnh',points:wave(5000,i=>i<20?0:2)},{id:'actual',label:'Thực',points:wave(5000,i=>2*(1-Math.exp(-i/80)))},{id:'feedback',label:'Phản hồi',points:wave(5000,i=>2*(1-Math.exp(-i/90))),dashed:true}],opts);
 expect(svg.startsWith('<svg')).toBe(true);
 expect(svg.match(/<polyline/g)).toHaveLength(3);
 expect(svg).not.toMatch(/<script|on[a-z]+=/i);
 expect(svg).toMatch(/<title[^>]*>[^<]+<\/title>/);expect(svg).toMatch(/<desc[^>]*>[^<]+<\/desc>/);
 expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
 // every point of the 5,000 is drawn (no silent decimation of the recorded trace)
 const first=/<polyline[^>]*points="([^"]*)"/.exec(svg)![1]!;expect(first.trim().split(' ')).toHaveLength(5000);
});
test('an empty plot is a frame that says there is no data, in the current language',()=>{
 for(const [l,word] of [['vi','không có dữ liệu'],['ja','データなし'],['en','no data']] as const){
  setLocale(l);const svg=linePlot([{id:'a',label:'A',points:[]}],opts);
  expect(svg).toContain(word);expect(svg).not.toContain('<polyline');expect(svg).toContain('<rect');
  expect(linePlot([],opts)).toContain(word);
 }
});
test('a gap (a non-finite value) breaks the line instead of drawing through it; bands are drawn with their label; labels are escaped',()=>{
 const svg=linePlot([{id:'a',label:'<img src=x onerror=alert(1)>',points:[[0,1],[1,2],[2,NaN],[3,2],[4,1]]}],{...opts,bands:[{from:1,to:3,label:'bão hòa'}]});
 expect(svg.match(/<polyline/g)).toHaveLength(2);
 expect(svg).toContain('bão hòa');expect(svg).toMatch(/<rect[^>]*class="plot-band"/);
 expect(svg).not.toContain('<img');expect(svg).toContain('&lt;img');
});
test('the table alternative has one column per series and at most maxRows rows; a missing value is a dash, never 0',()=>{
 const html=plotTable([{id:'a',label:'Lệnh',points:wave(5000,()=>1)},{id:'b',label:'Thực',points:wave(5000,i=>i===0?NaN:0.5)}],40);
 expect(html).toContain('<table');expect(html).toContain('<th scope="col">Lệnh</th>');expect(html).toContain('<th scope="col">Thực</th>');
 const rows=html.match(/<tr>/g)!.length-1;expect(rows).toBeLessThanOrEqual(40);expect(rows).toBeGreaterThan(30);
 expect(html).toContain('<td>—</td>');
 expect(plotTable([],10)).toContain('không có dữ liệu');
});
