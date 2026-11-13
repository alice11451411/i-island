import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const testRoot = new URL('../test-data/', import.meta.url);
let createApp;
try { ({ createApp } = await import('../server/app.mjs')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

async function fixture(t, options = {}) {
  assert.equal(typeof createApp, 'function', 'createApp must implement the API');
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('case-', testRoot)));
  const app = createApp({ dbPath: `${dir}/test.sqlite`, demoMode: true, ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const api = async (path, { token, method = 'GET', body } = {}) => {
    const response = await fetch(origin + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const session = async persona => (await api('/api/demo/session', { method: 'POST', body: { persona } })).body;
  return { api, session, app, dbPath: `${dir}/test.sqlite` };
}

const profile = { nickname: '小林', ageRange: '18-24', city: '杭州', mbti: 'INFP', interests: ['游戏', '音乐'], traits: ['慢热'], friendshipGoal: '寻找一起打游戏的朋友', boundaries: '不催回复', bio: '原始自我介绍不得分享', adultConfirmed: true, authorizedFields: ['interests', 'traits', 'friendshipGoal', 'boundaries'] };

async function pair(t) {
  const f = await fixture(t);
  const a = await f.session('lin');
  const b = await f.session('momo');
  const result = await f.api('/api/matches', { token: a.token, method: 'POST', body: {} });
  assert.equal(result.status, 201);
  return { ...f, a, b, match: result.body.match };
}

test('private endpoints require a valid server session', async t => {
  const { api } = await fixture(t);
  assert.equal((await api('/api/me')).status, 401);
  assert.equal((await api('/api/me', { token: 'user-lin' })).status, 401);
});

test('adult confirmation and safe field consent are enforced', async t => {
  const { api, session } = await fixture(t);
  const a = await session('new');
  assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, adultConfirmed: false } })).status, 400);
  assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, authorizedFields: ['interests', 'bio'] } })).status, 400);
  assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, authorizedFields: ['interests'] } })).status, 400);
  assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: profile })).status, 200);
});

test('matching uses only authorized facts and caps conversation at three rounds', async t => {
  const { api, session } = await fixture(t);
  const a = await session('lin');
  await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, city: '不得泄露的城市', mbti: '秘密人格', bio: '秘密人生故事' } });
  await api('/api/me/matching', { token: a.token, method: 'POST', body: { enabled: true } });
  const result = await api('/api/matches', { token: a.token, method: 'POST', body: {} });
  assert.equal(result.status, 201);
  const match = result.body.match;
  assert.equal(match.transcript.length, 6);
  assert.deepEqual(match.transcript.map(item => item.speaker), ['self', 'other', 'self', 'other', 'self', 'other']);
  assert.equal(Math.max(...match.transcript.map(item => item.round)), 3);
  assert.doesNotMatch(JSON.stringify(match), /不得泄露|秘密人格|秘密人生/);
  assert.equal(match.aiMode, 'rules');
});

test('both humans must accept before reading or sending real messages', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  assert.equal((await api(`${path}/messages`, { token: a.token })).status, 403);
  assert.equal((await api(`${path}/decision`, { token: a.token, method: 'POST', body: { decision: 'accept' } })).body.match.status, 'waiting');
  assert.equal((await api(`${path}/messages`, { token: a.token, method: 'POST', body: { text: '你好' } })).status, 403);
  assert.equal((await api(`${path}/decision`, { token: b.token, method: 'POST', body: { decision: 'accept' } })).body.match.status, 'connected');
  const sent = await api(`${path}/messages`, { token: a.token, method: 'POST', body: { text: '你最近听什么歌？' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.mine, true);
  const received = await api(`${path}/messages`, { token: b.token });
  assert.equal(received.body.messages.length, 1);
  assert.equal(received.body.messages[0].mine, false);
});

test('connected matches cannot be changed back to declined', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  assert.equal((await api(`${path}/decision`, { token: a.token, method: 'POST', body: { decision: 'decline' } })).status, 409);
  assert.equal((await api(path, { token: b.token })).body.match.status, 'connected');
  assert.equal((await api(`${path}/messages`, { token: a.token, method: 'POST', body: { text: '你好' } })).status, 201);
});

