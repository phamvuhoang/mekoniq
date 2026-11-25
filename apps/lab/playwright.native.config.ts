import {defineConfig} from '@playwright/test';
// Explicit external native server only. Never starts the mock launcher or Vite/runtime substitutes.
export default defineConfig({testDir:'tests/e2e',testMatch:'native-run-report.spec.ts',timeout:240000,fullyParallel:false,workers:1,use:{baseURL:process.env.LAB_NATIVE_BASE_URL??'http://127.0.0.1:4175',headless:true,launchOptions:{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},screenshot:'only-on-failure'},reporter:'list'});
