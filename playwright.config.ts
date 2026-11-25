import {defineConfig} from '@playwright/test';
// LAB_PW_JSON=<file>: also write a machine-readable JSON result (evidence runs); the console reporter stays 'list'.
// LAB_PW_OUTPUT_DIR=<directory>: retain failure attachments in this invocation's evidence directory.
// Playwright supplies FORCE_COLOR to both the worker and its webserver.
delete process.env.NO_COLOR;
const baseURL=process.env.LAB_PW_BASE_URL??'http://127.0.0.1:4175';
export default defineConfig({...process.env.LAB_PW_OUTPUT_DIR?{outputDir:process.env.LAB_PW_OUTPUT_DIR}:{},testDir:'tests/e2e',testIgnore:['**/native-run-report.spec.ts','**/irsim-*.spec.ts','**/webots-*.spec.ts','**/mujoco-*.spec.ts'],reporter:process.env.LAB_PW_JSON?[['list'],['json',{outputFile:process.env.LAB_PW_JSON}]]:'list',timeout:30000,fullyParallel:false,use:{baseURL,headless:true,launchOptions:{executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},screenshot:'only-on-failure'},webServer:{command:'pnpm dev',url:baseURL,reuseExistingServer:!process.env.CI,timeout:30000}});