test('third parties cannot access another pair or act for another identity', async t => {
  const { api, session, match } = await pair(t);
  const outsider = await session('new');
  assert.equal((await api(`/api/matches/${match.id}`, { token: outsider.token })).status, 404);
  assert.equal((await api(`/api/matches/${match.id}/decision`, { token: outsider.token, method: 'POST', body: { decision: 'accept' } })).status, 404);
});

test('declining is terminal and no chat opens', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  assert.equal((await api(`${path}/decision`, { token: a.token, method: 'POST', body: { decision: 'decline' } })).body.match.status, 'declined');
  assert.equal((await api(`${path}/decision`, { token: b.token, method: 'POST', body: { decision: 'accept' } })).status, 409);
  assert.equal((await api(`${path}/messages`, { token: b.token })).status, 403);
});

test('blocking closes chat and excludes future matching', async t => {
  const { api, a, b, match, dbPath } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  await api(`${path}/messages`, { token: a.token, method: 'POST', body: { text: '拉黑后不应保留的内容' } });
  assert.equal((await api(`${path}/block`, { token: a.token, method: 'POST', body: {} })).status, 200);
  for (const token of [a.token, b.token]) {
    const hidden = (await api(path, { token })).body.match;
    assert.deepEqual(hidden.transcript, []);
    assert.deepEqual(hidden.report.commonInterests, []);
    assert.match(hidden.report.compatibility, /已关闭/);
    assert.equal((await api(`${path}/messages`, { token })).status, 403);
  }
  const db = new DatabaseSync(dbPath);
  const stored = JSON.parse(db.prepare('SELECT data FROM matches WHERE id=?').get(match.id).data);
  stored.transcript = [{ speakerId: 'demo-lin', text: '旧版本残留内容', round: 1 }];
  stored.report.commonInterests = ['旧版本残留兴趣'];
  db.prepare('UPDATE matches SET data=? WHERE id=?').run(JSON.stringify(stored), match.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE match_id=?').get(match.id).n, 0);
  db.close();
  const legacy = (await api(path, { token: a.token })).body.match;
  assert.deepEqual(legacy.transcript, []);
  assert.deepEqual(legacy.report.commonInterests, []);
  assert.equal((await api(`${path}/messages`, { token: b.token, method: 'POST', body: { text: '你好' } })).status, 403);
  assert.equal((await api('/api/matches', { token: b.token, method: 'POST', body: {} })).status, 404);
});

test('revoked consent invalidates and erases previous simulation data', async t => {
  const { api, a, match } = await pair(t);
  const current = (await api('/api/me', { token: a.token })).body;
  const saved = await api('/api/me', { token: a.token, method: 'PUT', body: { ...current.profile, authorizedFields: ['interests', 'friendshipGoal', 'boundaries'] } });
  assert.equal(saved.status, 200);
  const previous = (await api(`/api/matches/${match.id}`, { token: a.token })).body.match;
  assert.equal(previous.status, 'closed');
  assert.deepEqual(previous.transcript, []);
  assert.deepEqual(previous.report.commonInterests, []);
});

test('reports are acknowledged and icebreakers never send a real message', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  assert.equal((await api(`${path}/report`, { token: a.token, method: 'POST', body: { reason: '骚扰' } })).body.reported, true);
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  assert.ok((await api(`${path}/icebreaker`, { token: a.token, method: 'POST', body: {} })).body.suggestions.length > 0);
  assert.equal((await api(`${path}/messages`, { token: a.token })).body.messages.length, 0);
});

test('account deletion invalidates session and removes the other side matching record', async t => {
  const { api, a, b } = await pair(t);
  assert.equal((await api('/api/me', { token: a.token, method: 'DELETE' })).body.deleted, true);
  assert.equal((await api('/api/me', { token: a.token })).status, 401);
  assert.deepEqual((await api('/api/matches', { token: b.token })).body.matches, []);
});

test('paused users do not match and repeated starts reuse active pair', async t => {
  const { api, a, b, match } = await pair(t);
  assert.equal((await api('/api/matches', { token: a.token, method: 'POST', body: {} })).body.match.id, match.id);
  await api('/api/me/matching', { token: b.token, method: 'POST', body: { enabled: false } });
  assert.equal((await api('/api/matches', { token: b.token, method: 'POST', body: {} })).status, 409);
});

