import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (/^c:/i.test(root)) throw new Error('Artifacts must stay outside C:');
const scratch = path.join(root, 'test-data', 'model-browser');
mkdirSync(path.join(scratch, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(scratch, 'tmp');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let replyMode = 'ok';
const captured = [];
const provider = http.createServer(async (req, res) => {
 const chunks = [];
 for await (const chunk of req) chunks.push(chunk);
 const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const input = JSON.parse(payload.messages.at(-1).content);
 captured.push({ payload, input });
 const plan = replyMode === 'invalid' ? { inventedBiography: 'not accepted' }
  : input.purpose === 'agent'
   ? { interestIndices: [0], traitIndices: [0], summaryTemplate: 'interests_goal', chatStyle: 'slow' }
   : { roundTopics: ['interests', 'preferences', 'boundaries'], commonInterestIndices: [0], compatibilityTemplate: 'pace', differenceTemplate: 'boundaries', topicInterestIndices: [0] };
 res.writeHead(200, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
});
await listen(provider);
const app = createApp({ dbPath: ':memory:', demoMode: true, aiMode: 'model', modelApiUrl: `http://127.0.0.1:${provider.address().port}/chat/completions`, modelApiKey: 'mock-key-not-a-real-credential', modelName: 'local-test-model' });
await listen(app);
const base = `http://127.0.0.1:${app.address().port}`;
let context;
const results = [];
try {
 context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), { headless: true, reducedMotion: 'reduce', executablePath: process.env.BROWSER_EXECUTABLE || undefined, viewport: { width: 1440, height: 1040 }, args: ['--disable-crash-reporter', '--disable-breakpad'], env: { ...process.env } });
 const page = await context.newPage(); const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(base);
 await page.getByRole('heading', { name: '让相遇，慢慢发生。' }).waitFor();
 await page.locator('[data-ai-mode="rules"]').first().waitFor();
 const config = await page.evaluate(async () => (await fetch('/api/config')).json());
 assert.equal(config.aiMode, 'model');
 assert.equal(captured.length, 0);
 results.push('Model configuration does not relabel existing rule-generated Agent');
 await page.locator('.nav a[href="#profile"]').click();
 await page.getByRole('link', { name: '编辑我的 Agent' }).click();
 await page.locator('[data-avatar-key="cat"]').click();
 const privateBio = '仅在本机保存的原始简介 PRIVATE-BIO-LOCAL-ONLY';
 await page.locator('[name="bio"]').fill(privateBio);
 await page.locator('#agent-form button[type="submit"]').click();
 await page.getByRole('heading', { name: '让相遇，慢慢发生。' }).waitFor();
 await page.locator('[data-ai-mode="model"]').first().waitFor();
 assert.equal(captured.length, 1);
 assert.equal(captured[0].input.purpose, 'agent');
 const me = await page.evaluate(async () => {
  const { token } = JSON.parse(sessionStorage.getItem('i-island-session'));
  return (await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })).json();
 });
 assert.equal(me.agent.aiMode, 'model');
 assert.equal(me.profile.avatarKey, 'cat');
 results.push('Agent form reaches model adapter and persists selected avatar');
 await page.locator('[data-action="start-match"]').first().click();
 await page.locator('#match-consent').check();
 await page.locator('[data-action="confirm-match"]').click();
 await page.locator('.transcript').waitFor();
 assert.equal(await page.locator('.agent-message').count(), 6);
 await page.locator('[data-ai-mode="model"]').first().waitFor();
 assert.equal(captured.length, 2);
 assert.equal(captured[1].input.purpose, 'match');
 await page.getByRole('link', { name: '看看这次的缘分报告' }).click();
 await page.locator('[data-ai-mode="model"]').first().waitFor();
 for (const request of captured) {
  assert.equal(request.payload.model, 'local-test-model');
  for (const profile of request.input.profiles) {
   assert.ok(Object.keys(profile).every(key => ['interests', 'traits', 'friendshipGoal', 'boundaries'].includes(key)));
  }
  assert.ok(!JSON.stringify(request.input).includes(privateBio));
 }
 results.push('Model-generated three-round report uses only selected authorized fields');
 await page.locator('.nav a[href="#profile"]').click();
 await page.getByRole('link', { name: '编辑我的 Agent' }).click();
 replyMode = 'invalid';
 const unsavedBio = '模型异常时应保留的草稿';
 await page.locator('[name="bio"]').fill(unsavedBio);
 const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/me') && response.request().method() === 'PUT');
 await page.locator('#agent-form button[type="submit"]').click();
 const invalid = await responsePromise;
 assert.ok(invalid.status() >= 500);
 await page.locator('.toast.show').waitFor();
 assert.equal(await page.locator('[name="bio"]').inputValue(), unsavedBio);
 assert.equal(await page.locator('#agent-form').count(), 1);
 const afterFailure = await page.evaluate(async () => {
  const { token } = JSON.parse(sessionStorage.getItem('i-island-session'));
  return (await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })).json();
 });
 assert.equal(afterFailure.profile.bio, privateBio);
 assert.equal(afterFailure.agent.aiMode, 'model');
 results.push('Rejected model output keeps unsaved form and never falls back to rules');
 assert.ok(!JSON.stringify(config).includes('mock-key'));
 assert.deepEqual(errors, []);
 results.push('Browser receives no model credential and no uncaught exceptions');
 const summary = { provider: 'local mock, no external request', passed: results.length, results, errors, checkedAt: new Date().toISOString() };
 writeFileSync(path.join(root, 'docs', 'model-browser-check.json'), JSON.stringify(summary, null, 2));
 console.log(JSON.stringify(summary, null, 2));
} finally {
 if (context) await context.close();
 await Promise.all([new Promise(resolve => app.close(resolve)), new Promise(resolve => provider.close(resolve))]);
 rmSync(scratch, { recursive: true, force: true });
}
