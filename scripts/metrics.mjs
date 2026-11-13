import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultDb = fileURLToPath(new URL('../data/island.sqlite', import.meta.url));
const sevenDays = 7 * 24 * 60 * 60 * 1000;
function isoTime(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label}需要有效的 ISO 时间，例如 2026-10-01T00:00:00Z`);
  const datePart = value.slice(0, 10);
  if (new Date(datePart + 'T00:00:00Z').toISOString().slice(0, 10) !== datePart) throw new Error(`${label}需要有效的 ISO 日历日期`);
  return Date.parse(value);
}
const rate = (numerator, denominator, definition) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null, definition });

export function summarizeMetrics({ users = [], events = [], matches = [], messages = [] }, { since = null, includeDemo = false, now = new Date().toISOString() } = {}) {
  const end = isoTime(now, 'now');
  const start = since === null ? -Infinity : isoTime(since, 'since');
  if (start > end) throw new Error('since不能晚于统计时间');
  const eligible = new Set(users.filter(user => includeDemo || !(user.demo === true || user.demo === 1)).map(user => user.id));
  const within = value => { const time = Date.parse(value); return Number.isFinite(time) && time >= start && time <= end; };
  const firstStarted = new Map();
  const saves = new Map();
  for (const event of events) {
    if (!eligible.has(event.user_id)) continue;
    const time = Date.parse(event.created_at);
    if (!Number.isFinite(time) || time > end) continue;
    if (event.event === 'onboarding_started' && (!firstStarted.has(event.user_id) || time < firstStarted.get(event.user_id))) firstStarted.set(event.user_id, time);
    if (event.event === 'agent_saved') {
      if (!saves.has(event.user_id)) saves.set(event.user_id, []);
      saves.get(event.user_id).push(time);
    }
  }
  const started = [...firstStarted].filter(([, time]) => time >= start);
  const completed = started.filter(([id, time]) => (saves.get(id) || []).some(saved => saved >= time)).length;
  const savedUsers = new Set([...saves].filter(([, times]) => times.some(time => time >= start)).map(([id]) => id));
  const selectedMatches = matches.filter(match => eligible.has(match.a) && eligible.has(match.b) && within(match.createdAt));
  const simulations = selectedMatches.filter(match => (match.transcriptLength ?? match.transcript?.length ?? 0) > 0);
  const participants = new Set(simulations.flatMap(match => [match.a, match.b]).filter(id => savedUsers.has(id)));
  let legacyConnectedMatches = 0;
  const connections = [];
  for (const match of selectedMatches) {
    let connectedAt = match.connectedAt;
    if (!connectedAt && match.status === 'connected') { connectedAt = match.createdAt; legacyConnectedMatches++; }
    const connected = Date.parse(connectedAt);
    if (Number.isFinite(connected) && connected <= end) connections.push({ match, connected });
  }
  const connectedIds = new Set(connections.map(({ match }) => match.id));
  const mature = connections.filter(({ connected }) => connected + sevenDays <= end);
  const immatureMatches = connections.length - mature.length;
  const messagesByMatch = new Map();
  for (const message of messages) {
    if (!messagesByMatch.has(message.match_id)) messagesByMatch.set(message.match_id, []);
    messagesByMatch.get(message.match_id).push(message);
  }
  let sustained = 0;
  for (const { match, connected } of mature) {
    const days = new Map();
    for (const message of messagesByMatch.get(match.id) || []) {
      const time = Date.parse(message.created_at);
      if ((message.sender !== match.a && message.sender !== match.b) || !Number.isFinite(time) || time < connected || time >= connected + sevenDays) continue;
      const day = new Date(time).toISOString().slice(0, 10);
      if (!days.has(day)) days.set(day, new Set());
      days.get(day).add(message.sender);
    }
    if ([...days.values()].filter(senders => senders.has(match.a) && senders.has(match.b)).length >= 2) sustained++;
  }
  return {
    asOf: new Date(end).toISOString(), since: since === null ? null : new Date(start).toISOString(), includeDemo,
    metrics: {
      agentCreation: rate(completed, started.length, '首次 onboarding_started 在区间内的用户中，截至统计时间有有效 agent_saved 的去重用户比例。'),
      agentExchange: rate(participants.size, savedUsers.size, '区间内有 agent_saved 的去重用户中，参与区间内仍保有模拟对话的匹配用户比例。'),
      mutualConsent: rate(simulations.filter(match => connectedIds.has(match.id)).length, simulations.length, '区间内仍保有模拟对话的匹配中，曾记录 connectedAt 的匹配比例；旧 connected 状态以 createdAt 回退。'),
      sevenDayConversation: rate(sustained, mature.length, '区间内创建且连接已满7天的匹配中，首7天内至少两个不同UTC日期双方各发过一条消息的比例；区间为[连接时间,连接时间+7天)。')
    },
    retention: { matureMatches: mature.length, immatureMatches, legacyConnectedMatches, legacyDefinition: '缺少 connectedAt 且当前仍为 connected 的旧记录，以 createdAt 保守回退；无法恢复旧已关闭连接。' },
    scope: '用户指标按事件时间取区间；匹配指标按匹配 createdAt 取区间。区间包含 since，截止 asOf。只汇总仍存在的用户和记录，删除或清空的历史不会被推测补回；空分母返回null。'
  };
}

export function readMetrics(dbPath = defaultDb, options = {}) {
  if (!existsSync(dbPath)) throw new Error('数据库不存在，请先启动服务或通过 --db 指定现有数据库');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return summarizeMetrics({
      users: db.prepare("SELECT id,COALESCE(json_extract(data,'$.demo'),0) AS demo FROM users").all(),
      events: db.prepare('SELECT user_id,event,created_at FROM events').all(),
      matches: db.prepare("SELECT id,a,b,json_extract(data,'$.status') AS status,json_extract(data,'$.createdAt') AS createdAt,json_extract(data,'$.connectedAt') AS connectedAt,COALESCE(json_array_length(json_extract(data,'$.transcript')),0) AS transcriptLength FROM matches").all(),
      messages: db.prepare('SELECT match_id,sender,created_at FROM messages').all()
    }, options);
  } finally { db.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { db: { type: 'string' }, since: { type: 'string' }, 'include-demo': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log('用法：node scripts/metrics.mjs [--db path] [--since ISO] [--include-demo]\n只读汇总四项指标，不输出个人资料。默认排除演示用户。'); return; }
  const result = readMetrics(values.db || defaultDb, { since: values.since ?? null, includeDemo: values['include-demo'] });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