test('real mode disables demo sessions and fails closed without WeChat credentials', async t => {
  const { api } = await fixture(t, { demoMode: false, wechatAppId: '', wechatSecret: '' });
  assert.equal((await api('/api/demo/session', { method: 'POST', body: { persona: 'lin' } })).status, 404);
  assert.equal((await api('/api/auth/wechat', { method: 'POST', body: { code: 'fake-code' } })).status, 503);
  assert.equal((await api('/api/config')).body.demoMode, false);
});

test('closed matches cannot send or accept again', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  assert.equal((await api(`${path}/close`, { token: a.token, method: 'POST', body: {} })).body.match.status, 'closed');
  assert.equal((await api(`${path}/messages`, { token: b.token, method: 'POST', body: { text: '继续聊天' } })).status, 403);
  assert.equal((await api(`${path}/decision`, { token: b.token, method: 'POST', body: { decision: 'accept' } })).status, 409);
});

test('empty or unsafe text cannot be sent and contacts stay private', async t => {
  const { api, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  for (const value of ['', '  ', '加我微信 abc', '13800138000', 'x'.repeat(1001)]) assert.equal((await api(`${path}/messages`, { token: a.token, method: 'POST', body: { text: value } })).status, 400);
  assert.equal((await api(`${path}/messages`, { token: a.token })).body.messages.length, 0);
});

test('SQLite preserves decisions and sessions when restarting the server', async t => {
  assert.equal(typeof createApp, 'function');
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('restart-', testRoot)));
  const dbPath = `${dir}/test.sqlite`;
  let app;
  const start = async demoMode => {
    app = createApp({ dbPath, demoMode });
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const origin = `http://127.0.0.1:${app.address().port}`;
    return async (url, token, body) => { const response = await fetch(origin + url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  };
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); });
  let api = await start(true);
  const a = (await api('/api/demo/session', null, { persona: 'lin' })).body;
  const match = (await api('/api/matches', a.token, {})).body.match;
  await api(`/api/matches/${match.id}/decision`, a.token, { decision: 'accept' });
  await new Promise(resolve => app.close(resolve));
  api = await start(true);
  assert.equal((await api(`/api/matches/${match.id}`, a.token)).body.match.selfDecision, 'accept');
  await new Promise(resolve => app.close(resolve));
  api = await start(false);
  assert.equal((await api('/api/me', a.token)).status, 401, 'a demo session must never authenticate in real mode');
});

test('editing authorized information permits a fresh consented simulation', async t => {
  const { api, a, match } = await pair(t);
  const current = (await api('/api/me', { token: a.token })).body;
  const saved = await api('/api/me', { token: a.token, method: 'PUT', body: { ...current.profile, traits: ['慢热', '话少'], authorizedFields: current.consent.authorizedFields } });
  assert.equal(saved.body.matchingEnabled, false);
  await api('/api/me/matching', { token: a.token, method: 'POST', body: { enabled: true } });
  const next = await api('/api/matches', { token: a.token, method: 'POST', body: {} });
  assert.equal(next.status, 201);
  assert.notEqual(next.body.match.id, match.id);
  assert.ok(next.body.match.transcript.some(item => item.text.includes('话少')));
});



async function delayedRequest(app, path, token, body, method = 'POST') {
  const payload = JSON.stringify(body);
  const seen = once(app, 'request');
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request({ hostname: '127.0.0.1', port: app.address().port, path, method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Delayed request timed out')));
  });
  request.flushHeaders();
  await seen;
  return { finish: () => { request.end(payload); return response; } };
}

