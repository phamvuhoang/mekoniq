const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const workspace = process.env.MEKONIQ_WORKSPACE || path.resolve(__dirname, '../../../../..');
const source = path.join(workspace, 'source');
const lab = path.join(workspace, 'lab');
const req = createRequire(path.join(source, 'package.json'));
const { chromium, expect } = req('@playwright/test');
const output = process.env.GUIDE_SCREENSHOTS_DIR;
const sourceRevision = process.env.GUIDE_SOURCE_REVISION;
const labRevision = process.env.GUIDE_LAB_REVISION;
const runtimePin = JSON.parse(fs.readFileSync(process.env.GUIDE_RUNTIME_PIN_FILE || path.join(lab, 'config/source-runtime.lock.json'), 'utf8'));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('NODE_24_REQUIRED');
if (!output || !path.isAbsolute(output)) throw new Error('ABSOLUTE_GUIDE_SCREENSHOTS_DIR_REQUIRED');
for (const v of [sourceRevision, labRevision]) if (!/^[a-f0-9]{40}$/.test(v || '')) throw new Error('FULL_REPOSITORY_REVISIONS_REQUIRED');
fs.mkdirSync(output, { recursive: true });

async function launch() {
  return chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
}
async function capture(page, manifest, { id, title, repo, environment, scope, locator, runtimePin: shotRuntimePin = null }) {
  if (shotRuntimePin !== null && !/^[a-f0-9]{40}$/.test(shotRuntimePin)) throw new Error('SHOT_RUNTIME_PIN_MUST_BE_COMMIT_OR_NULL');
  // Capture no filled credential inputs and no pairing form, including password bullets.
  if (await page.locator('#twin-pair-token').count()) throw new Error('PAIRING_FORM_MUST_BE_GONE_BEFORE_CAPTURE');
  const hasSecrets = await page.locator('input[type=password]').evaluateAll(inputs => inputs.some(input => input.value));
  if (hasSecrets) throw new Error('FILLED_PASSWORD_INPUT_CAPTURE_REFUSED');
  const url = new URL(page.url());
  if (url.username || url.password || /token|secret|password|key/i.test(url.search)) throw new Error('SENSITIVE_URL_CAPTURE_REFUSED');
  await page.evaluate(async () => { await document.fonts.ready; });
  const filename = id + '.png';
  const capturedAt = new Date().toISOString();
  const bytes = await (locator || page).screenshot({ path: path.join(output, filename), ...(locator ? {} : { fullPage: true }), animations: 'disabled' });
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error('PNG_REQUIRED');
  manifest.push({ id, title, file: 'screenshots/' + filename, repo, environment, url: page.url(), capturedAt,
    revision: repo === 'source' ? sourceRevision : labRevision, runtimePin: shotRuntimePin, scope,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
  console.log('Captured ' + id);
}
function saveManifest(name, manifest) {
  fs.writeFileSync(path.join(output, 'capture-' + name + '.json'), JSON.stringify(manifest, null, 2) + '\n');
}
module.exports = { workspace, source, lab, req, expect, output, sourceRevision, labRevision, runtimePin, launch, capture, saveManifest };
