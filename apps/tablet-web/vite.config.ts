import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({
  define:{__DEV_LAB__:JSON.stringify(process.env.MEKONIQ_DEV_LAB==='1' && mode!=='production')},
  server:{host:'127.0.0.1',port:3452,strictPort:true,proxy:Object.fromEntries(['/session','/snapshots','/commands','/test'].map(path=>[path,{target:'http://127.0.0.1:3451'}]))},
  build:{target:'es2022'},
}));
