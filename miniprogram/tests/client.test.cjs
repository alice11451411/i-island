const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function readModule(file, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { module, exports: module.exports, ...context }, { filename: file });
  return module.exports;
}
test('API request uses server session bearer, never client-supplied identity', async () => {
  let captured;
  const app = { globalData: { apiBase: 'http://127.0.0.1:3210', token: 'session-abc' }, ensureSession: async () => {} };
  const api = readModule('utils/api.js', { getApp: () => app, wx: { request(options) { captured = options; options.success({ statusCode: 200, data: { matches: [] } }); } } });
  await api.request('/api/matches');
  assert.equal(captured.header.Authorization, 'Bearer session-abc');
  assert.equal(captured.url, 'http://127.0.0.1:3210/api/matches');
  assert.equal(captured.data, undefined);
});
test('API rejects server-side permission errors rather than treating them as chat success', async () => {
  const app = { globalData: { apiBase: 'http://127.0.0.1:3210', token: 'session-abc' }, ensureSession: async () => {} };
  const api = readModule('utils/api.js', { getApp: () => app, wx: { request(options) { options.success({ statusCode: 403, data: { error: { code: 'CONSENT_REQUIRED', message: '双方同意后才能聊天' } } }); } } });
  await assert.rejects(api.request('/api/matches/a/messages', 'POST', { text: 'hello' }), /双方同意后才能聊天/);
});
test('choosing icebreaker only fills draft and does not send a message', () => {
  let page;
  let requests = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/inbox/inbox.js'), 'utf8'), {
    require: () => ({ request: () => { requests += 1; } }),
    Page: value => { page = value; },
    getApp: () => ({ globalData: {} }),
    wx: {},
    setInterval, clearInterval
  });
  const state = { data: { draft: '' }, setData(values) { Object.assign(this.data, values); } };
  page.chooseSuggestion.call(state, { currentTarget: { dataset: { text: '最近在听什么歌？' } } });
  assert.equal(state.data.draft, '最近在听什么歌？');
  assert.equal(requests, 0);
});
test('chat cannot send before both participants consent', async () => {
  let page;
  let requests = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/inbox/inbox.js'), 'utf8'), {
    require: () => ({ request: () => { requests += 1; } }), Page: value => { page = value; },
    getApp: () => ({ globalData: {} }), wx: {}, setInterval, clearInterval
  });
  const state = { data: { selected: { id: 'a', status: 'waiting' }, draft: 'hello', busy: false } };
  await page.send.call(state);
  assert.equal(requests, 0);
});
test('withdrawing all sharing fields stays withdrawn when reopening the Agent form', async () => {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/agent/agent.js'), 'utf8'), {
    require: name => name.endsWith('/profile') ? readModule('utils/profile.js') : ({ request: async () => ({ profile: { nickname: 'new', interests: [], traits: [] }, consent: { authorizedFields: [] } }) }),
    Page: value => { page = value; }, wx: {}, getApp: () => ({ globalData: { aiMode: 'model' } })
  });
  const state = { data: structuredClone(page.data), setData(values) { Object.assign(this.data, values); }, syncOptions: page.syncOptions };
  await page.load.call(state);
  assert.equal(state.data.authorizedFields.length, 0);
  assert.equal(state.data.fields.filter(field => field.selected).length, 0);
});
test('native session and API adapter complete mutual consent against the actual in-memory server', async () => {
  const { pathToFileURL } = require('node:url');
  const { createApp } = await import(pathToFileURL(path.resolve(__dirname, '../../server/app.mjs')).href);
  const server = createApp({ dbPath: ':memory:', demoMode: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const wx = { request(options) {
    fetch(options.url, { method: options.method || 'GET', headers: options.header, body: options.data === undefined ? undefined : JSON.stringify(options.data) })
      .then(async response => options.success({ statusCode: response.status, data: await response.json() }))
      .catch(() => options.fail());
  } };
  let app;
  try {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8'), { require: () => ({ apiBase: base }), App: value => { app = value; }, wx });
    const api = readModule('utils/api.js', { getApp: () => app, wx });
    const me = await api.request('/api/me');
    assert.equal(me.profile.nickname, '小林');
    const profile = readModule('utils/profile.js');
    const linSaved = await api.request('/api/me', 'PUT', profile.profilePayload({ ...me.profile, avatarKey: 'cat', sameCityOnly: true }, true, [...me.consent.authorizedFields, 'city']));
    assert.equal(linSaved.profile.avatarKey, 'cat');
    assert.equal(linSaved.profile.sameCityOnly, true);
    await app.switchPersona('momo');
    const momo = await api.request('/api/me');
    const momoSaved = await api.request('/api/me', 'PUT', profile.profilePayload({ ...momo.profile, avatarKey: 'moon' }, true, [...momo.consent.authorizedFields, 'city']));
    assert.equal(momoSaved.profile.avatarKey, 'moon');
    await api.request('/api/me/matching', 'POST', { enabled: true });
    await app.switchPersona('lin');
    await api.request('/api/me/matching', 'POST', { enabled: true });
    const { match } = await api.request('/api/matches', 'POST');
    assert.equal(match.other.avatarKey, 'moon');
    assert.equal(match.aiMode, 'rules');
    assert.equal(match.transcript.length, 6);
    const waiting = await api.request('/api/matches/' + match.id + '/decision', 'POST', { decision: 'accept' });
    assert.equal(waiting.match.status, 'waiting');
    await assert.rejects(api.request('/api/matches/' + match.id + '/messages', 'POST', { text: 'premature' }));
    await app.switchPersona('momo');
    const connected = await api.request('/api/matches/' + match.id + '/decision', 'POST', { decision: 'accept' });
    assert.equal(connected.match.status, 'connected');
    await api.request('/api/matches/' + match.id + '/messages', 'POST', { text: '你好，最近在听什么歌？' });
    await app.switchPersona('lin');
    const received = await api.request('/api/matches/' + match.id + '/messages');
    assert.equal(received.messages.length, 1);
    assert.equal(received.messages[0].mine, false);
    assert.equal(received.messages[0].text, '你好，最近在听什么歌？');
    const suggestions = await api.request('/api/matches/' + match.id + '/icebreaker', 'POST');
    assert.ok(suggestions.suggestions.length > 0);
    const stillOne = await api.request('/api/matches/' + match.id + '/messages');
    assert.equal(stillOne.messages.length, 1);
    await api.request('/api/matches/' + match.id + '/close', 'POST');
    await assert.rejects(api.request('/api/matches/' + match.id + '/messages', 'POST', { text: 'after closing' }));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
test('native profile submission preserves selected avatar and consented same-city preference', () => {
  const profile = readModule('utils/profile.js');
  const body = profile.profilePayload({ nickname: '小林', avatarKey: 'moon', sameCityOnly: true, city: '杭州' }, true, ['city', 'interests']);
  assert.equal(body.avatarKey, 'moon');
  assert.equal(body.sameCityOnly, true);
  assert.equal(body.adultConfirmed, true);
  assert.equal(body.authorizedFields.join(','), 'city,interests');
  assert.equal(profile.profilePayload({ nickname: '旧资料' }, true, []).avatarKey, 'sprout');
  assert.equal(profile.profilePayload({ nickname: '旧资料' }, true, []).sameCityOnly, false);
});
test('native same-city preference requires a nonempty and authorized city', () => {
  const profile = readModule('utils/profile.js');
  assert.throws(() => profile.profilePayload({ sameCityOnly: true, city: ' ' }, true, ['city']), /城市/);
  assert.throws(() => profile.profilePayload({ sameCityOnly: true, city: '杭州' }, true, ['interests']), /授权/);
  assert.doesNotThrow(() => profile.profilePayload({ sameCityOnly: false, city: '' }, true, []));
});
test('record generation mode defaults to rules even while default mode is model', async () => {
  const native = readModule('utils/profile.js');
  assert.equal(native.generationLabel({}), '规则模拟');
  assert.equal(native.generationLabel({ aiMode: 'rules' }), '规则模拟');
  assert.equal(native.generationLabel({ aiMode: 'model' }), 'AI 模型模拟');
  const { pathToFileURL } = require('node:url');
  const web = await import(pathToFileURL(path.resolve(__dirname, '../../web/profile.js')).href);
  assert.equal(web.generationLabel({}), '规则模拟');
  assert.equal(web.generationLabel({ aiMode: 'rules' }), '规则模拟');
  assert.equal(web.generationLabel({ aiMode: 'model' }), 'AI 模型模拟');
});
test('browser profile serializes avatar and checkbox as boolean and enforces city authorization', async () => {
  const { pathToFileURL } = require('node:url');
  const { profileSubmission } = await import(pathToFileURL(path.resolve(__dirname, '../../web/profile.js')).href);
  const form = new FormData();
  form.set('nickname', '小林'); form.set('city', '杭州'); form.set('avatarKey', 'orange');
  form.set('adultConfirmed', 'on'); form.set('sameCityOnly', 'on'); form.append('authorizedFields', 'city');
  const body = profileSubmission(form, { interests: ['音乐'], traits: ['慢热'] });
  assert.equal(body.avatarKey, 'orange'); assert.equal(body.sameCityOnly, true); assert.equal(body.adultConfirmed, true);
  form.delete('authorizedFields');
  assert.throws(() => profileSubmission(form, { interests: ['音乐'], traits: ['慢热'] }), /授权/);
  form.delete('sameCityOnly'); form.delete('avatarKey');
  const legacy = profileSubmission(form, { interests: ['音乐'], traits: ['慢热'] });
  assert.equal(legacy.avatarKey, 'sprout'); assert.equal(legacy.sameCityOnly, false);
});
test('late native response cannot clear a newly selected identity session', async () => {
  let pending;
  const app = { globalData: { apiBase: 'http://127.0.0.1:3210', token: 'old-session' }, ensureSession: async () => {} };
  const api = readModule('utils/api.js', { getApp: () => app, wx: { request(options) { pending = options; } } });
  const response = api.request('/api/me');
  await Promise.resolve();
  app.globalData.token = 'new-session';
  pending.success({ statusCode: 401, data: { error: { code: 'UNAUTHORIZED', message: 'expired' } } });
  await assert.rejects(response);
  assert.equal(app.globalData.token, 'new-session');
});
test('match polling closes the chat and clears local conversation state', async () => {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/inbox/inbox.js'), 'utf8'), {
    require: name => name.endsWith('/api')
      ? { request: async path => path.endsWith('/messages') ? { messages: [] } : { match: { id: 'm1', status: 'closed' } }, statusLabel: status => status, formatTime: () => '' }
      : { avatarSymbol: () => '🌱', generationLabel: () => '规则模拟' },
    Page: value => { page = value; }, getApp: () => ({ globalData: {} }), wx: {}, setInterval, clearInterval
  });
  const state = { _epoch: 1, data: { selected: { id: 'm1', status: 'connected' }, matches: [{ id: 'm1', status: 'connected' }], messages: [{ id: 'msg' }], draft: '未发送草稿', suggestions: ['话题'], scrollId: 'message-msg' }, setData(values) { Object.assign(this.data, values); } };
  await page.refreshMatchState.call(state);
  assert.equal(state.data.selected, null);
  assert.equal(state.data.matches[0].status, 'closed');
  assert.equal(state.data.messages.length, 0);
  assert.equal(state.data.draft, '');
  assert.equal(state.data.suggestions.length, 0);
});
test('home routes to profile when no matching field is authorized', async () => {
  let page;
  let destination;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/home/home.js'), 'utf8'), {
    require: name => name.endsWith('/profile') ? { canStartMatching: () => false } : { request: async () => {} },
    Page: value => { page = value; }, getApp: () => ({ globalData: {} }),
    wx: { navigateTo: options => { destination = options.url; } }
  });
  const state = { data: { me: { profile: { adultConfirmed: true }, agent: {} } }, editAgent: page.editAgent };
  await page.startMatch.call(state);
  assert.equal(destination, '/pages/agent/agent');
});

function homeMatchingHarness(request, showModal) {
  let page;
  const app = { globalData: { aiMode: 'rules' } };
  const destinations = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/home/home.js'), 'utf8'), {
    require: name => name.endsWith('/profile') ? { canStartMatching: () => true } : { request },
    Page: value => { page = value; }, getApp: () => app,
    wx: { showModal, navigateTo: options => destinations.push(options.url) }
  });
  const state = { data: { ...structuredClone(page.data), me: { agent: {}, matchingEnabled: false } }, setData(values) { Object.assign(this.data, values); } };
  return { start: () => page.startMatch.call(state), state, app, destinations };
}

