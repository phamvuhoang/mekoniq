// Capture real local UI. Start the isolated coordinator/tablet and Lab Vite first.
const {chromium}=require('../../../node_modules/@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const out=path.join(__dirname,'screenshots');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const manifest=[];
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const labCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(root,'../lab'),encoding:'utf8'}).trim();
 try{
  for(const [id,title,route] of [['source-pos','Gọi món tại quầy','pos'],['source-kitchen','Điều hành bếp / KDS','kitchen'],['source-fleet','Điều phối đội robot','fleet'],['source-inventory','Kho và nguyên liệu','inventory'],['source-checkout','Thu ngân và thanh toán','checkout'],['source-device','Thiết bị và đồng bộ','device']]){
   await page.goto(`http://127.0.0.1:3452/${route}?actor=manager&lab=platform-guide-20261106`);
   await page.getByRole('button',{name:/^(Làm mới|Refresh)$/}).waitFor();
   await page.screenshot({path:path.join(out,id+'.png'),fullPage:true});
   manifest.push({id,title,file:id+'.png',repo:'source',origin:'fresh',revision:sourceCommit,capturedAt:new Date().toISOString(),scope:'Tablet web local, isolated fixture coordinator; dữ liệu thử nghiệm, không phải Vercel/nhà hàng thật.',route:'/'+route});
  }
  for(const [id,title,route] of [['lab-design','Thiết kế và cấu hình robot','design'],['lab-world','Thiết kế mặt bằng nhà hàng','restaurant'],['lab-scenarios','Kịch bản mô phỏng','scenarios'],['lab-deployment','Xuất cấu hình triển khai','deployment']]){
   await page.goto('http://127.0.0.1:4175/#'+route);
   await page.locator('h1').waitFor();await page.waitForTimeout(1000);
   await page.screenshot({path:path.join(out,id+'.png'),fullPage:true});
   manifest.push({id,title,file:id+'.png',repo:'lab',origin:'fresh',revision:labCommit,capturedAt:new Date().toISOString(),scope:'UI local trên HEAD hiện tại; runtime không kết nối trong ảnh cấu hình này.',route:'#'+route});
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(__dirname,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({screenshots:manifest.length,out}));
})().catch(e=>{console.error(e);process.exit(1);});