test('an in-flight acceptance cannot restore consent-revoked simulation', async t => {
  const { api, app, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  const pending = await delayedRequest(app, `${path}/decision`, a.token, { decision: 'accept' });
  const current = (await api('/api/me', { token: b.token })).body;
  await api('/api/me', { token: b.token, method: 'PUT', body: { ...current.profile, authorizedFields: ['interests', 'friendshipGoal', 'boundaries'] } });
  const result = await pending.finish();
  assert.equal(result.status, 409);
  const previous = (await api(path, { token: a.token })).body.match;
  assert.equal(previous.status, 'closed');
  assert.deepEqual(previous.transcript, []);
});

for (const action of ['close', 'block']) test(`an in-flight message cannot bypass ${action}`, async t => {
  const { api, app, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  const pending = await delayedRequest(app, `${path}/messages`, a.token, { text: '这条延迟消息不应发送' });
  await api(`${path}/${action}`, { token: b.token, method: 'POST', body: {} });
  assert.equal((await pending.finish()).status, 403);
});

test('an in-flight profile save preserves a concurrent pause', async t => {
  const { api, app, a } = await pair(t);
  const pending = await delayedRequest(app, '/api/me', a.token, { bio: '只修改不分享的简介' }, 'PUT');
  await api('/api/me/matching', { token: a.token, method: 'POST', body: { enabled: false } });
  const result = await pending.finish();
  assert.equal(result.status, 200);
  assert.equal(result.body.matchingEnabled, false);
});

test('an in-flight matching toggle cannot restore concurrently revoked consent', async t => {
  const { api, app, a } = await pair(t);
  const pending = await delayedRequest(app, '/api/me/matching', a.token, { enabled: true });
  const current = (await api('/api/me', { token: a.token })).body;
  await api('/api/me', { token: a.token, method: 'PUT', body: { ...current.profile, boundaries: '', authorizedFields: [] } });
  assert.equal((await pending.finish()).status, 409);
  const after = (await api('/api/me', { token: a.token })).body;
  assert.deepEqual(after.consent.authorizedFields, []);
  assert.equal(after.matchingEnabled, false);
});

test('an in-flight profile save cannot recreate a deleted account', async t => {
  const { api, app, a } = await pair(t);
  const pending = await delayedRequest(app, '/api/me', a.token, { bio: '这次修改不应复活账号' }, 'PUT');
  await api('/api/me', { token: a.token, method: 'DELETE' });
  assert.equal((await pending.finish()).status, 401);
  assert.equal((await api('/api/me', { token: a.token })).status, 401);
});

test('age range accepts only the explicit adult choices', async t => {
  const { api, session } = await fixture(t);
  const a = await session('new');
  for (const ageRange of ['abc', '17-24', '18', '25-34', '', '999']) assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, ageRange } })).status, 400, ageRange);
  for (const ageRange of ['18-24', '25-30', '31-40', '41+']) assert.equal((await api('/api/me', { token: a.token, method: 'PUT', body: { ...profile, ageRange } })).status, 200, ageRange);
});

test('matching excludes candidates with invalid consent even when marked enabled', async t => {
  const { api, session, dbPath } = await fixture(t);
  const a = await session('lin');
  const b = await session('momo');
  const db = new DatabaseSync(dbPath);
  const stored = JSON.parse(db.prepare('SELECT data FROM users WHERE id=?').get(b.user.id).data);
  stored.consent.authorizedFields = ['interests'];
  db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(stored), b.user.id);
  db.close();
  assert.equal((await api('/api/matches', { token: a.token, method: 'POST', body: {} })).status, 404);
});

test('demo identities never match real identities in a shared database', async t => {
  const { api, session, dbPath } = await fixture(t);
  const a = await session('lin');
  const b = await session('momo');
  const db = new DatabaseSync(dbPath);
  const stored = JSON.parse(db.prepare('SELECT data FROM users WHERE id=?').get(b.user.id).data);
  stored.demo = false;
  db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(stored), b.user.id);
  db.close();
  assert.equal((await api('/api/matches', { token: a.token, method: 'POST', body: {} })).status, 404);
});

test('a UTF-8 character split across request chunks is preserved', async t => {
  const { api, app, a, b, match } = await pair(t);
  const path = `/api/matches/${match.id}`;
  for (const token of [a.token, b.token]) await api(`${path}/decision`, { token, method: 'POST', body: { decision: 'accept' } });
  const message = '你好，慢慢认识。';
  const payload = Buffer.from(JSON.stringify({ text: message }));
  const split = payload.indexOf(Buffer.from('你')) + 1;
  const firstChunk = new Promise(resolve => app.once('request', incoming => incoming.once('data', resolve)));
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request({ hostname: '127.0.0.1', port: app.address().port, path: `${path}/messages`, method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json', 'content-length': payload.length } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Split UTF-8 request timed out')));
  });
  request.write(payload.subarray(0, split));
  await firstChunk;
  request.end(payload.subarray(split));
  const result = await response;
  assert.equal(result.status, 201);
  assert.equal(result.body.message.text, message);
});