test('home preserves enabled matching after generation fails and retry opens the report', async () => {
  let attempts = 0;
  const enabledUser = { agent: {}, matchingEnabled: true };
  const harness = homeMatchingHarness(async url => {
    if (url === '/api/me/matching') return enabledUser;
    assert.equal(harness.state.data.me.matchingEnabled, true);
    if (++attempts === 1) throw new Error('生成内容暂时不可用，请稍后重试');
    return { match: { id: 'match 1' } };
  }, options => options.success({ confirm: true }));
  await harness.start();
  assert.equal(harness.state.data.me, enabledUser);
  assert.equal(harness.state.data.error, '生成内容暂时不可用，请稍后重试');
  assert.equal(harness.state.data.busy, false);
  assert.equal(harness.destinations.length, 0);
  await harness.start();
  assert.equal(harness.state.data.busy, false);
  assert.equal(harness.state.data.error, '');
  assert.equal(harness.app.globalData.lastMatchId, 'match 1');
  assert.deepEqual(harness.destinations, ['/pages/report/report?id=match%201']);
});

test('home cancellation releases busy without enabling matching', async () => {
  let requests = 0;
  const harness = homeMatchingHarness(async () => { requests++; }, options => options.success({ confirm: false }));
  await harness.start();
  assert.equal(requests, 0);
  assert.equal(harness.state.data.busy, false);
  assert.equal(harness.state.data.me.matchingEnabled, false);
});

test('home consent modal failure releases busy for another attempt', async () => {
  let requests = 0;
  const harness = homeMatchingHarness(async () => { requests++; }, options => options.fail());
  await harness.start();
  assert.equal(requests, 0);
  assert.equal(harness.state.data.busy, false);
  assert.match(harness.state.data.error, /确认授权/);
});

test('home allows only one outstanding matching consent modal', async () => {
  let modals = 0, pending;
  const harness = homeMatchingHarness(async () => { throw new Error('consent has not been granted'); }, options => { modals++; pending = options; });
  const first = harness.start();
  assert.equal(harness.state.data.busy, true);
  await harness.start();
  assert.equal(modals, 1);
  pending.success({ confirm: false });
  await first;
  assert.equal(harness.state.data.busy, false);
});
