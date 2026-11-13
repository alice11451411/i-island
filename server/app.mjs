import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel } from './ai.mjs';
import { emptyProfile, emptyReport, fail, text, moderate, validateProfile, project, hasMatchConsent, makeAgent, makeSimulation } from './domain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

export function createApp(options = {}) {
  const model = createModel(options);
  const demoMode = options.demoMode ?? process.env.DEMO_MODE !== 'false';
  const dbPath = options.dbPath || process.env.DB_PATH || path.join(root, 'data', 'island.sqlite');
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, openid TEXT UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, PRIMARY KEY(blocker, blocked));
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT NOT NULL, match_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT, event TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const userById = id => { const row = db.prepare('SELECT data FROM users WHERE id=?').get(id); if (!row) return null; const user = JSON.parse(row.data); user.profile = { ...emptyProfile, ...user.profile }; user.agent.aiMode ||= 'rules'; return user; };
  const saveUser = (user, openid = null) => { user.revision = (user.revision || 0) + 1; db.prepare('INSERT INTO users (id,openid,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(user.id, openid, JSON.stringify(user)); };
  const event = (userId, name) => db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(randomUUID(), userId, name, now());
  const newUser = (id, profile = emptyProfile, enabled = false, demo = demoMode) => ({ id, demo, profile: structuredClone(profile), agent: makeAgent(profile), consent: { authorizedFields: profile.adultConfirmed ? ['interests', 'traits', 'friendshipGoal', 'boundaries'] : [], version: 1 }, matchingEnabled: enabled });
  if (demoMode) {
    const seeds = [
      ['demo-lin', { ...emptyProfile, nickname: '小林', ageRange: '18-24', city: '杭州', mbti: 'INFP', interests: ['音乐', '电影', '阅读'], traits: ['慢热', '真诚'], friendshipGoal: '认识能分享日常与兴趣的朋友', boundaries: '不催回复，尊重独处时间', bio: '喜欢一个人的散步，也期待遇到聊得来的朋友。', adultConfirmed: true }],
      ['demo-momo', { ...emptyProfile, nickname: '木木', ageRange: '18-24', city: '杭州', mbti: 'ISFP', interests: ['音乐', '电影', '游戏'], traits: ['温柔', '慢热'], friendshipGoal: '认识能分享日常与兴趣的朋友', boundaries: '先文字聊天，不急着交换联系方式', bio: '这里是虚构演示用户木木。', adultConfirmed: true }]
    ];
    for (const [id, profile] of seeds) if (!userById(id)) saveUser(newUser(id, profile, true));
  }
  const issueSession = user => { if (!db.prepare("SELECT 1 FROM events WHERE user_id=? AND event='onboarding_started'").get(user.id)) event(user.id, 'onboarding_started'); const token = randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.id, now()); return { token, user }; };
  const getUser = req => {
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '')?.[1];
    const row = token ? db.prepare('SELECT user_id,created_at FROM sessions WHERE token_hash=?').get(hash(token)) : null;
    if (!row || Date.now() - Date.parse(row.created_at) > 7 * 86400000) fail(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
    const user = userById(row.user_id);
    if (!user || (!demoMode && user.demo)) fail(401, 'UNAUTHORIZED', '账号不存在或演示会话已停用，请重新登录');
    return user;
  };
  const userMatchHistory = id => JSON.stringify(db.prepare('SELECT data FROM matches WHERE a=? OR b=? ORDER BY id').all(id, id));
  const saveMatch = match => db.prepare('INSERT INTO matches VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(match.id, match.a, match.b, JSON.stringify(match));
  const blocked = (a, b) => !!db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(a, b, b, a);
  const ownedMatch = (id, user) => { const row = db.prepare('SELECT data FROM matches WHERE id=? AND (a=? OR b=?)').get(id, user.id, user.id); if (!row) fail(404, 'NOT_FOUND', '未找到这次相遇'); return JSON.parse(row.data); };
  const matchView = (match, user) => {
    const selfA = match.a === user.id;
    const other = userById(selfA ? match.b : match.a);
    const visible = other ? project(other) : {};
    const hidden = blocked(match.a, match.b);
    return { id: match.id, status: match.status, other: { nickname: other?.profile.nickname || '已离岛用户', interests: visible.interests || [], traits: visible.traits || [], avatarKey: other?.profile.avatarKey || 'sprout', avatarColor: selfA ? '#f5d6b7' : '#c2d9c4' }, transcript: hidden ? [] : match.transcript.map(item => ({ speaker: item.speakerId === user.id ? 'self' : 'other', text: item.text, round: item.round })), report: hidden ? emptyReport() : match.report, selfDecision: selfA ? match.decisionA : match.decisionB, otherDecision: selfA ? match.decisionB : match.decisionA, createdAt: match.createdAt, connectedAt: match.connectedAt || null, aiMode: match.aiMode || 'rules' };
  };
  const ensureChat = match => { if (match.status !== 'connected' || blocked(match.a, match.b)) fail(403, 'CHAT_LOCKED', '需要双方同意且匹配有效，才能开启真人聊天'); };
  const eraseSimulations = userId => {
    for (const row of db.prepare('SELECT data FROM matches WHERE a=? OR b=?').all(userId, userId)) { const match = JSON.parse(row.data); if (!['closed', 'declined'].includes(match.status)) match.closedReason = 'consent_changed'; match.status = 'closed'; match.transcript = []; match.report = emptyReport(); saveMatch(match); }
  };
  const readBody = async req => {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 16384) fail(413, 'TOO_LARGE', '请求内容过长'); chunks.push(chunk); }
    const body = Buffer.concat(chunks).toString('utf8');
    try { const value = body ? JSON.parse(body) : {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { fail(400, 'INVALID_JSON', '请求需要有效的JSON对象'); }
  };
  const hits = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式');
        const webRoot = path.join(root, 'web');
        const file = path.resolve(webRoot, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
        if (!file.startsWith(webRoot + path.sep)) fail(404, 'NOT_FOUND', '页面不存在');
        const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
        try { if (!statSync(file).isFile()) throw new Error(); const content = readFileSync(file); res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content); return; } catch { fail(404, 'NOT_FOUND', '页面不存在'); }
      }
      const key = req.socket.remoteAddress;
      const minute = Math.floor(Date.now() / 60000);
      const entry = hits.get(key);
      const count = entry?.minute === minute ? entry.count + 1 : 1;
      hits.set(key, { minute, count });
      if (hits.size > 1000) for (const [ip, value] of hits) if (value.minute !== minute) hits.delete(ip);
      if (count > 300) fail(429, 'RATE_LIMIT', '操作有点频繁，请稍后再试');
      const method = req.method;
      const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {};
      if (pathname === '/api/config' && method === 'GET') return json(res, 200, { demoMode, aiMode: model.mode });
      if (pathname === '/api/demo/session' && method === 'POST') {
        if (!demoMode) fail(404, 'NOT_FOUND', '演示模式未开启');
        const id = body.persona === 'lin' ? 'demo-lin' : body.persona === 'momo' ? 'demo-momo' : body.persona === 'new' ? randomUUID() : null;
        if (!id) fail(400, 'INVALID_PERSONA', '请选择有效的演示身份');
        let user = userById(id);
        if (!user) { user = newUser(id); saveUser(user); }
        return json(res, 201, issueSession(user));
      }
      if (pathname === '/api/auth/wechat' && method === 'POST') {
        const appid = options.wechatAppId ?? process.env.WECHAT_APP_ID;
        const secret = options.wechatSecret ?? process.env.WECHAT_APP_SECRET;
        if (!appid || !secret) fail(503, 'WECHAT_NOT_CONFIGURED', '尚未配置微信登录，请联系开发者');
        const code = text(body.code, 256, '微信登录凭据');
        if (!code) fail(400, 'INVALID_CODE', '缺少微信登录凭据');
        const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
        url.search = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' });
        let data;
        try { const response = await fetch(url, { signal: AbortSignal.timeout(10000) }); data = await response.json(); } catch { fail(502, 'WECHAT_UNAVAILABLE', '微信登录暂不可用，请稍后再试'); }
        if (!data.openid || data.errcode) fail(401, 'WECHAT_LOGIN_FAILED', '微信登录失败，请重新登录');
        const row = db.prepare('SELECT data FROM users WHERE openid=?').get(data.openid);
        const user = row ? userById(JSON.parse(row.data).id) : newUser(randomUUID(), emptyProfile, false, false);
        if (!row) saveUser(user, data.openid);
        return json(res, 200, issueSession(user));
      }
      const user = getUser(req);
      if (pathname === '/api/me' && method === 'GET') return json(res, 200, user);
      if (pathname === '/api/me' && method === 'PUT') {
        const { profile, authorizedFields } = validateProfile(body, user);
        const authorized = Object.fromEntries(authorizedFields.map(key => [key, profile[key]]));
        const revision = user.revision || 0;
        const history = userMatchHistory(user.id);
        const plan = model.mode === 'model' ? await model.agent(authorized) : null;
        const unchanged = () => { const latest = getUser(req); return (latest.revision || 0) === revision && userMatchHistory(user.id) === history; };
        if (!unchanged()) fail(409, 'STATE_CHANGED', '资料或匹配状态已改变，请重新保存');
        const candidateAgent = makeAgent(profile, plan, authorized);
        if (model.mode === 'model') await model.reviewAgent([authorized], { summary: candidateAgent.summary, tags: candidateAgent.tags, chatStyle: candidateAgent.chatStyle });
        if (!unchanged()) fail(409, 'STATE_CHANGED', '资料或匹配状态已改变，请重新保存');
        const latest = getUser(req);
        const changed = JSON.stringify(project(latest)) !== JSON.stringify(authorized) || JSON.stringify(authorizedFields) !== JSON.stringify(latest.consent.authorizedFields) || !!profile.sameCityOnly !== !!latest.profile.sameCityOnly;
        if (changed) eraseSimulations(latest.id);
        latest.profile = profile; latest.agent = candidateAgent; latest.consent = { authorizedFields, version: latest.consent.version + (changed ? 1 : 0) };
        if (changed) latest.matchingEnabled = false;
        saveUser(latest); event(latest.id, 'agent_saved');
        return json(res, 200, latest);
      }
      if (pathname === '/api/me' && method === 'DELETE') {
        db.exec('BEGIN');
        try {
          const ids = db.prepare('SELECT id FROM matches WHERE a=? OR b=?').all(user.id, user.id);
          for (const { id } of ids) { db.prepare('DELETE FROM messages WHERE match_id=?').run(id); db.prepare('DELETE FROM reports WHERE match_id=?').run(id); }
          db.prepare('DELETE FROM matches WHERE a=? OR b=?').run(user.id, user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM blocks WHERE blocker=? OR blocked=?').run(user.id, user.id);
          db.prepare('DELETE FROM reports WHERE reporter=?').run(user.id);
          db.prepare('DELETE FROM events WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM users WHERE id=?').run(user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { deleted: true });
      }
      if (pathname === '/api/me/matching' && method === 'POST') {
        if (typeof body.enabled !== 'boolean') fail(400, 'INVALID_INPUT', '请明确选择是否开启匹配');
        if (body.enabled && !hasMatchConsent(user)) fail(409, 'PROFILE_REQUIRED', '请先完成成年确认，并授权至少一项兴趣或交友期待');
        user.matchingEnabled = body.enabled; saveUser(user); return json(res, 200, user);
      }
      if (pathname === '/api/matches' && method === 'GET') return json(res, 200, { matches: db.prepare('SELECT data FROM matches WHERE a=? OR b=? ORDER BY rowid DESC').all(user.id, user.id).map(row => matchView(JSON.parse(row.data), user)) });
      if (pathname === '/api/matches' && method === 'POST') {
        if (!user.matchingEnabled || !hasMatchConsent(user)) fail(409, 'MATCHING_PAUSED', '请先完成Agent并开启匹配');
        const existing = db.prepare('SELECT data FROM matches WHERE a=? OR b=? ORDER BY rowid DESC').all(user.id, user.id).map(row => JSON.parse(row.data)).find(item => ['ready', 'waiting', 'connected'].includes(item.status) && !blocked(item.a, item.b));
        if (existing) return json(res, 200, { match: matchView(existing, user) });
        const own = project(user);
        const candidates = db.prepare('SELECT id FROM users WHERE id<>?').all(user.id).map(row => userById(row.id)).filter(other => !!other.demo === !!user.demo && other.matchingEnabled && hasMatchConsent(other) && (!(user.profile.sameCityOnly || other.profile.sameCityOnly) || !!project(user).city && project(user).city === project(other).city) && !blocked(user.id, other.id)).map(other => {
          const data = project(other);
          const shared = (own.interests || []).filter(item => (data.interests || []).includes(item)).length;
          const sameGoal = !!own.friendshipGoal && own.friendshipGoal === data.friendshipGoal;
          const previousDecline = db.prepare('SELECT data FROM matches WHERE (a=? AND b=?) OR (a=? AND b=?)').all(user.id, other.id, other.id, user.id).some(row => { const previous = JSON.parse(row.data); return previous.status === 'declined' || previous.status === 'closed' && previous.closedReason !== 'consent_changed'; });
          return { other, score: previousDecline ? 0 : shared * 3 + (sameGoal ? 2 : 0) + (shared && own.city && own.city === data.city ? 1 : 0) };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
        if (!candidates.length) fail(404, 'NO_MATCH', '暂时没有合适的Agent，休息一下，晚点再来看看');
        const other = candidates[0].other;
        const pairHistory = () => JSON.stringify(db.prepare('SELECT data FROM matches WHERE (a=? AND b=?) OR (a=? AND b=?) ORDER BY id').all(user.id, other.id, other.id, user.id));
        const history = pairHistory();
        const plan = model.mode === 'model' ? await model.match(project(user), project(other)) : null;
        const unchanged = () => {
          const latest = getUser(req), latestOther = userById(other.id);
          return !!latestOther && (latest.revision || 0) === (user.revision || 0) && (latestOther.revision || 0) === (other.revision || 0) && latest.matchingEnabled && latestOther.matchingEnabled && hasMatchConsent(latest) && hasMatchConsent(latestOther) && !blocked(user.id, other.id) && pairHistory() === history;
        };
        if (!unchanged()) fail(409, 'STATE_CHANGED', '资料或匹配状态已改变，请重新开始');
        const simulation = makeSimulation(user, other, plan);
        const qualityCheck = model.mode === 'model' ? await model.reviewMatch([project(user), project(other)], {
          transcript: simulation.transcript.map(item => ({ speaker: item.speakerId === user.id ? 'A' : 'B', text: item.text, round: item.round })),
          report: simulation.report
        }) : null;
        if (qualityCheck && !unchanged()) fail(409, 'STATE_CHANGED', '资料或匹配状态已改变，请重新开始');
        const match = { id: randomUUID(), a: user.id, b: other.id, status: 'ready', decisionA: null, decisionB: null, consentA: user.consent.version, consentB: other.consent.version, createdAt: now(), aiMode: model.mode, ...(qualityCheck ? { qualityCheck } : {}), ...simulation };
        saveMatch(match); event(user.id, 'agent_exchange');
        return json(res, 201, { match: matchView(match, user) });
      }
      const route = /^\/api\/matches\/([^/]+)(?:\/(decision|close|block|report|messages|icebreaker))?$/.exec(pathname);
      if (!route) fail(404, 'NOT_FOUND', '接口不存在');
      const match = ownedMatch(route[1], user);
      const action = route[2];
      if (!action && method === 'GET') return json(res, 200, { match: matchView(match, user) });
      if (action === 'decision' && method === 'POST') {
        if (['closed', 'declined'].includes(match.status) || blocked(match.a, match.b)) fail(409, 'MATCH_CLOSED', '这次相遇已结束');
        if (!['accept', 'decline'].includes(body.decision)) fail(400, 'INVALID_DECISION', '请选择想认识或暂时不了');
        if (match.status === 'connected' && body.decision === 'decline') fail(409, 'MATCH_CLOSED', '已经开始聊天，请使用解除匹配结束联系');
        match[match.a === user.id ? 'decisionA' : 'decisionB'] = body.decision;
        match.status = body.decision === 'decline' ? 'declined' : match.decisionA === 'accept' && match.decisionB === 'accept' ? 'connected' : 'waiting';
        if (match.status === 'connected' && !match.connectedAt) { match.connectedAt = now(); event(user.id, 'mutual_connected'); }
        saveMatch(match); event(user.id, body.decision === 'accept' ? 'intent_accepted' : 'intent_declined');
        return json(res, 200, { match: matchView(match, user) });
      }
      if (action === 'close' && method === 'POST') { match.status = 'closed'; match.closedReason = 'unmatched'; saveMatch(match); return json(res, 200, { match: matchView(match, user) }); }
      if (action === 'block' && method === 'POST') {
        const otherId = match.a === user.id ? match.b : match.a;
        db.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?)').run(user.id, otherId);
        for (const row of db.prepare('SELECT data FROM matches WHERE (a=? AND b=?) OR (a=? AND b=?)').all(user.id, otherId, otherId, user.id)) { const value = JSON.parse(row.data); value.status = 'closed'; value.closedReason = 'blocked'; value.transcript = []; value.report = emptyReport(); db.prepare('DELETE FROM messages WHERE match_id=?').run(value.id); saveMatch(value); }
        return json(res, 200, { blocked: true });
      }
      if (action === 'report' && method === 'POST') {
        const reason = text(body.reason, 500, '举报原因');
        if (!reason) fail(400, 'REASON_REQUIRED', '请填写举报原因');
        db.prepare('INSERT INTO reports VALUES (?,?,?,?,?)').run(randomUUID(), user.id, match.id, reason, now());
        return json(res, 200, { reported: true });
      }
      if (action === 'icebreaker' && method === 'POST') { ensureChat(match); return json(res, 200, { suggestions: match.report.topics.length ? match.report.topics : ['最近有什么让你觉得开心的小事吗？'] }); }
      if (action === 'messages' && method === 'GET') {
        ensureChat(match);
        return json(res, 200, { messages: db.prepare('SELECT * FROM messages WHERE match_id=? ORDER BY rowid').all(match.id).map(item => ({ id: item.id, mine: item.sender === user.id, text: item.text, createdAt: item.created_at })) });
      }
      if (action === 'messages' && method === 'POST') {
        ensureChat(match);
        const value = text(body.text, 1000, '消息');
        if (!value) fail(400, 'EMPTY_MESSAGE', '消息不能为空');
        moderate(value);
        const message = { id: randomUUID(), mine: true, text: value, createdAt: now() };
        db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(message.id, match.id, user.id, value, message.createdAt); event(user.id, 'human_message');
        return json(res, 201, { message });
      }
      fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '服务暂时不可用，请稍后再试' } });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  server.on('close', () => db.close());
  return server;
}


