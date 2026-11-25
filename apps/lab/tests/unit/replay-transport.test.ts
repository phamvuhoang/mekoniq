import {expect,test} from 'vitest';
import {catalogueRoot,fileReplayTransport,streamResponse} from '../../src/reports/replay-transport';
test('catalogue accepts named relative IDs only, never query URLs or traversal',()=>{
 expect(catalogueRoot('coffee-delivery')).toBe('/replays/coffee-delivery/');
 for(const id of ['https://host/x','../secret','coffee-delivery?url=x','/coffee'])expect(()=>catalogueRoot(id)).toThrow('REPLAY_CATALOGUE_ID');
});
test('file import rejects duplicate paths before reader allocation',()=>{
 const file={name:'manifest.json',size:2,webkitRelativePath:'one/manifest.json'} as File;
 expect(()=>fileReplayTransport([file,file])).toThrow('REPLAY_DUPLICATE_FILE');
});
test('bounded stream releases reader on overflow and cancellation',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}));
 await expect(async()=>{for await(const _b of streamResponse(response,{signal:new AbortController().signal,maxBytes:3}))void _b;}).rejects.toThrow('REPLAY_ASSET_SIZE_LIMIT');
 expect(cancelled).toBe(true);
});

test('typed capacity refusal does not retry and oversized error bodies remain bounded',async()=>{
 const options={signal:new AbortController().signal,maxBytes:8};await expect(async()=>{for await(const _b of streamResponse(new Response('{"error":"REPLAY_READ_CAPACITY"}',{status:429}),options))void _b;}).rejects.toThrow('REPLAY_READ_CAPACITY');
 let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(5000));},cancel(){cancelled=true;}}),{status:429});await expect(async()=>{for await(const _b of streamResponse(response,options))void _b;}).rejects.toThrow('HTTP_429');expect(cancelled).toBe(true);
});
