import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

let summarizeMetrics, readMetrics, listReports, reviewReport;
try { ({ summarizeMetrics, readMetrics } = await import('../scripts/metrics.mjs')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
try { ({ listReports, reviewReport } = await import('../scripts/reports.mjs')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const root = fileURLToPath(new URL('../', import.meta.url));
const asOf = '2026-10-31T12:00:00.000Z';
const since = '2026-10-01T00:00:00.000Z';
const entry = (user_id, event, created_at) => ({ user_id, event, created_at });
const exchange = (id, createdAt, connectedAt, extra = {}) => ({ id, a: 'r1', b: 'r2', transcript: [{ text: '不要输出的模拟正文' }], status: connectedAt ? 'connected' : 'waiting', createdAt, ...(connectedAt ? { connectedAt } : {}), ...extra });
const message = (match_id, sender, created_at) => ({ match_id, sender, created_at, text: '不要输出的消息正文' });
function fixtures() {
 return {
  users: ['r1', 'r2', 'r3', 'r4', 'd1', 'd2'].map(id => ({ id, demo: id.startsWith('d'), profile: { nickname: '不得输出的昵称', bio: '不得输出的简介' } })),
  events: [entry('r1', 'onboarding_started', '2026-10-02T10:00:00Z'), entry('r2', 'onboarding_started', '2026-10-03T10:00:00Z'), entry('r3', 'onboarding_started', '2026-10-04T10:00:00Z'), entry('r4', 'onboarding_started', '2026-09-10T10:00:00Z'), entry('r1', 'onboarding_started', '2026-10-05T10:00:00Z'), entry('r1', 'agent_saved', '2026-10-02T11:00:00Z'), entry('r1', 'agent_saved', '2026-10-05T11:00:00Z'), entry('r2', 'agent_saved', '2026-10-03T11:00:00Z'), entry('r4', 'agent_saved', '2026-09-11T10:00:00Z'), ...['d1', 'd2'].flatMap(id => [entry(id, 'onboarding_started', '2026-10-02T10:00:00Z'), entry(id, 'agent_saved', '2026-10-02T11:00:00Z')])],
  matches: [exchange('steady', '2026-10-10T12:00:00Z', '2026-10-11T12:00:00Z'), exchange('one-sided-days', '2026-10-12T12:00:00Z', '2026-10-13T12:00:00Z'), exchange('young', '2026-10-29T12:00:00Z', '2026-10-30T12:00:00Z'), exchange('legacy', '2026-10-20T12:00:00Z', null, { status: 'connected' }), exchange('waiting', '2026-10-25T12:00:00Z', null), exchange('revoked', '2026-10-15T12:00:00Z', '2026-10-16T12:00:00Z', { status: 'closed', transcript: [] }), exchange('demo-match', '2026-10-10T12:00:00Z', '2026-10-11T12:00:00Z', { a: 'd1', b: 'd2' })],
  messages: [message('steady', 'r1', '2026-10-11T13:00:00Z'), message('steady', 'r2', '2026-10-11T14:00:00Z'), message('steady', 'r1', '2026-10-12T13:00:00Z'), message('steady', 'r2', '2026-10-12T14:00:00Z'), message('one-sided-days', 'r1', '2026-10-13T13:00:00Z'), message('one-sided-days', 'r2', '2026-10-14T13:00:00Z'), message('demo-match', 'd1', '2026-10-11T13:00:00Z'), message('demo-match', 'd2', '2026-10-11T14:00:00Z'), message('demo-match', 'd1', '2026-10-12T13:00:00Z'), message('demo-match', 'd2', '2026-10-12T14:00:00Z')]
 };
}
function summary(data = fixtures(), options = {}) { assert.equal(typeof summarizeMetrics, 'function', 'metrics implementation is required'); return summarizeMetrics(data, { since, now: asOf, ...options }); }
const metricShape = metric => ({ numerator: metric.numerator, denominator: metric.denominator, rate: metric.rate });

test('metrics count distinct cohorts, real users and observable completed simulations', () => {
 const result = summary();
 assert.deepEqual(metricShape(result.metrics.agentCreation), { numerator: 2, denominator: 3, rate: 2 / 3 });
 assert.deepEqual(metricShape(result.metrics.agentExchange), { numerator: 2, denominator: 2, rate: 1 });
 assert.deepEqual(metricShape(result.metrics.mutualConsent), { numerator: 4, denominator: 5, rate: .8 });
 assert.deepEqual(metricShape(result.metrics.sevenDayConversation), { numerator: 1, denominator: 4, rate: .25 });
 assert.equal(result.retention.matureMatches, 4); assert.equal(result.retention.immatureMatches, 1); assert.equal(result.retention.legacyConnectedMatches, 1);
 assert.doesNotMatch(JSON.stringify(result), /不得输出|不要输出|r1|demo-match/);
});
test('demo samples are excluded by default and included only with explicit flag', () => {
 const result = summary(fixtures(), { includeDemo: true });
 assert.deepEqual(metricShape(result.metrics.agentCreation), { numerator: 4, denominator: 5, rate: .8 });
 assert.deepEqual(metricShape(result.metrics.agentExchange), { numerator: 4, denominator: 4, rate: 1 });
 assert.deepEqual(metricShape(result.metrics.mutualConsent), { numerator: 5, denominator: 6, rate: 5 / 6 });
 assert.deepEqual(metricShape(result.metrics.sevenDayConversation), { numerator: 2, denominator: 5, rate: .4 });
});
test('empty cohorts return null rates and immature matches never count as failures', () => {
 const result = summary({ users: [], events: [], matches: [], messages: [] });
 for (const metric of Object.values(result.metrics)) assert.deepEqual(metricShape(metric), { numerator: 0, denominator: 0, rate: null });
 const data = fixtures(); data.matches = data.matches.filter(m => m.id === 'young');
 const young = summary(data); assert.equal(young.metrics.sevenDayConversation.rate, null); assert.equal(young.retention.immatureMatches, 1);
});
test('retention requires both users on two UTC dates inside the first seven days', () => {
 const data = fixtures(); data.matches = [exchange('edge', '2026-10-09T00:00:00Z', '2026-10-10T12:00:00Z')];
 data.messages = [message('edge', 'r1', '2026-10-10T11:59:59Z'), message('edge', 'r2', '2026-10-10T11:59:59Z'), message('edge', 'r1', '2026-10-11T13:00:00Z'), message('edge', 'r2', '2026-10-11T14:00:00Z'), message('edge', 'r1', '2026-10-17T12:00:00Z'), message('edge', 'r2', '2026-10-17T12:00:00Z'), message('edge', 'outsider', '2026-10-12T12:00:00Z'), message('edge', 'r1', '2026-10-12T12:00:00Z')];
 assert.equal(summary(data).metrics.sevenDayConversation.numerator, 0);
 data.messages.push(message('edge', 'r2', '2026-10-12T20:00:00+08:00'));
 assert.equal(summary(data).metrics.sevenDayConversation.numerator, 1);
});
test('since rejects invalid timestamps and earliest onboarding determines the cohort', () => {
 assert.throws(() => summary(fixtures(), { since: 'yesterday' }), /ISO|since/);
 assert.throws(() => summary(fixtures(), { since: '2026-02-31T00:00:00Z' }), /ISO|since/);
 const data = fixtures(); data.events.unshift(entry('r1', 'onboarding_started', '2026-09-15T10:00:00Z'));
 const result = summary(data); assert.equal(result.metrics.agentCreation.denominator, 2); assert.equal(result.metrics.agentCreation.numerator, 1);
});

async function databaseFixture(t) {
 const dataRoot = new URL('../test-data/', import.meta.url); await mkdir(dataRoot, { recursive: true });
 const dir = await mkdtemp(fileURLToPath(new URL('ops-', dataRoot))); const dbPath = dir + '/ops.sqlite';
 const db = new DatabaseSync(dbPath); db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE events(id TEXT PRIMARY KEY,user_id TEXT,event TEXT,created_at TEXT); CREATE TABLE matches(id TEXT PRIMARY KEY,a TEXT,b TEXT,data TEXT); CREATE TABLE messages(id TEXT PRIMARY KEY,match_id TEXT,sender TEXT,text TEXT,created_at TEXT); CREATE TABLE reports(id TEXT PRIMARY KEY,reporter TEXT,match_id TEXT,reason TEXT,created_at TEXT);`);
 const data = fixtures(); for (const user of data.users) db.prepare('INSERT INTO users VALUES (?,?)').run(user.id, JSON.stringify(user));
 data.events.forEach((event, i) => db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(String(i), event.user_id, event.event, event.created_at));
 for (const m of data.matches) db.prepare('INSERT INTO matches VALUES (?,?,?,?)').run(m.id, m.a, m.b, JSON.stringify(m));
 data.messages.forEach((m, i) => db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(String(i), m.match_id, m.sender, m.text, m.created_at));
 for (const [id, reporter, match] of [['real-report', 'r1', 'steady'], ['demo-report', 'd1', 'demo-match']]) db.prepare('INSERT INTO reports VALUES (?,?,?,?,?)').run(id, reporter, match, '不尊重边界', '2026-10-12T12:00:00Z');
 t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); });
 return { db, dbPath };
}
test('metrics SQLite reader matches pure fixtures without changing database bytes', async t => {
 assert.equal(typeof readMetrics, 'function', 'SQLite metrics reader is required');
 const { dbPath } = await databaseFixture(t); const before = await readFile(dbPath);
 const actual = readMetrics(dbPath, { since, now: asOf }); assert.deepEqual(actual, summary());
 assert.deepEqual(await readFile(dbPath), before);
});
test('reports list is minimal, excludes demos and does not create review tables', async t => {
 assert.equal(typeof listReports, 'function', 'report listing is required');
 const { db } = await databaseFixture(t); const rows = listReports(db);
 assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]).sort(), ['createdAt', 'id', 'reason', 'reviewAction', 'reviewedAt'].sort());
 assert.equal(rows[0].id, 'real-report'); assert.equal(rows[0].reviewAction, null);
 assert.equal(listReports(db, { includeDemo: true }).length, 2);
 assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='report_reviews'").get().count, 0);
});
test('review writes only local review records, validates input and preserves original reports', async t => {
 assert.equal(typeof reviewReport, 'function', 'local review recording is required');
 const { db } = await databaseFixture(t); const before = db.prepare('SELECT * FROM reports ORDER BY id').all();
 assert.throws(() => reviewReport(db, 'missing', { action: 'reviewed', note: '检查' }), /不存在|not found/);
 assert.throws(() => reviewReport(db, 'real-report', { action: 'block', note: '' }), /action|dismiss|reviewed/);
 assert.throws(() => reviewReport(db, 'real-report', { action: 'reviewed', note: '长'.repeat(501) }), /500/);
 assert.throws(() => reviewReport(db, 'demo-report', { action: 'reviewed', note: '检查' }), /不存在|not found/);
 const result = reviewReport(db, 'real-report', { action: 'reviewed', note: '已由本地运营人工查看', now: asOf }); assert.equal(result.action, 'reviewed');
 assert.equal(listReports(db)[0].reviewAction, 'reviewed');
 reviewReport(db, 'real-report', { action: 'dismiss', note: '缺乏证据', now: asOf }); assert.equal(db.prepare('SELECT count(*) AS count FROM report_reviews').get().count, 1);
 assert.deepEqual(db.prepare('SELECT * FROM reports ORDER BY id').all(), before);
 db.prepare('DELETE FROM reports WHERE id=?').run('real-report'); assert.equal(db.prepare('SELECT count(*) AS count FROM report_reviews').get().count, 0);
});
test('CLI imports are inert, flags work and a missing database is never created', async t => {
 assert.equal(typeof readMetrics, 'function', 'CLI metrics implementation is required');
 const { dbPath } = await databaseFixture(t);
 const execute = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000 });
 const imported = execute(['--input-type=module', '-e', "await import('./scripts/metrics.mjs'); await import('./scripts/reports.mjs'); console.log('only-import')"]);
 assert.equal(imported.status, 0, imported.stderr); assert.equal(imported.stdout.trim(), 'only-import');
 const metrics = execute(['scripts/metrics.mjs', '--db', dbPath, '--since', since]); assert.equal(metrics.status, 0, metrics.stderr); assert.equal(JSON.parse(metrics.stdout).metrics.agentCreation.denominator, 3);
 const report = execute(['scripts/reports.mjs', 'list', '--db', dbPath, '--include-demo']); assert.equal(report.status, 0, report.stderr); assert.equal(JSON.parse(report.stdout).reports.length, 2);
 const review = execute(['scripts/reports.mjs', 'review', 'demo-report', '--action', 'dismiss', '--note', '演示检查', '--db', dbPath, '--include-demo']); assert.equal(review.status, 0, review.stderr); assert.equal(JSON.parse(review.stdout).action, 'dismiss');
 const missing = dbPath + '.missing'; const failed = execute(['scripts/metrics.mjs', '--db', missing]); assert.notEqual(failed.status, 0); assert.equal(existsSync(missing), false);
});
