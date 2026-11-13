import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as profile from '../web/profile.js';

function client(fetch) {
  const element = () => ({ innerHTML: '', textContent: '', dataset: {}, disabled: false, isConnected: true, checked: true, hidden: true, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, focus() {} });
  const elements = Object.fromEntries(['#app', '#toast', '#modal-root', '#match-consent', '#activity-root'].map(key => [key, element()]));
  const handlers = {};
  const controls = [];
  const document = { querySelector: key => elements[key] || null, querySelectorAll: () => controls, addEventListener: (name, handler) => { handlers[name] = handler; }, body: { classList: { add() {}, remove() {} } }, activeElement: null };
  let hash = '#home';
  const location = { get hash() { return hash; }, set hash(value) { hash = value.startsWith('#') ? value : '#' + value; } };
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '').replace('await boot();', '');
  const context = { ...profile, document, location, fetch, FormData, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, window: { addEventListener() {} }, sessionStorage: { setItem() {}, removeItem() {} } };
  vm.runInNewContext(source + '\nglobalThis.client = { state, actions, render };', context);
  const me = { profile: { nickname: '小林', adultConfirmed: true, interests: ['音乐'], traits: ['慢热'] }, agent: { name: '小林的 Agent' }, consent: { authorizedFields: ['interests'] }, matchingEnabled: false };
  context.client.state.me = me;
  context.client.state.config = { demoMode: true, aiMode: 'rules' };
  return { ...context.client, elements, handlers, location, me, element, controls };
}

const response = (status, body) => ({ ok: status < 400, json: async () => body });
const match = { id: 'm1', status: 'ready', other: { nickname: '木木' }, transcript: [], report: {} };

test('browser match failure keeps server matching state and retry opens the report', async () => {
  let attempts = 0;
  const app = client(async path => {
    if (path === '/api/me/matching') return response(200, { ...app.me, matchingEnabled: true });
    if (path === '/api/matches') return ++attempts === 1 ? response(502, { error: { message: '生成内容暂时不可用，请稍后重试' } }) : response(201, { match });
    throw new Error('Unexpected request: ' + path);
  });
  await assert.rejects(app.actions['confirm-match'](app.element()), /暂时不可用/);
  assert.equal(app.state.me.matchingEnabled, true);
  assert.match(app.elements['#app'].innerHTML, /Agent 正在认识新朋友/);
  await app.actions['confirm-match'](app.element());
  assert.equal(app.location.hash, '#reports');
  assert.equal(app.state.matches[0].id, match.id);
});

test('browser generation survives navigation and never forces a return to its origin', async () => {
  let finish;
  const app = client(async path => {
    if (path === '/api/me/matching') return response(200, { ...app.me, matchingEnabled: true });
    if (path === '/api/matches') return new Promise(resolve => { finish = () => resolve(response(201, { match })); });
    throw new Error('Unexpected request: ' + path);
  });
  const pending = app.actions['confirm-match'](app.element());
  while (!finish) await Promise.resolve();
  app.state.activeId = 'existing-chat';
  app.location.hash = '#profile';
  app.render();
  assert.match(app.elements['#activity-root'].innerHTML, /正在/);
  finish();
  await pending;
  assert.equal(app.location.hash, '#profile');
  assert.equal(app.state.activeId, 'existing-chat');
  assert.match(app.elements['#activity-root'].innerHTML, /报告/);
});

test('browser match never starts without explicit consent', async () => {
  let calls = 0;
  const app = client(async () => { calls++; });
  app.elements['#match-consent'].checked = false;
  await app.actions['confirm-match'](app.element());
  assert.equal(calls, 0);
});

test('browser pending action prevents duplicate requests and restores controls after failure', async () => {
  let fail;
  let requests = 0;
  const app = client(async path => {
    if (path === '/api/me/matching') return response(200, { ...app.me, matchingEnabled: true });
    requests++;
    return new Promise(resolve => { fail = () => resolve(response(502, { error: { message: '请稍后重试' } })); });
  });
  const button = app.element(); button.dataset.action = 'confirm-match';
  const otherButton = app.element(); otherButton.dataset.action = 'toggle-matching';
  app.controls.push(button, otherButton);
  const event = { target: { closest: () => button } };
  const pending = app.handlers.click(event);
  while (!fail) await Promise.resolve();
  assert.equal(otherButton.disabled, true);
  await app.handlers.click(event);
  assert.equal(requests, 1);
  fail();
  await pending;
  assert.equal(app.state.busy, false);
  assert.equal(button.disabled, false);
  assert.equal(otherButton.disabled, false);
  assert.match(app.elements['#activity-root'].innerHTML, /请稍后重试/);
});
