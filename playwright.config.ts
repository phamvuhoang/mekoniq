import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const chrome=process.env.PLAYWRIGHT_CHROMIUM??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:3452',viewport:{width:1280,height:800},trace:'retain-on-failure',launchOptions:existsSync(chrome)?{executablePath:chrome}:{}},
 reporter:[['list'],['html',{outputFolder:'.lab/playwright-report',open:'never'}]],
 outputDir:'.lab/playwright-results',
 webServer:[
  {command:'MEKONIQ_DEV_LAB=1 node --import tsx tests/support/coordinator-server.ts',url:'http://127.0.0.1:3451/session',reuseExistingServer:false,timeout:30000},
  {command:'MEKONIQ_DEV_LAB=1 pnpm --filter @mekoniq/tablet-web dev',url:'http://127.0.0.1:3452',reuseExistingServer:false,timeout:30000},
 ],
});
