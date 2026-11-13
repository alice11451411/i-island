import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { createModel } from '../server/ai.mjs';

const profile = { nickname: '保密昵称', ageRange: '18-24', city: '杭州', mbti: 'INFP', interests: ['音乐', '游戏'], traits: ['慢热'], friendshipGoal: '分享日常', boundaries: '不催回复', bio: '不应发送给模型的原始介绍', adultConfirmed: true, authorizedFields: ['interests', 'traits', 'friendshipGoal', 'boundaries'] };
const agentPlan = { interestIndices: [0], traitIndices: [0], summaryTemplate: 'interests_goal', chatStyle: 'slow' };
const matchPlan = { roundTopics: ['interests', 'preferences', 'boundaries'], commonInterestIndices: [0], compatibilityTemplate: 'pace', differenceTemplate: 'boundaries', topicInterestIndices: [0] };

async function provider(t) {
  const requests = [];
  let nextGate;
  const service = { requests, response: null, status: 200, reviewResponse: null, reviewStatus: 200 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const input = JSON.parse(request.messages.find(message => message.role === 'user').content);
    requests.push({ request, input, authorization: req.headers.authorization });
    if (service.largeReview && input.purpose.endsWith('-review')) { res.writeHead(200, { 'content-type': 'application/json' }); res.write(' '.repeat(32768)); res.end(' '.repeat(32769)); return; }
    if (service.redirect) { res.writeHead(302, { location: service.redirect }); res.end(); return; }
    if (nextGate?.purpose === input.purpose) { const gate = nextGate; nextGate = null; gate.start(); await gate.wait; }
    const value = input.purpose.endsWith('-review')
      ? service.reviewResponse || { decision: 'pass', codes: [] }
      : service.response || (input.purpose === 'agent' ? { ...agentPlan, interestIndices: input.profiles[0].interests?.length ? [0] : [], traitIndices: input.profiles[0].traits?.length ? [0] : [], summaryTemplate: input.profiles[0].interests?.length ? input.profiles[0].friendshipGoal ? 'interests_goal' : 'interests' : input.profiles[0].friendshipGoal ? 'goal' : 'minimal' } : matchPlan);
    res.writeHead(input.purpose.endsWith('-review') ? service.reviewStatus : service.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  service.holdNext = purpose => { let start, release; const started = new Promise(resolve => { start = resolve; }); const wait = new Promise(resolve => { release = resolve; }); nextGate = { purpose, start, wait }; return { started, release }; };
  service.options = { aiMode: 'model', modelApiUrl: `http://127.0.0.1:${server.address().port}/chat/completions`, modelApiKey: 'mock-key-not-real', modelName: 'test-model', reviewModelName: 'small-review-model' };
  service.options.reviewModelApiUrl = service.options.modelApiUrl;
  service.options.reviewModelApiKey = 'mock-review-key-not-real';
  return service;
}

async function fixture(t, options = {}, disk = false) {
  let dbPath = ':memory:';
  let dir;
  if (disk) { const root = new URL('../test-data/', import.meta.url); await mkdir(root, { recursive: true }); dir = await mkdtemp(fileURLToPath(new URL('ai-', root))); dbPath = `${dir}/test.sqlite`; }
  const app = createApp({ dbPath, demoMode: true, ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); });
  const api = async (path, { token, method = 'GET', body } = {}) => { const response = await fetch(`http://127.0.0.1:${app.address().port}` + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const session = async persona => (await api('/api/demo/session', { method: 'POST', body: { persona } })).body;
  const a = await session('lin'), b = await session('momo');
  const save = (token, body) => api('/api/me', { token, method: 'PUT', body });
  const enable = token => api('/api/me/matching', { token, method: 'POST', body: { enabled: true } });
  const start = token => api('/api/matches', { token, method: 'POST', body: {} });
  return { api, session, a, b, save, enable, start, app, dbPath };
}

test('avatar selection validates its enum and is public on a match', async t => {
  const { save, enable, start, a } = await fixture(t);
  assert.equal((await save(a.token, { ...profile, avatarKey: 'unknown' })).status, 400);
  for (const avatarKey of ['sprout', 'cloud', 'mushroom', 'moon', 'cat', 'orange']) assert.equal((await save(a.token, { ...profile, avatarKey })).body.profile.avatarKey, avatarKey);
  await enable(a.token);
  assert.equal((await start(a.token)).body.match.other.avatarKey, 'sprout');
});

test('same-city preference requires a boolean and authorized nonempty city', async t => {
  const { save, a } = await fixture(t);
  assert.equal((await save(a.token, { ...profile, sameCityOnly: 'true' })).status, 400);
  assert.equal((await save(a.token, { ...profile, sameCityOnly: true })).status, 400);
  assert.equal((await save(a.token, { ...profile, city: '', sameCityOnly: true, authorizedFields: [...profile.authorizedFields, 'city'] })).status, 400);
  assert.equal((await save(a.token, { ...profile, sameCityOnly: true, authorizedFields: [...profile.authorizedFields, 'city'] })).status, 200);
});

for (const side of ['self', 'other']) test(`same-city preference is a hard filter when required by ${side}`, async t => {
  const { save, enable, start, a, b } = await fixture(t);
  const otherProfile = { ...b.user.profile, city: '上海', authorizedFields: [...b.user.consent.authorizedFields, 'city'], sameCityOnly: side === 'other' };
  const ownProfile = { ...a.user.profile, city: '杭州', authorizedFields: [...a.user.consent.authorizedFields, 'city'], sameCityOnly: side === 'self' };
  await save(a.token, ownProfile); await save(b.token, otherProfile); await enable(a.token); await enable(b.token);
  assert.equal((await start(a.token)).status, 404);
});

test('changing hard preferences closes old matches and pauses matching', async t => {
  const { start, save, api, a } = await fixture(t);
  const match = (await start(a.token)).body.match;
  const changed = await save(a.token, { sameCityOnly: true, authorizedFields: [...a.user.consent.authorizedFields, 'city'] });
  assert.equal(changed.body.matchingEnabled, false);
  assert.equal((await api(`/api/matches/${match.id}`, { token: a.token })).body.match.status, 'closed');
});

test('model mode renders bounded plans and sends only authorized facts', async t => {
  const model = await provider(t);
  const { api, save, enable, start, a } = await fixture(t, model.options);
  const saved = await save(a.token, profile);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.agent.aiMode, 'model');
  assert.ok(saved.body.agent.summary.includes('音乐'));
  assert.doesNotMatch(saved.body.agent.summary, /游戏/);
  await enable(a.token);
  const result = await start(a.token);
  assert.equal(result.status, 201);
  assert.equal(result.body.match.aiMode, 'model');
  assert.equal(result.body.match.transcript.length, 6);
  assert.deepEqual(result.body.match.transcript.map(item => item.round), [1, 1, 2, 2, 3, 3]);
  assert.equal((await api('/api/config')).body.aiMode, 'model');
  assert.equal(model.requests.length, 4);
  assert.equal(model.requests[0].authorization, 'Bearer mock-key-not-real');
  assert.equal(model.requests[0].request.model, 'test-model');
  assert.doesNotMatch(JSON.stringify(model.requests.map(item => item.input)), /保密昵称|原始介绍|杭州|INFP|ageRange|bio|avatarKey/);
  assert.deepEqual(Object.keys(model.requests[0].input.profiles[0]).sort(), profile.authorizedFields.toSorted());
  const review = model.requests.find(item => item.input.purpose === 'match-review');
  assert.equal(review.authorization, 'Bearer mock-review-key-not-real');
  assert.equal(review.request.model, 'small-review-model');
  assert.deepEqual(Object.keys(review.input.profiles[0]).sort(), profile.authorizedFields.toSorted());
  assert.deepEqual(Object.keys(review.input.profiles[1]).sort(), profile.authorizedFields.toSorted());
  assert.equal(review.input.candidate.transcript.length, 6);
  assert.doesNotMatch(JSON.stringify(review.input), /demo-lin|demo-momo|保密昵称|原始介绍|杭州|INFP|ageRange|bio|avatarKey/);
});

test('reviewer rejection or malformed verdict never stores a match', async t => {
  const model = await provider(t);
  model.reviewResponse = { decision: 'reject', codes: ['unsupported_claim'] };
  const { start, api, a } = await fixture(t, model.options);
  const rejected = await start(a.token);
  assert.equal(rejected.status, 502);
  assert.equal(rejected.body.error.code, 'MODEL_REVIEW_REJECTED');
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);

  model.reviewResponse = { decision: 'pass', codes: ['unauthorized_fact'] };
  const malformed = await start(a.token);
  assert.equal(malformed.status, 502);
  assert.equal(malformed.body.error.code, 'MODEL_REVIEW_UNAVAILABLE');
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

test('reviewer provider failure prevents saving a match', async t => {
  const model = await provider(t);
  model.reviewStatus = 503;
  const { start, api, a } = await fixture(t, model.options);
  const result = await start(a.token);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'MODEL_REVIEW_UNAVAILABLE');
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

test('agent reviewer receives only authorized facts and rejection does not save a profile', async t => {
  const model = await provider(t);
  model.reviewResponse = { decision: 'reject', codes: ['unsupported_claim'] };
  const { save, api, a } = await fixture(t, model.options);
  const originalAgent = (await api('/api/me', { token: a.token })).body.agent;
  const result = await save(a.token, profile);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'MODEL_REVIEW_REJECTED');
  assert.doesNotMatch(result.body.error.message, /匹配/);
  assert.deepEqual((await api('/api/me', { token: a.token })).body.agent, originalAgent);
  model.reviewStatus = 503;
  const unavailable = await save(a.token, profile);
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.body.error.code, 'MODEL_REVIEW_UNAVAILABLE');
  assert.deepEqual((await api('/api/me', { token: a.token })).body.agent, originalAgent);
  const review = model.requests.find(item => item.input.purpose === 'agent-review');
  assert.ok(review);
  assert.deepEqual(Object.keys(review.input.profiles[0]).sort(), profile.authorizedFields.toSorted());
  assert.doesNotMatch(JSON.stringify(review.input), /保密昵称|原始介绍|杭州|INFP|ageRange|bio|avatarKey/);
  assert.deepEqual(Object.keys(review.input.candidate).sort(), ['chatStyle', 'summary', 'tags']);
});

test('consent revoked during main generation prevents sending stale data to reviewer', async t => {
  const model = await provider(t);
  const { start, save, a, b } = await fixture(t, model.options);
  const gate = model.holdNext('match');
  const pending = start(a.token);
  await gate.started;
  await save(b.token, { ...profile, authorizedFields: ['interests', 'friendshipGoal', 'boundaries'] });
  gate.release();
  assert.equal((await pending).status, 409);
  assert.equal(model.requests.filter(item => item.input.purpose === 'match-review').length, 0);
});

test('state changes while reviewer is running prevent saving stale output', async t => {
  const model = await provider(t);
  const { start, api, a, b } = await fixture(t, model.options);
  const gate = model.holdNext('match-review');
  const pending = start(a.token);
  await gate.started;
  await api('/api/me/matching', { token: b.token, method: 'POST', body: { enabled: false } });
  gate.release();
  assert.equal((await pending).status, 409);
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

for (const malicious of [ { ...agentPlan, interestIndices: [999] }, { ...agentPlan, biography: '凭空捏造的人生' } ]) test('model output cannot introduce unknown facts or arbitrary text', async t => {
  const model = await provider(t); model.response = malicious;
  const { save, api, a } = await fixture(t, model.options);
  const result = await save(a.token, profile);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'MODEL_INVALID_RESPONSE');
  assert.equal((await api('/api/me', { token: a.token })).body.profile.nickname, '小林');
});

test('model output cannot request extra conversation rounds', async t => {
  const model = await provider(t); model.response = { ...matchPlan, roundTopics: ['interests', 'preferences', 'boundaries', 'interests'] };
  const { start, a } = await fixture(t, model.options);
  assert.equal((await start(a.token)).status, 502);
});

test('provider failures never fall back to rules', async t => {
  const model = await provider(t); model.status = 500;
  const { start, api, a } = await fixture(t, model.options);
  assert.equal((await start(a.token)).status, 502);
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

test('explicit model mode requires all provider configuration', async t => {
  const { start, a } = await fixture(t, { aiMode: 'model', modelApiUrl: '', modelApiKey: '', modelName: '' });
  assert.equal((await start(a.token)).status, 503);
});

test('model generation requires a reviewer before sending any profile data', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network trap: reviewer configuration must be checked first'); };
  try {
    const model = createModel({ aiMode: 'model', modelApiUrl: 'https://model.example.invalid/chat/completions', modelApiKey: 'fake-test-key', modelName: 'test-model', reviewModelName: '' });
    await assert.rejects(model.agent({ interests: ['音乐'] }), cause => cause.status === 503 && cause.code === 'MODEL_REVIEW_UNAVAILABLE');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('reviewer rejects oversized streamed responses within the byte limit', async t => {
  const service = await provider(t);
  service.largeReview = true;
  const model = createModel(service.options);
  await model.agent(profile);
  await assert.rejects(model.reviewAgent([profile], { summary: '喜欢音乐' }), cause => cause.status === 502 && cause.code === 'MODEL_REVIEW_UNAVAILABLE');
  assert.equal(service.requests.filter(item => item.input.purpose.endsWith('-review')).length, 1);
});

test('rules mode completes profile and match flows without model requests', async t => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('model.example.invalid')) { calls++; throw new Error('network trap: rules mode must stay offline'); }
    return originalFetch(url, options);
  };
  try {
    const { save, enable, start, a } = await fixture(t, { aiMode: 'rules', modelApiUrl: 'https://model.example.invalid/chat/completions', modelApiKey: 'fake-test-key', modelName: 'test-model', reviewModelName: 'test-review-model' });
    assert.equal((await save(a.token, profile)).status, 200);
    assert.equal((await enable(a.token)).status, 200);
    assert.equal((await start(a.token)).status, 201);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

for (const change of ['revoke', 'delete', 'pause']) test(`model exchange cannot commit after concurrent ${change}`, async t => {
  const model = await provider(t);
  const { start, api, save, a, b } = await fixture(t, model.options);
  const gate = model.holdNext('match');
  const pending = start(a.token);
  await Promise.race([gate.started, pending.then(() => { throw new Error('Model provider was not invoked'); })]);
  if (change === 'revoke') await save(b.token, { ...b.user.profile, authorizedFields: ['interests', 'friendshipGoal', 'boundaries'] });
  if (change === 'delete') await api('/api/me', { token: b.token, method: 'DELETE' });
  if (change === 'pause') await api('/api/me/matching', { token: b.token, method: 'POST', body: { enabled: false } });
  gate.release();
  assert.equal((await pending).status, 409);
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

for (const change of ['pause', 'delete']) test(`model profile cannot overwrite concurrent ${change}`, async t => {
  const model = await provider(t);
  const { save, api, a } = await fixture(t, model.options);
  const gate = model.holdNext('agent');
  const pending = save(a.token, profile);
  await Promise.race([gate.started, pending.then(() => { throw new Error('Model provider was not invoked'); })]);
  if (change === 'pause') await api('/api/me/matching', { token: a.token, method: 'POST', body: { enabled: false } });
  else await api('/api/me', { token: a.token, method: 'DELETE' });
  gate.release();
  assert.equal((await pending).status, change === 'delete' ? 401 : 409);
});

test('onboarding and first mutual connection events are idempotent', async t => {
  const { start, api, session, a, b, dbPath } = await fixture(t, {}, true);
  await session('lin'); await session('momo');
  const match = (await start(a.token)).body.match;
  const path = `/api/matches/${match.id}/decision`;
  await api(path, { token: a.token, method: 'POST', body: { decision: 'accept' } });
  const connected = (await api(path, { token: b.token, method: 'POST', body: { decision: 'accept' } })).body.match;
  assert.ok(connected.connectedAt);
  const again = (await api(path, { token: a.token, method: 'POST', body: { decision: 'accept' } })).body.match;
  assert.equal(again.connectedAt, connected.connectedAt);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE event='onboarding_started'").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE event='mutual_connected'").get().n, 1);
  db.close();
});


for (const action of ['close', 'block']) test(`model exchange cannot overwrite a concurrent ${action} on its previous pair`, async t => {
  const model = await provider(t);
  const { start, save, enable, api, a, b } = await fixture(t, model.options);
  const previous = (await start(a.token)).body.match;
  await save(a.token, { traits: ['慢热', '话少'] }); await enable(a.token);
  const gate = model.holdNext('match');
  const pending = start(a.token);
  await Promise.race([gate.started, pending.then(() => { throw new Error('Model provider was not invoked'); })]);
  await api(`/api/matches/${previous.id}/${action}`, { token: b.token, method: 'POST', body: {} });
  gate.release();
  assert.equal((await pending).status, 409);
  assert.equal((await api('/api/matches', { token: a.token })).body.matches.length, 1);
});

test('model profile save cannot overwrite a concurrent end to a match', async t => {
  const model = await provider(t);
  const { start, save, api, a, b } = await fixture(t, model.options);
  const match = (await start(a.token)).body.match;
  const gate = model.holdNext('agent');
  const pending = save(a.token, { traits: ['慢热', '话少'] });
  await Promise.race([gate.started, pending.then(() => { throw new Error('Model provider was not invoked'); })]);
  await api(`/api/matches/${match.id}/close`, { token: b.token, method: 'POST', body: {} });
  gate.release();
  assert.equal((await pending).status, 409);
});

test('later profile changes do not undo an explicit unmatch', async t => {
  const { start, save, enable, api, a, b } = await fixture(t);
  const match = (await start(a.token)).body.match;
  await api(`/api/matches/${match.id}/close`, { token: b.token, method: 'POST', body: {} });
  await save(a.token, { traits: ['慢热', '话少'] }); await enable(a.token);
  assert.equal((await start(a.token)).status, 404);
});

test('old records retain rules mode when current configuration uses a model', async t => {
  const model = await provider(t);
  const { start, api, a, dbPath } = await fixture(t, model.options, true);
  const match = (await start(a.token)).body.match;
  const db = new DatabaseSync(dbPath);
  const data = JSON.parse(db.prepare('SELECT data FROM matches WHERE id=?').get(match.id).data);
  delete data.aiMode;
  db.prepare('UPDATE matches SET data=? WHERE id=?').run(JSON.stringify(data), match.id);
  db.close();
  assert.equal((await api('/api/config')).body.aiMode, 'model');
  assert.equal((await api(`/api/matches/${match.id}`, { token: a.token })).body.match.aiMode, 'rules');
  assert.equal((await api('/api/me', { token: a.token })).body.agent.aiMode, 'rules');
});

test('a timed out model call errors without saving a fallback match', async t => {
  const model = await provider(t);
  const { start, api, a } = await fixture(t, { ...model.options, modelTimeoutMs: 25 });
  const gate = model.holdNext('match');
  const pending = start(a.token);
  await Promise.race([gate.started, pending.then(() => { throw new Error('Model provider was not invoked'); })]);
  const result = await pending;
  gate.release();
  assert.equal(result.status, 504);
  assert.equal(result.body.error.code, 'MODEL_TIMEOUT');
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});

test('model configuration rejects remote HTTP and URL userinfo before any network call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network trap: no external request is allowed'); };
  try {
    for (const modelApiUrl of ['http://model.example.invalid/chat/completions', 'http://localhost.example.invalid/chat/completions', 'http://127.0.0.2/chat/completions', 'https://name:password@model.example.invalid/chat/completions', 'http://name:password@localhost/chat/completions']) {
      const model = createModel({ aiMode: 'model', modelApiUrl, modelApiKey: 'fake-test-key', modelName: 'test-model', reviewModelName: 'test-review-model' });
      await assert.rejects(model.agent({ interests: ['音乐'], traits: ['慢热'], friendshipGoal: '分享日常' }), cause => cause.status === 503 && cause.code === 'MODEL_NOT_CONFIGURED');
      assert.equal(calls, 0, modelApiUrl);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('model transport allows HTTP only for the supported local mock hosts', async () => {
  const originalFetch = globalThis.fetch;
  const destinations = [];
  globalThis.fetch = async (url, options) => {
    destinations.push(String(url));
    const request = JSON.parse(options.body);
    const value = request.model === 'test-review-model' ? { decision: 'pass', codes: [] } : agentPlan;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
  };
  try {
    for (const modelApiUrl of ['http://127.0.0.1/chat/completions', 'http://localhost/chat/completions', 'http://[::1]/chat/completions', 'https://model.example.invalid/chat/completions']) {
      const model = createModel({ aiMode: 'model', modelApiUrl, modelApiKey: 'fake-test-key', modelName: 'test-model', reviewModelName: 'test-review-model' });
      await model.agent({ interests: ['音乐'], traits: ['慢热'], friendshipGoal: '分享日常' });
      await model.reviewAgent([{ interests: ['音乐'] }], { summary: '喜欢音乐' });
    }
    assert.equal(destinations.length, 8);
  } finally { globalThis.fetch = originalFetch; }
});

test('model redirects fail without contacting their second destination', async t => {
  let redirectedRequests = 0;
  const target = http.createServer((req, res) => {
    redirectedRequests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(matchPlan) } }] }));
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  t.after(() => new Promise(resolve => target.close(resolve)));
  const model = await provider(t);
  model.redirect = `http://127.0.0.1:${target.address().port}/redirect-target`;
  const { start, api, a } = await fixture(t, model.options);
  const result = await start(a.token);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'MODEL_UNAVAILABLE');
  assert.equal(model.requests.length, 1);
  assert.equal(redirectedRequests, 0);
  assert.deepEqual((await api('/api/matches', { token: a.token })).body.matches, []);
});
