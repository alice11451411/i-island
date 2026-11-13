import { emptyProfile, emptyReport, fail, text, moderate, validateProfile, project, hasMatchConsent, makeAgent, makeSimulation } from './domain.mjs';

const storageKey = 'i-island-demo-v1';
const seedFields = ['interests', 'traits', 'friendshipGoal', 'boundaries'];
const seedProfiles = {
  lin: { nickname: '小林', interests: ['音乐', '电影', '阅读'], traits: ['慢热', '真诚'], boundaries: '不催回复，尊重独处时间' },
  momo: { nickname: '木木', interests: ['音乐', '电影', '游戏'], traits: ['温柔', '慢热'], boundaries: '先文字聊天，不急着交换联系方式' },
};

function newUser(id, seed) {
  const profile = seed ? { ...emptyProfile, ...seed, ageRange: '18-24', adultConfirmed: true, friendshipGoal: '认识能分享日常与兴趣的朋友' } : structuredClone(emptyProfile);
  return { id, profile, agent: makeAgent(profile), consent: { authorizedFields: seed ? seedFields : [], version: 1 }, matchingEnabled: !!seed };
}

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const participants = (match, id) => match.a === id || match.b === id;
const samePair = (match, a, b) => participants(match, a) && participants(match, b);
const terminal = match => ['closed', 'declined'].includes(match.status);
const now = () => new Date().toISOString();

