import {defineConfig,type Plugin} from 'vite';
import {readFile} from 'node:fs/promises';
// @ts-expect-error JavaScript CLI boundary
import {validatedRuntimePort} from './scripts/launcher-output.mjs';
function runtimeLock():Plugin {
 const path=new URL('./config/source-runtime.lock.json',import.meta.url);
 return {name:'runtime-lock',configureServer(server){server.middlewares.use('/source-runtime.lock.json',async(_req,res)=>{try{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(path,'utf8'));}catch{res.statusCode=404;res.end('{}');}});},async generateBundle(){try{this.emitFile({type:'asset',fileName:'source-runtime.lock.json',source:await readFile(path,'utf8')});}catch{/* Public configurator builds without an installed runtime. */}}};
}
export default defineConfig({plugins:[runtimeLock()],server:{host:'127.0.0.1',port:4175,strictPort:true,proxy:{'/lab':{target:`http://127.0.0.1:${validatedRuntimePort(process.env.LAB_RUNTIME_PORT)}`,changeOrigin:false}}},build:{target:'es2022'}});
