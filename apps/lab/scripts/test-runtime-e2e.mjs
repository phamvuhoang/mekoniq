import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedRuntime} from './runtime-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24 required.');
// Never stop a developer's running runtime to make a test pass.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error('Port 4176 is in use. Stop your development runtime before this test.')));
  probe.listen(4176, '127.0.0.1', () => probe.close(resolve));
});
const {file} = await checkedRuntime(root);
const directory = await mkdtemp(join(tmpdir(), 'mekoniq-lab-browser-'));
const {MEKONIQ_LAB_ACCESS_KEY: _key, ...env} = process.env; // a local launcher never uses an access key: the runtime must print its pairing code
const runtime = spawn(process.execPath, [file, '--port', '4176', '--data-dir', directory], {cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env});
const runtimeClosed = new Promise(resolve => runtime.once('close', resolve));
let runner;
const stop = () => {runner?.kill('SIGTERM'); runtime.kill('SIGTERM');};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const token = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Runtime did not become ready.')), 10000);
    runtime.once('error', error => {clearTimeout(timeout); reject(error);});
    runtime.once('exit', code => {clearTimeout(timeout); reject(new Error(`Runtime exited before pairing: ${code}`));});
    runtime.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = /Pairing token \(expires in 5 minutes; one use\): (\S+)/.exec(output);
      if (match) {clearTimeout(timeout); resolve(match[1]);}
    });
  });
  console.log('Testing the pinned source runtime with a fresh, isolated journal.');
  runner = spawn('pnpm', ['exec', 'playwright', 'test', 'service-journey.spec.ts'], {
    cwd: root, stdio: 'inherit', env: {...process.env, LAB_TEST_PAIRING_TOKEN: token}
  });
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', code => resolve(code ?? 1));
  });
} finally {
  stop();
  await runtimeClosed;
  await rm(directory, {recursive: true, force: true});
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