export function createDemoTransport(storage) {
  let state;
  try { state = JSON.parse(storage.getItem(storageKey)); } catch { /* Start a fresh browser demo. */ }
  state ??= { users: {}, sessions: {}, matches: [], messages: [], blocks: [], reports: [] };
  const save = () => storage.setItem(storageKey, JSON.stringify(state));
  const blocked = (a, b) => state.blocks.some(pair => pair.includes(a) && pair.includes(b));
  const view = (match, user) => {
    const selfA = match.a === user.id;
    const other = state.users[selfA ? match.b : match.a];
    const visible = project(other);
    return {
      id: match.id, status: match.status, aiMode: 'rules', createdAt: match.createdAt,
      other: { nickname: other.profile.nickname, avatarKey: other.profile.avatarKey, interests: visible.interests || [], traits: visible.traits || [] },
      selfDecision: selfA ? match.decisionA : match.decisionB,
      otherDecision: selfA ? match.decisionB : match.decisionA,
      transcript: match.transcript.map(({ speakerId, ...item }) => ({ ...item, speaker: speakerId === user.id ? 'self' : 'other' })),
      report: match.report,
    };
  };

  return async function request(url, options = {}) {
    const path = new URL(url, 'https://demo.invalid').pathname;
    const method = options.method || 'GET';
    try {
      const body = options.body ? JSON.parse(options.body) : {};
      if (path === '/api/config' && method === 'GET') return response({ demoMode: true, aiMode: 'rules' });
      if (path === '/api/demo/session' && method === 'POST') {
        if (!['lin', 'momo', 'new'].includes(body.persona)) fail(400, 'INVALID_PERSONA', '请选择一个演示身份');
        for (const [id, seed] of Object.entries(seedProfiles)) state.users[id] ??= newUser(id, seed);
        const id = body.persona === 'new' ? 'visitor' : body.persona;
        const user = state.users[id] ??= newUser(id);
        for (const token of Object.keys(state.sessions)) if (state.sessions[token] === id) delete state.sessions[token];
        const token = crypto.randomUUID();
        state.sessions[token] = id;
        save();
        return response({ token, user }, 201);
      }
      const token = new Headers(options.headers).get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      const user = Object.hasOwn(state.sessions, token) ? state.users[state.sessions[token]] : null;
      if (!user) fail(401, 'UNAUTHORIZED', '演示身份已失效，请刷新页面重新进入');

      if (path === '/api/me') {
        if (method === 'GET') return response(user);
        if (method === 'PUT') {
          const { profile, authorizedFields } = validateProfile(body, user);
          const authorized = Object.fromEntries(authorizedFields.map(key => [key, profile[key]]));
          const changed = JSON.stringify(project(user)) !== JSON.stringify(authorized) || user.profile.sameCityOnly !== profile.sameCityOnly;
          if (changed) {
            for (const match of state.matches.filter(match => participants(match, user.id))) {
              if (!terminal(match)) { match.status = 'closed'; match.closedReason = 'consent_changed'; }
              match.transcript = [];
              match.report = emptyReport();
            }
            user.matchingEnabled = false;
          }
          user.profile = profile;
          user.consent = { authorizedFields, version: user.consent.version + Number(changed) };
          user.agent = makeAgent(profile);
          save();
          return response(user);
        }
        if (method === 'DELETE') {
          const matchIds = new Set(state.matches.filter(match => participants(match, user.id)).map(match => match.id));
          state.matches = state.matches.filter(match => !matchIds.has(match.id));
          state.messages = state.messages.filter(message => !matchIds.has(message.matchId));
          state.reports = state.reports.filter(report => !matchIds.has(report.matchId));
          state.blocks = state.blocks.filter(pair => !pair.includes(user.id));
          for (const token of Object.keys(state.sessions)) if (state.sessions[token] === user.id) delete state.sessions[token];
          delete state.users[user.id];
          save();
          return response({ deleted: true });
        }
      }

      if (path === '/api/me/matching' && method === 'POST') {
        if (typeof body.enabled !== 'boolean') fail(400, 'INVALID_INPUT', '请选择是否开启匹配');
        if (body.enabled && !hasMatchConsent(user)) fail(409, 'PROFILE_REQUIRED', '请先完成成年确认，并授权兴趣或交友期待');
        user.matchingEnabled = body.enabled;
        save();
        return response(user);
      }

      if (path === '/api/matches') {
        const ownMatches = state.matches.filter(match => participants(match, user.id));
        if (method === 'GET') return response({ matches: ownMatches.map(match => view(match, user)) });
        if (method === 'POST') {
          if (!user.matchingEnabled || !hasMatchConsent(user)) fail(409, 'MATCHING_PAUSED', '请先完成 Agent 并开启匹配');
          const existing = ownMatches.find(match => !terminal(match));
          if (existing) return response({ match: view(existing, user) });
          const own = project(user);
          const candidates = Object.values(state.users).filter(other => {
            if (other.id === user.id || !other.matchingEnabled || !hasMatchConsent(other) || blocked(user.id, other.id)) return false;
            if ((user.profile.sameCityOnly || other.profile.sameCityOnly) && (!own.city || own.city !== project(other).city)) return false;
            return !ownMatches.some(match => samePair(match, user.id, other.id) && terminal(match) && match.closedReason !== 'consent_changed');
          }).map(other => {
            const facts = project(other);
            const shared = (own.interests || []).filter(interest => (facts.interests || []).includes(interest)).length;
            const score = shared * 3 + (own.friendshipGoal && own.friendshipGoal === facts.friendshipGoal ? 2 : 0);
            return { other, score };
          }).sort((a, b) => b.score - a.score);
          const candidate = candidates.find(item => item.score > 0);
          if (!candidate) fail(404, 'NO_MATCH', '暂时没有合适的 Agent，试着添加一个共同兴趣，例如音乐或电影');
          const { other } = candidate;
          const match = { id: crypto.randomUUID(), a: user.id, b: other.id, status: 'ready', decisionA: null, decisionB: null, createdAt: now(), ...makeSimulation(user, other) };
          state.matches.unshift(match);
          save();
          return response({ match: view(match, user) }, 201);
        }
      }

      const route = /^\/api\/matches\/([^/]+)(?:\/(decision|close|block|report|messages|icebreaker))?$/.exec(path);
      const match = route && state.matches.find(match => match.id === route[1] && participants(match, user.id));
      if (!match) fail(404, 'NOT_FOUND', '未找到这次相遇');
      const action = route[2];
      if (!action && method === 'GET') return response({ match: view(match, user) });
      if (action === 'decision' && method === 'POST') {
        if (terminal(match)) fail(409, 'MATCH_CLOSED', '这次相遇已结束');
        if (!['accept', 'decline'].includes(body.decision)) fail(400, 'INVALID_DECISION', '请选择想认识或暂时不了');
        if (match.status === 'connected' && body.decision === 'decline') fail(409, 'MATCH_CLOSED', '已经开始聊天，请使用结束相遇');
        match[match.a === user.id ? 'decisionA' : 'decisionB'] = body.decision;
        match.status = body.decision === 'decline' ? 'declined' : match.decisionA === 'accept' && match.decisionB === 'accept' ? 'connected' : 'waiting';
        save();
        return response({ match: view(match, user) });
      }
      if (action === 'close' && method === 'POST') {
        match.status = 'closed';
        match.closedReason = 'unmatched';
        save();
        return response({ match: view(match, user) });
      }
      if (action === 'block' && method === 'POST') {
        state.blocks.push([match.a, match.b]);
        for (const pair of state.matches.filter(item => samePair(item, match.a, match.b))) {
          pair.status = 'closed';
          pair.closedReason = 'blocked';
          pair.transcript = [];
          pair.report = emptyReport();
          state.messages = state.messages.filter(message => message.matchId !== pair.id);
        }
        save();
        return response({ blocked: true });
      }
      if (action === 'report' && method === 'POST') {
        const reason = text(body.reason, 500, '举报原因');
        if (!reason) fail(400, 'REASON_REQUIRED', '请填写举报原因');
        state.reports.push({ reporter: user.id, matchId: match.id, reason });
        save();
        return response({ reported: true });
      }
      if (action === 'messages' || action === 'icebreaker') {
        if (match.status !== 'connected') fail(403, 'CHAT_LOCKED', '双方同意后才可以聊天');
        if (action === 'icebreaker' && method === 'POST') return response({ suggestions: match.report.topics });
        if (action === 'messages' && method === 'GET') {
          const messages = state.messages.filter(message => message.matchId === match.id).map(({ sender, matchId, ...message }) => ({ ...message, mine: sender === user.id }));
          return response({ messages });
        }
        if (action === 'messages' && method === 'POST') {
          const value = text(body.text, 1000, '消息');
          if (!value) fail(400, 'EMPTY_MESSAGE', '消息不能为空');
          moderate(value);
          const message = { id: crypto.randomUUID(), text: value, createdAt: now() };
          state.messages.push({ ...message, matchId: match.id, sender: user.id });
          save();
          return response({ message: { ...message, mine: true } }, 201);
        }
      }
      fail(405, 'METHOD_NOT_ALLOWED', '不支持此演示操作');
    } catch (error) {
      return response({ error: { code: error.code || 'DEMO_ERROR', message: error.status ? error.message : '演示暂时无法保存，请允许浏览器存储后重试' } }, error.status || 500);
    }
  };
}
