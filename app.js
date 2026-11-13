import { createDemoTransport } from './demo-api.mjs';
const demoRequest = createDemoTransport(sessionStorage);
import { avatarOptions, avatarKey, avatarSymbol, generationLabel, canStartMatching, profileSubmission } from './profile.js';
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
 home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',
 leaf: '<path d="M20 3c1 12-4 18-12 16C0 16 5 5 20 3Z"/><path d="m4 21 12-12"/>',
 spark: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',
 chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 1 1 21 11.5Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>',
 user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', arrowUp: '<path d="M6 18 18 6H6m12 0v12"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
 shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 heart: '<path d="M20.8 4.6c-2-2.1-5.4-2.1-7.4 0L12 6l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21l8.8-9a5.2 5.2 0 0 0 0-7.4Z"/>',
 clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 check: '<path d="m5 12 4 4L19 6"/>', edit: '<path d="m16 3 5 5L8 21H3v-5ZM14 5l5 5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', report: '<path d="M5 21V3l14 1v11L5 14"/>',
 smile: '<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14q4 5 8 0"/>', settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
 send: '<path d="m22 2-7 20-4-9-9-4Zm0 0L11 13"/>', book: '<path d="M12 5C8 1 2 3 2 3v16s6-2 10 2c4-4 10-2 10-2V3s-6-2-10 2Zm0 0v16"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
const state = { config: null, token: '', persona: 'lin', me: null, matches: [], activeId: null, messages: [], suggestions: [], draft: '', route: 'home', busy: false, epoch: 0 };
const navItems = [['home', 'home', '我的小岛'], ['encounter', 'spark', '会客厅'], ['reports', 'book', '缘分报告'], ['inbox', 'chat', '消息'], ['profile', 'user', '我的 Agent']];
const fieldNames = { interests: '兴趣爱好', traits: '性格特点', friendshipGoal: '交友期待', boundaries: '社交边界', city: '城市', mbti: 'MBTI' };
const statuses = { ready: '交流已完成', waiting: '等待双方确认', connected: '已经互相认识', declined: '这次先说再见', closed: '本次相遇已结束' };
const interests = ['游戏', '音乐', '电影', '阅读', '二次元', '散步', '摄影', '咖啡', '旅行', '运动'];
const traits = ['慢热', '话少', '敏感', '幽默', '善于倾听', '随性', '好奇', '温柔'];
const currentMatch = () => state.matches.find(m => m.id === state.activeId) || state.matches[0];
const tags = items => `<div class="tags">${(items || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
const avatar = (name, cls = '', key = 'sprout') => `<div class="avatar ${cls}" aria-hidden="true">${avatarSymbol(key)}</div>`;
const modeLabel = record => generationLabel(record);
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3800); }
function showActivity(message = '', matchId = '', pending = false) {
 $('#activity-root').innerHTML = message ? `<div class="activity">${pending ? '<span class="loading-dot" aria-hidden="true"></span>' : ''}<p>${esc(message)}</p>${matchId ? `<button class="text-button" data-action="view-result" data-id="${esc(matchId)}">看看报告 ↗</button>` : ''}${pending ? '' : `<button class="text-button" data-action="dismiss-activity" aria-label="收起提示">${icon('close')}</button>`}</div>` : '';
}
function syncBusyControls() {
 document.querySelectorAll('button[data-action], button[type="submit"]').forEach(button => {
  if (state.busy && button.dataset.action !== 'close-modal' && !button.disabled) { button.disabled = true; button.dataset.busyDisabled = 'true'; }
  else if (!state.busy && button.dataset.busyDisabled) { button.disabled = false; delete button.dataset.busyDisabled; }
 });
}
async function api(path, options = {}) {
 const headers = { ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
 const response = await demoRequest(`/api${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.error?.message || '暂时没有连上小岛，请稍后再试');
 return data;
}
async function refresh() {
 const epoch = state.epoch, token = state.token;
 const [me, data] = await Promise.all([api('/me'), api('/matches')]); if (epoch !== state.epoch || token !== state.token) return; state.me = me; state.matches = data.matches;
 if (!state.matches.some(m => m.id === state.activeId)) state.activeId = state.matches[0]?.id || null;
}
async function session(persona) {
 state.epoch++;
 const data = await api('/demo/session', { method: 'POST', body: { persona } });
 state.token = data.token; state.persona = persona; state.activeId = null; state.messages = []; state.suggestions = []; state.draft = '';
 sessionStorage.setItem('i-island-session', JSON.stringify({ token: state.token, persona }));
 await refresh(); closeModal(); navigate('home');
}
function navigate(route) { if (location.hash === `#${route}`) { state.route = route; render(); } else location.hash = route; }
function heading(title, subtitle, english = 'YOUR OWN LITTLE ISLAND', side = '') { return `<div class="page-heading"><div><div class="eyebrow">${english}</div><h1>${title}</h1><p>${subtitle}</p></div>${side}</div>`; }
function empty(title, copy, action = 'start-match', button = '让 Agent 去认识新朋友', glyph = 'leaf') { return `<div class="card empty"><div class="empty-art">${icon(glyph)}</div><h2>${title}</h2><p>${copy}</p><button class="primary" data-action="${action}">${button} ${icon('arrow')}</button></div>`; }
function shell(content) {
 const name = state.me?.profile?.nickname || '新岛民';
 return `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#home" aria-label="I岛首页"><div class="brand-symbol">i</div><div><div class="brand-name">I岛</div><div class="brand-sub">SLOWLY, TOGETHER</div></div></a><div class="sidebar-caption">在这里，慢一点也没关系</div><nav class="nav" aria-label="主要导航">${navItems.map(([route, glyph, label]) => `<a href="#${route}" class="${state.route === route || (route === 'profile' && state.route === 'agent') ? 'active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="island-note"><div class="sprout">${icon('leaf')}</div><p>你不用变得外向，<br>也能遇见懂你的人。</p></div><div class="sidebar-foot">${icon('shield')} 你的边界，会被认真对待</div><button class="demo-switch" data-action="${state.config.demoMode ? 'switch-persona' : 'profile'}">${avatar(name, '', state.me?.profile?.avatarKey)}<span><strong>${esc(name)}</strong><small>${state.config.demoMode ? '浏览器演示 · 点击切换身份' : '我的小岛'}</small></span>${icon('settings')}</button></div></aside><main class="main"><header class="topbar"><div class="mobile-brand"><div class="brand-symbol">i</div><strong>I岛</strong></div><div class="breadcrumb"><strong>${esc(navItems.find(n => n[0] === state.route)?.[2] || '编辑 Agent')}</strong>${icon('chevron')}<span>发现一种轻松的相遇</span></div><div class="top-actions">${state.config.demoMode ? '<span class="demo-pill">浏览器演示</span>' : ''}<span class="generation-mode">默认 ${esc(modeLabel(state.config))}</span><button class="subtle-button" data-action="how">${icon('info')} 如何运作</button><button class="subtle-button" data-action="${state.config.demoMode ? 'switch-persona' : 'profile'}" aria-label="${state.config.demoMode ? '切换演示身份' : '我的资料'}">${avatar(name, 'top-avatar', state.me?.profile?.avatarKey)}</button></div></header><div class="route-fade route-${state.route}">${content}</div><footer class="page-footer">把开场白交给 Agent<span>·</span>把相遇留给真实的你</footer></main></div>`;
}
function homePage() {
 const me = state.me, agent = me.profile.adultConfirmed && me.profile.interests.length ? me.agent : null;
 const name = me.profile.nickname || '新岛民';
 const status = me.matchingEnabled ? 'Agent 正在认识新朋友' : agent ? 'Agent 在岛上休息' : '还没有 Agent';
 const action = agent ? 'start-match' : 'edit-agent';
 const actionLabel = agent ? '让 Agent 出发' : '创建我的 Agent';
 const tagsLine = agent?.tags?.length ? agent.tags : ['慢慢来', '自在相处'];
 return `${heading(`<span class="greeting-prefix">嗨，</span><span class="greeting-name">${esc(name)}</span><span class="greeting-period">。</span>`, '今天也按自己的节奏来。', 'YOUR ISLAND TODAY')}<section class="hero home-hero"><div class="hero-copy"><div class="hero-label"><span class="signal-dot"></span>${icon('sun')} 你的 Agent 名片</div><h2 class="cyber-title"><span class="headline-row">先聊<span class="type-cyan">喜欢</span>的，</span><span class="headline-row headline-second">再决定<span class="type-pink">要不要</span><span class="type-lime">靠近</span>。</span></h2><p>${esc(agent?.summary || '选几件喜欢的事，告诉我哪些边界要被认真对待。')}</p><div class="home-agent"><div class="avatar large mint">${avatarSymbol(me.profile.avatarKey)}</div><div class="home-agent-copy"><small>MY AGENT</small><strong>${esc(agent?.name || '等待诞生的小 Agent')}</strong><span>${esc(status)}</span></div><a class="text-button" href="#agent" aria-label="编辑 Agent 档案">${icon('edit')}</a></div>${tags(tagsLine)}<button class="primary" data-action="${action}">${actionLabel} ${icon('arrowUp')}</button><div class="hero-foot">${icon('lock')} 只分享你授权的资料，是否认识由你决定</div></div><div class="hero-art home-scene"><div class="scene-toolbar"><span class="scene-light"></span><strong>I岛.exe</strong><span>房间 08</span><span class="scene-controls" aria-hidden="true">- □ ×</span></div><img src="./hero-island.svg" alt="两只小小的 Agent 在树下的小岛相遇"><div class="float-note one">${agent?.tags?.[0] ? `最近喜欢 ${esc(agent.tags[0])}` : '一张留给你的名片'}</div><div class="float-note two"><span class="dot"></span> 小岛上，没有必须说的话</div><div class="scene-status"><span class="scene-bars"><i></i><i></i><i></i></span> 慢速连接中</div></div></section><section class="home-today"><div class="home-today-title"><div><div class="eyebrow">ON YOUR ISLAND</div><h2>今天的小岛</h2></div><a href="#reports">我的缘分报告 ${icon('chevron')}</a></div><div class="home-today-row"><span class="step-number">01</span><div><strong>${esc(status)}</strong><p>${agent ? me.matchingEnabled ? '准备好时，让它带着你的兴趣去打个招呼。' : '你可以随时回来，慢慢决定要不要开始。' : '先从几道简单的问题开始，做一张属于你的名片。'}</p></div><a class="text-button" href="${agent ? '#encounter' : '#agent'}">${agent ? '去会客厅' : '开始创建'} ${icon('arrow')}</a></div><div class="home-trail"><a href="#encounter"><span>01 / ENCOUNTER</span><strong>看看 Agent 聊了什么</strong></a><a href="#reports"><span>02 / CONNECTION NOTE</span><strong>读一份缘分小记</strong></a><a href="#inbox"><span>03 / SAY HELLO</span><strong>双方愿意，再打招呼</strong></a></div></section>`;
}
function chipGroup(key, values, selected) { return `<div class="chip-group" data-chip-group="${key}">${[...new Set([...values, ...(selected || [])])].map(value => `<button type="button" class="chip ${(selected || []).includes(value) ? 'selected' : ''}" aria-pressed="${(selected || []).includes(value)}" data-action="chip" data-value="${esc(value)}">${esc(value)}</button>`).join('')}</div>`; }
function agentPage() {
 const p = state.me.profile || {}, allowed = state.me.consent?.authorizedFields || ['interests', 'traits', 'friendshipGoal', 'boundaries'];
 return `${heading('先让 Agent 认识你。', '不需要完美介绍，真实的一点点就很好。', 'A SMALL PORTRAIT OF YOU')}<div class="content-grid"><form id="agent-form" class="card form-card"><h2>关于你的一点点</h2><p class="intro">带 * 的内容帮助 Agent 找到合适的聊天起点。</p><fieldset class="avatar-field"><legend>选一个小小头像</legend><input type="hidden" name="avatarKey" value="${avatarKey(p.avatarKey)}"><div class="avatar-options" role="radiogroup" aria-label="预设头像">${avatarOptions.map(option => `<button type="button" class="avatar-option ${avatarKey(p.avatarKey) === option.key ? 'selected' : ''}" data-action="avatar" data-avatar-key="${option.key}" role="radio" aria-checked="${avatarKey(p.avatarKey) === option.key}" aria-label="选择${option.label}头像"><span>${option.symbol}</span><small>${option.label}</small></button>`).join('')}</div><p class="avatar-help">头像与昵称用于展示，不作为模型推测的资料。</p></fieldset><div class="form-row"><label class="field"><span>昵称 *</span><input class="input" name="nickname" value="${esc(p.nickname)}" maxlength="20" required placeholder="在岛上怎么称呼你"></label><label class="field"><span>年龄段 *</span><select class="input" name="ageRange" required><option value="">请选择</option>${['18-24', '25-30', '31-40', '41+'].map(v => `<option ${p.ageRange === v || p.ageRange === v.replace('–', '-') ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div><div class="form-row"><label class="field"><span>城市 <small class="optional">选填</small></span><input class="input" name="city" value="${esc(p.city)}" maxlength="30" placeholder="仅填写城市"></label><label class="field"><span>MBTI <small class="optional">选填</small></span><select class="input" name="mbti"><option value="">不确定 / 不填写</option>${['INFP', 'INFJ', 'INTP', 'INTJ', 'ISFP', 'ISFJ', 'ISTP', 'ISTJ', 'ENFP', 'ENFJ', 'ENTP', 'ENTJ', 'ESFP', 'ESFJ', 'ESTP', 'ESTJ'].map(v => `<option ${p.mbti === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div><label class="check city-preference"><input type="checkbox" name="sameCityOnly" ${p.sameCityOnly === true ? 'checked' : ''}>仅匹配同城朋友</label><p class="avatar-help city-help">开启后需填写城市，并在下方授权使用城市资料；双方任一人开启，都会尊重这项偏好。</p><div class="field"><span>你喜欢把时间花在哪里？ *</span>${chipGroup('interests', interests, p.interests)}</div><div class="field"><span>哪些词，像你一点？ *</span>${chipGroup('traits', traits, p.traits)}</div><label class="field"><span>想认识怎样的朋友？ *</span><textarea class="input" name="friendshipGoal" required maxlength="150" placeholder="比如，可以分享游戏和音乐，不用每天聊天">${esc(p.friendshipGoal)}</textarea></label><label class="field"><span>希望被尊重的社交边界</span><textarea class="input" name="boundaries" maxlength="200" placeholder="比如，不催回复，不问联系方式">${esc(p.boundaries)}</textarea></label><label class="field"><span>再说一点自己 <small class="optional">选填，仅你可见</small></span><textarea class="input" name="bio" maxlength="500" placeholder="这段原始自我介绍不会交给对方 Agent">${esc(p.bio)}</textarea></label><hr class="section-break"><h2>由你决定，Agent 可以分享什么</h2><p class="intro">未勾选的字段不会用于 Agent 对话或报告。填写的边界需授权，才能在匹配中保护你的偏好。</p><div class="consent-grid">${Object.entries(fieldNames).map(([key, label]) => `<label class="check"><input type="checkbox" name="authorizedFields" value="${key}" ${allowed.includes(key) ? 'checked' : ''}>${label}</label>`).join('')}</div><label class="check"><input type="checkbox" name="adultConfirmed" required ${p.adultConfirmed ? 'checked' : ''}>我已年满 18 周岁，同意使用选定资料生成 Agent 档案及模拟交流。</label>${state.config.aiMode === 'model' ? '<div class="notice warm">所选授权资料会发送给生成与后台质检模型服务；质检过程不展示。</div>' : ''}<div class="notice">${icon('info')} 修改已授权资料后，已有匹配会结束。准备好后可重新开启匹配。</div><div class="form-actions"><button type="submit" class="primary">保存我的 Agent ${icon('check')}</button><a href="#home" class="muted">稍后再说</a></div></form><aside class="side-column"><div class="card side-info"><div class="empty-art">${icon('leaf')}</div><h3>只需要，像你自己。</h3><p>Agent 会认真记住你的兴趣、聊天节奏和边界。你随时可以回来修改。</p></div><div class="notice">${icon('shield')} 默认不公开真实姓名、精确位置、联系方式和原始自我介绍。</div></aside></div>`;
}
function matchPicker() { return state.matches.length < 2 ? '' : `<label class="field"><span class="optional">选择一次相遇</span><select id="match-picker" class="input">${state.matches.map(m => `<option value="${esc(m.id)}" ${currentMatch()?.id === m.id ? 'selected' : ''}>与 ${esc(m.other.nickname)} · ${esc(statuses[m.status])}</option>`).join('')}</select></label>`; }
function encounterPage() {
 const m = currentMatch(), head = heading('让小小分身，先聊一会儿。', '这是 Agent 之间的模拟交流，只依据双方授权的资料。', 'AGENT LOUNGE');
 if (!m) return head + empty('会客厅里，还空着一张椅子。', '让 Agent 带着你的兴趣去认识另一个小小分身。不催促，也不用你想开场白。');
 if (!m.transcript?.length) return head + empty('这次交流已结束。', '资料更新或授权撤回后，之前的交流内容不再展示。你可以开始一次新的相遇。');
 return `${head}<div class="encounter-layout">${matchPicker()}<div class="notice" data-ai-mode="${m.aiMode === 'model' ? 'model' : 'rules'}">${icon('info')} ${esc(modeLabel(m))} · 不是真人对话，也不代表双方作出任何承诺。</div><div class="pair"><div class="pair-person">${avatar(state.me.agent?.name || '我的 Agent', 'large mint', state.me.profile.avatarKey)}<h3>${esc(state.me.agent?.name || '我的 Agent')}</h3><p>代表 ${esc(state.me.profile.nickname)}</p></div><div class="pair-link">共同兴趣，让距离近一点</div><div class="pair-person">${avatar(m.other.nickname, 'large', m.other.avatarKey)}<h3>${esc(m.other.nickname)}的 Agent</h3><p>${state.config.demoMode ? '虚构演示用户' : '另一个小岛上的分身'}</p></div></div><section class="card transcript"><div class="round-marker">${Math.ceil(m.transcript.length / 2)} 轮模拟交流 · 已完成</div>${m.transcript.map((message, i) => `${i % 2 === 0 ? `<div class="round-marker">第 ${Math.floor(i / 2) + 1} 轮</div>` : ''}<div class="agent-message ${message.speaker === 'other' ? 'other' : ''}">${avatar(message.speaker === 'other' ? m.other.nickname : state.me.agent?.name, message.speaker === 'self' ? 'mint' : '', message.speaker === 'other' ? m.other.avatarKey : state.me.profile.avatarKey)}<div><div class="message-label">${message.speaker === 'other' ? esc(m.other.nickname) + '的 Agent' : '我的 Agent'}</div><div class="bubble">${esc(message.text)}</div></div></div>`).join('')}<div class="round-marker">小小分身的交流，到这里告一段落 ☘</div></section><div class="center-actions"><a class="primary" href="#reports">看看这次的缘分报告 ${icon('arrow')}</a></div></div>`;
}
function decisionArea(m) {
 if (m.status === 'connected') return `<h3>你们都愿意，故事可以开始了。</h3><p>没有必须完美的第一句话，按自己的节奏就好。</p><div class="center-actions"><button class="primary" data-action="open-chat" data-id="${esc(m.id)}">去打个招呼 ${icon('chat')}</button></div>`;
 if (['closed', 'declined'].includes(m.status)) return `<h3>${m.status === 'declined' ? '没关系，相遇不需要勉强。' : '这次相遇已结束。'}</h3><p>每个人都有自己的节奏。下一次，也许会遇见更合拍的人。</p><div class="center-actions"><button class="primary" data-action="start-match">让 Agent 再去看看 ${icon('arrow')}</button></div>`;
 if (m.selfDecision === 'accept') return `<h3>心意已送达，给相遇一点时间。</h3><p>对方也愿意认识你后，这里会开放真人聊天。</p><span class="status-chip">${esc(statuses[m.status])}</span><div class="center-actions"><button class="secondary" data-action="refresh-match">${icon('clock')} 刷新状态</button>${state.config.demoMode ? '<button class="secondary" data-action="switch-persona">切换演示身份体验另一方</button>' : ''}</div><p>你随时可以在下方结束这次相遇。</p>`;
 return '<h3>有一点想认识 TA 吗？</h3><p>只有你们都愿意，才会开启真人聊天。晚一点决定也没关系。</p><div class="center-actions"><button class="primary" data-action="accept">想认识 TA</button><button class="secondary" data-action="decline">这次先不了</button></div>';
}
function reportPage() {
 const m = currentMatch(), head = heading('发现一点，想继续了解的可能。', '合拍的地方值得开心，不同的地方也值得慢慢认识。', 'A NOTE ABOUT YOUR CONNECTION');
 if (!m) return head + empty('缘分报告，还在等一次相遇。', '两个 Agent 聊过之后，这里会留下一份关于共同点、差异与聊天话题的小报告。');
 if (!m.report || !m.transcript?.length) return head + empty('这份报告已随相遇一起结束。', '你的资料和授权发生变化后，旧报告会被清除。我们从新的认识开始。');
 const r = m.report;
 return `${head}<div class="encounter-layout">${matchPicker()}<div class="card report-header"><div class="eyebrow">A LITTLE CONNECTION</div><div class="pair"><div class="pair-person">${avatar(state.me.profile.nickname, 'large mint', state.me.profile.avatarKey)}<h3>${esc(state.me.profile.nickname)}</h3></div><div class="pair-link">${icon('leaf')}</div><div class="pair-person">${avatar(m.other.nickname, 'large', m.other.avatarKey)}<h3>${esc(m.other.nickname)}</h3></div></div><h2>你们之间，有些小小的共鸣。</h2><p data-ai-mode="${m.aiMode === 'model' ? 'model' : 'rules'}">${state.config.demoMode ? '虚构演示用户 · ' : ''}${esc(modeLabel(m))}报告 · 仅供进一步了解时参考</p></div><div class="report-grid"><article class="card report-item"><h3>${icon('leaf')} 共同喜欢的事</h3>${r.commonInterests?.length ? tags(r.commonInterests) : '<p>共同兴趣还需要在真实聊天中探索。</p>'}</article><article class="card report-item"><h3>${icon('sun')} 可能的相处方式</h3><p>${esc(r.compatibility)}</p></article><article class="card report-item"><h3>${icon('settings')} 留一点空间给差异</h3><p>${esc(r.differences)}</p></article><article class="card report-item"><h3>${icon('chat')} 聊天可以从这里开始</h3>${(r.topics || []).map(t => `<div class="topic-item">${esc(t)}</div>`).join('')}</article></div><div class="notice warm">${icon('info')} 以上是根据授权资料生成的推测，不是真实双方交流，也不保证一定合适。</div><section class="card decision-card">${decisionArea(m)}</section><div class="center-actions"><a class="text-button" href="#encounter">回看 Agent 对话</a><span class="muted">·</span><button class="text-button" data-action="match-tools">${icon('shield')} 相遇管理</button></div></div>`;
}
function chatStream() { return state.messages.length ? state.messages.map(msg => `<div class="human-message ${msg.mine ? 'mine' : ''}"><div><div class="bubble">${esc(msg.text)}</div><time>${esc(new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))}</time></div></div>`).join('') : `<div class="chat-empty">${icon('leaf')}<br>从一句简单的问候开始。<br>${state.config.demoMode ? '浏览器演示不会自动生成真人回复。' : '无需立即回复，按你的节奏就好。'}</div>`; }
function inboxPage() {
 const connected = state.matches.filter(m => m.status === 'connected'), m = connected.find(m => m.id === state.activeId) || connected[0];
 const head = heading('真实的认识，从这里开始。', '无需随时在线，也不必急着回复。', 'MESSAGES, AT YOUR OWN PACE');
 if (!m) return head + empty('还没有需要你开口的对话。', '等你和对方都确认想认识，这里才会开启真人聊天。先去看看 Agent 发现了什么吧。', 'go-reports', '看看缘分报告', 'chat');
 state.activeId = m.id;
 return `${head}<div class="card inbox-layout"><aside class="match-list"><h2>我的相遇 <span class="optional">${connected.length}</span></h2>${connected.map(item => `<button class="match-row ${item.id === m.id ? 'selected' : ''}" data-action="select-chat" data-id="${esc(item.id)}">${avatar(item.other.nickname, '', item.other.avatarKey)}<span><strong>${esc(item.other.nickname)}</strong><small>双方已同意 · 可以慢慢聊</small></span></button>`).join('')}</aside><section class="chat-panel"><header class="chat-head"><div><h3>${esc(m.other.nickname)}</h3><p>${state.config.demoMode ? '虚构演示用户 · 可切换身份回复' : '彼此尊重，不催回复'}</p></div><button class="subtle-button" data-action="match-tools" aria-label="聊天管理">${icon('settings')} 管理</button></header><div id="chat-stream" class="chat-stream" aria-live="polite">${chatStream()}</div><form id="chat-form" class="chat-compose"><button type="button" class="text-button" data-action="icebreaker">${icon('spark')} 帮我想个开场白</button><div class="suggestions">${state.suggestions.map((s, i) => `<button type="button" class="suggestion" data-action="suggestion" data-index="${i}">${esc(s)}</button>`).join('')}</div><div class="compose-row"><textarea class="input" id="chat-text" name="text" maxlength="1000" rows="1" placeholder="说点什么，慢慢来…" aria-label="聊天消息">${esc(state.draft)}</textarea><button type="button" class="text-button" data-action="emoji" aria-label="添加笑脸">${icon('smile')}</button><button class="primary" type="submit" aria-label="发送消息">发送 ${icon('send')}</button></div><p class="muted" style="font-size:14px;margin-top:7px">破冰建议只会填入输入框，发送由你决定。</p></form></section></div>`;
}
function profilePage() {
 const p = state.me.profile, agent = p.adultConfirmed && p.interests.length ? state.me.agent : null;
 return `${heading('你的小岛，由你做主。', '随时调整分身的资料，也随时为自己留一点安静。', 'YOUR AGENT, YOUR BOUNDARIES')}<div class="content-grid"><div><section class="card"><div class="profile-banner">${avatar(p.nickname, 'large mint', p.avatarKey)}<div><h2>${esc(p.nickname || '新岛民')}</h2><p data-ai-mode="${agent?.aiMode === 'model' ? 'model' : 'rules'}">${agent ? `${esc(agent.name)}，是你的小小分身 · ${esc(modeLabel(agent))}` : '你的小小分身还在等待诞生'}</p></div></div><p class="agent-copy">${esc(agent?.summary || '先从几个轻松的问题开始，让 Agent 认识你。')}</p>${tags(p.interests)}<div class="form-actions"><a href="#agent" class="primary">${icon('edit')} ${agent ? '编辑我的 Agent' : '创建我的 Agent'}</a></div></section><div class="section-title"><h2>隐私与账号</h2></div><section class="card settings-list"><div class="settings-row"><div><h3>允许 Agent 参与匹配</h3><p>${state.me.matchingEnabled ? 'Agent 只会使用你授权的资料。' : '暂停后不产生新的相遇，已有聊天可继续。'}</p></div><button class="switch ${state.me.matchingEnabled ? 'on' : ''}" data-action="toggle-matching" role="switch" aria-checked="${state.me.matchingEnabled}" aria-label="允许参与匹配"></button></div><div class="settings-row"><div><h3>已授权的信息</h3><p>${(state.me.consent?.authorizedFields || []).map(k => fieldNames[k] || k).map(esc).join('、') || '还没有授权资料'}</p></div><a class="text-button" href="#agent">管理 ${icon('chevron')}</a></div><div class="settings-row"><div><h3>删除账号与个人数据</h3><p>删除 Agent、匹配记录和聊天消息。</p></div><button class="secondary danger" data-action="delete-account">删除数据</button></div></section></div><aside class="side-column"><div class="card side-info"><h3>${icon('shield')} 让边界被认真对待</h3><p>双向同意前，任何人都不能直接向你发送真人消息。</p><p>你可以在每次相遇中举报、拉黑或解除匹配。这些功能始终免费。</p></div>${state.config.demoMode ? '<div class="notice warm">当前使用虚构样例。切换演示身份可体验双方确认和聊天；每份报告标记该次实际生成方式。</div>' : ''}</aside></div>`;
}
function render() {
 if (!state.me) return;
 const pages = { home: homePage, agent: agentPage, encounter: encounterPage, reports: reportPage, inbox: inboxPage, profile: profilePage };
 state.route = (location.hash || '#home').slice(1); if (!pages[state.route]) state.route = 'home';
 $('#app').innerHTML = shell(pages[state.route]());
 syncBusyControls();
 if (state.route === 'inbox') loadMessages().catch(error => toast(error.message));
}
let previousFocus;
function modal(title, content) {
 previousFocus = document.activeElement;
 $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-modal" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div>${content}</section></div>`;
 document.body.classList.add('no-scroll'); setTimeout(() => $('#modal-root button, #modal-root input, #modal-root select')?.focus(), 30);
 syncBusyControls();
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.classList.remove('no-scroll'); if (previousFocus?.isConnected) previousFocus.focus(); }
function switchModal() { modal('换个视角，体验一次相遇。', `<p>下面都是虚构的浏览器演示身份。双方意向和消息需要你分别操作，不会自动代替对方确认。</p>${[['lin', '小林', '喜欢游戏、音乐与电影的小岛民'], ['momo', '木木', '另一位演示岛民，亲自体验对方视角'], ['new', '新岛民', '从空白档案开始创建你的 Agent']].map(([id, name, copy]) => `<button class="persona-option" data-action="persona" data-persona="${id}">${avatar(name, id === 'lin' ? 'mint' : '')}<span><strong>${name}</strong><small>${copy}</small></span>${icon('arrow')}</button>`).join('')}`); }
async function startMatch() {
 if (!canStartMatching(state.me)) { navigate('agent'); toast('请先确认成年并授权兴趣或交友期待，再开始匹配'); return; }
 const names = (state.me.consent?.authorizedFields || []).map(k => fieldNames[k] || k);
 const reviewNote = state.config.aiMode === 'model' ? '<p class="muted">本次授权资料会发送给生成与后台质检模型服务；你只会看到简短结果。</p>' : '';
 modal('让 Agent 带着这些资料出发。', `<p>只使用你选定的信息参与匹配与模拟交流。对话最多 3 轮，双方真人都同意后才开放聊天。</p>${reviewNote}${tags(names)}<label class="check" style="margin-top:20px"><input type="checkbox" id="match-consent">我同意使用以上资料参与本次 Agent 匹配与交流。</label><div class="notice warm">本次默认使用 ${esc(modeLabel(state.config))}${state.config.demoMode ? ' · 匹配对象为虚构演示用户' : ''}。生成时请稍候，完成后会显示实际结果。</div><button class="primary" data-action="confirm-match">准备好了，让 Agent 出发 ${icon('arrow')}</button>`);
}
async function loadMessages() {
 const m = currentMatch(); if (!m || m.status !== 'connected' || state.route !== 'inbox') return;
 const epoch = state.epoch, token = state.token; const data = await api(`/matches/${encodeURIComponent(m.id)}/messages`); if (epoch !== state.epoch || token !== state.token || currentMatch()?.id !== m.id) return;
 state.messages = data.messages;
 const stream = $('#chat-stream'); if (stream) { const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100; const next = chatStream(); if (stream.innerHTML !== next) { stream.innerHTML = next; if (nearBottom) stream.scrollTop = stream.scrollHeight; } }
}
function rememberMatch(match, activate = true) { const index = state.matches.findIndex(m => m.id === match.id); if (index < 0) state.matches.unshift(match); else state.matches[index] = match; if (activate) state.activeId = match.id; }
function matchTools() { if (!currentMatch()) return; modal('相遇管理', '<p>按自己的感受做决定。对方不会得到你的举报理由。</p><div class="center-actions" style="justify-content:flex-start"><button class="secondary" data-action="report-user">举报</button><button class="secondary" data-action="confirm-close">结束这次相遇</button><button class="secondary danger" data-action="confirm-block">拉黑对方</button></div>'); }
const actions = {
 'close-modal': closeModal,
 'dismiss-activity': () => showActivity(),
 'view-result': el => { state.activeId = el.dataset.id; showActivity(); navigate('reports'); },
 'how': () => modal('认识的第一步，可以很轻。', `<div class="step"><span class="step-number">01</span><div><h3>创建你的小小分身</h3><p>填写兴趣与边界，选择可以分享的资料。</p></div></div><div class="step"><span class="step-number">02</span><div><h3>让两个 Agent 先交流</h3><p>最多三轮模拟交流，生成共同点与差异报告。</p></div></div><div class="step"><span class="step-number">03</span><div><h3>双方愿意，才开始真人聊天</h3><p>你始终决定要不要认识，也随时可以离开。</p></div></div><div class="notice warm">${state.config.demoMode ? '当前为虚构用户的浏览器演示。' : ''}当前默认 ${esc(modeLabel(state.config))}；报告标记每次实际生成方式，不是真人对话。</div>`),
 'switch-persona': switchModal, 'persona': el => session(el.dataset.persona), 'profile': () => navigate('profile'), 'edit-agent': () => navigate('agent'), 'go-reports': () => navigate('reports'), 'start-match': startMatch,
 'chip': el => { el.classList.toggle('selected'); el.setAttribute('aria-pressed', String(el.classList.contains('selected'))); },
 'avatar': el => { const form = el.closest('form'); $('[name=avatarKey]', form).value = avatarKey(el.dataset.avatarKey); form.querySelectorAll('[data-avatar-key]').forEach(option => { const selected = option === el; option.classList.toggle('selected', selected); option.setAttribute('aria-checked', String(selected)); }); },
 'confirm-match': async el => {
  if (!$('#match-consent')?.checked) { toast('请先确认本次资料使用授权'); return; }
  const origin = location.hash;
  el.setAttribute('aria-busy', 'true'); el.innerHTML = '<span class="loading-dot"></span>Agent 正在交流，请稍候…';
  showActivity('Agent 正在整理这次相遇…', '', true);
  try {
   state.me = await api('/me/matching', { method: 'POST', body: { enabled: true } });
   if (['home', 'profile'].includes(state.route)) render();
   const { match } = await api('/matches', { method: 'POST' }); rememberMatch(match, location.hash === origin); closeModal();
   if (location.hash === origin) { showActivity(); navigate('reports'); toast('报告准备好了，按自己的感受决定'); }
   else showActivity('这次相遇的报告准备好了。', match.id);
  } catch (error) { showActivity(error.message); throw error; }
 },
 'toggle-matching': async () => { const enabled = !state.me.matchingEnabled; await api('/me/matching', { method: 'POST', body: { enabled } }); await refresh(); render(); toast(enabled ? 'Agent 已准备好参与匹配' : '已暂停新的匹配，好好休息一下'); },
 'accept': async () => { const { match } = await api(`/matches/${currentMatch().id}/decision`, { method: 'POST', body: { decision: 'accept' } }); rememberMatch(match); render(); toast(match.status === 'connected' ? '你们都愿意认识，可以开始聊天了' : '心意已送达，等待对方也点头'); },
 'decline': () => modal('这次先说再见？', '<p>相遇不需要勉强。确认后，本次匹配将结束。</p><button class="primary" data-action="do-decline">确认，暂不认识</button>'),
 'do-decline': async () => { const { match } = await api(`/matches/${currentMatch().id}/decision`, { method: 'POST', body: { decision: 'decline' } }); rememberMatch(match); closeModal(); render(); toast('已结束这次相遇'); },
 'refresh-match': async () => { await refresh(); render(); toast('状态已更新'); },
 'open-chat': async el => { state.activeId = el.dataset.id; state.messages = []; state.suggestions = []; state.draft = ''; navigate('inbox'); },
 'select-chat': async el => { state.activeId = el.dataset.id; state.messages = []; state.suggestions = []; state.draft = ''; render(); },
 'icebreaker': async () => { const data = await api(`/matches/${currentMatch().id}/icebreaker`, { method: 'POST' }); state.suggestions = data.suggestions; render(); },
 'suggestion': el => { state.draft = state.suggestions[Number(el.dataset.index)] || ''; $('#chat-text').value = state.draft; $('#chat-text').focus(); },
 'emoji': () => { state.draft = ($('#chat-text')?.value || '') + '🙂'; $('#chat-text').value = state.draft; $('#chat-text').focus(); },
 'match-tools': matchTools,
 'report-user': () => modal('告诉我们发生了什么。', '<p>这是演示举报，记录仅保存在当前标签页。请不要填写真实个人信息。</p><form id="report-form"><label class="field"><span>举报原因</span><select class="input" name="reason"><option>骚扰或不尊重边界</option><option>冒用身份或虚假资料</option><option>不适当内容</option><option>其他问题</option></select></label><button class="primary" type="submit">提交举报</button></form>'),
 'confirm-close': () => modal('结束这次相遇？', '<p>确认后，你们无法再通过本次匹配发送消息。</p><button class="primary" data-action="do-close">确认结束相遇</button>'),
 'do-close': async () => { await api(`/matches/${currentMatch().id}/close`, { method: 'POST' }); await refresh(); closeModal(); render(); toast('相遇已结束'); },
 'confirm-block': () => modal('拉黑这位岛民？', '<p>确认后，你们无法继续聊天，也不会再次匹配。</p><button class="primary" data-action="do-block">确认拉黑</button>'),
 'do-block': async () => { await api(`/matches/${currentMatch().id}/block`, { method: 'POST' }); await refresh(); state.messages = []; closeModal(); render(); toast('已拉黑，对方无法再联系你'); },
 'delete-account': () => modal('删除你在岛上的数据？', '<p>这会删除个人资料、Agent、匹配记录与聊天消息，删除后无法恢复。</p><label class="check"><input id="delete-confirm" type="checkbox">我确认删除账号与个人数据。</label><button class="primary" data-action="do-delete">确认删除我的数据</button>'),
 'do-delete': async () => { if (!$('#delete-confirm')?.checked) return toast('请先确认删除'); state.epoch++; await api('/me', { method: 'DELETE' }); state.me = null; state.token = ''; state.matches = []; state.messages = []; sessionStorage.removeItem('i-island-session'); closeModal(); $('#app').innerHTML = `<div class="boot"><div class="brand-symbol">i</div><p>你的账号与个人数据已删除。</p>${state.config.demoMode ? '<button class="primary" data-action="switch-persona">返回演示身份选择</button>' : ''}</div>`; }
};
document.addEventListener('click', async event => {
 const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
 if (el.dataset.action === 'close-modal') { closeModal(); return; }
 if (state.busy) return;
 const fn = actions[el.dataset.action]; if (!fn) return;
 const original = el.innerHTML;
 try { state.busy = true; el.disabled = true; syncBusyControls(); await fn(el); }
 catch (error) { toast(error.message); }
 finally { state.busy = false; el.disabled = false; syncBusyControls(); el.removeAttribute('aria-busy'); if (el.isConnected && el.dataset.action === 'confirm-match') el.innerHTML = original; }
});
document.addEventListener('submit', async event => {
 if (!['agent-form', 'chat-form', 'report-form'].includes(event.target.id)) return;
 event.preventDefault(); if (state.busy) return;
 const form = event.target, button = $('button[type="submit"]', form), fd = new FormData(form), original = button?.innerHTML; state.busy = true; if (button) button.disabled = true;
 syncBusyControls();
 try {
  if (form.id === 'agent-form') {
   const chosen = key => [...form.querySelectorAll(`[data-chip-group="${key}"] .selected`)].map(el => el.dataset.value);
   const body = profileSubmission(fd, { interests: chosen('interests'), traits: chosen('traits') });
   if (!body.interests.length || !body.traits.length) throw new Error('选几个兴趣和性格词，让 Agent 更像你一点');
   if (body.boundaries.trim() && !body.authorizedFields.includes('boundaries')) throw new Error('填写的社交边界需要授权，才能在匹配时受到尊重');
   if (button) { button.setAttribute('aria-busy', 'true'); button.innerHTML = '<span class="loading-dot"></span>正在生成 Agent，请稍候…'; }
   const origin = location.hash;
   showActivity('正在整理你的 Agent…', '', true);
   state.me = await api('/me', { method: 'PUT', body }); await refresh();
   if (location.hash === origin) { showActivity(); navigate('home'); }
   else showActivity('Agent 档案已保存。');
   toast('Agent 档案已保存，准备好时再让它出发');
  } else if (form.id === 'chat-form') {
   const text = String(fd.get('text') || '').trim(); if (!text) return;
   await api(`/matches/${currentMatch().id}/messages`, { method: 'POST', body: { text } }); state.draft = ''; $('#chat-text').value = ''; await loadMessages(); const stream = $('#chat-stream'); if (stream) stream.scrollTop = stream.scrollHeight;
  } else { await api(`/matches/${currentMatch().id}/report`, { method: 'POST', body: { reason: fd.get('reason') } }); closeModal(); toast('演示举报已保存'); }
 } catch (error) { if (form.id === 'agent-form') showActivity(error.message); toast(error.message); }
 finally { state.busy = false; syncBusyControls(); if (button) { button.disabled = false; button.removeAttribute('aria-busy'); if (button.isConnected) button.innerHTML = original; } }
});
document.addEventListener('input', event => { if (event.target.id === 'chat-text') state.draft = event.target.value; });
document.addEventListener('change', event => { if (event.target.id === 'match-picker') { state.activeId = event.target.value; render(); } });
document.addEventListener('keydown', event => {
 if (event.key === 'Escape') closeModal();
 if ($('#modal-root').children.length && event.key === 'Tab') { const focusable = [...$('#modal-root').querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled); if (!focusable.length) return; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
 if (event.target.id === 'chat-text' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form.requestSubmit(); }
});
window.addEventListener('hashchange', () => { state.suggestions = []; render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
async function poll() {
 if (!state.me || state.busy || document.hidden || $('#modal-root').children.length || !['reports', 'inbox', 'encounter'].includes(state.route)) return;
 const m = currentMatch(); if (!m || ['closed', 'declined'].includes(m.status)) return;
 const epoch = state.epoch, token = state.token; try { const { match } = await api(`/matches/${m.id}`); if (epoch !== state.epoch || token !== state.token) return; const changed = match.status !== m.status || match.otherDecision !== m.otherDecision; rememberMatch(match); if (changed) { state.messages = []; render(); } else if (state.route === 'inbox') await loadMessages(); }
 catch { /* Explicit actions surface errors; background polls leave the current view intact. */ }
}
async function boot() {
 try {
  state.config = await api('/config');
  const saved = JSON.parse(sessionStorage.getItem('i-island-session') || 'null');
  if (saved?.token) { state.token = saved.token; state.persona = saved.persona; try { await refresh(); render(); return; } catch { state.token = ''; sessionStorage.removeItem('i-island-session'); } }
  if (state.config.demoMode) $('#app').innerHTML = "<div class=\"boot\"><div class=\"brand-symbol\">i</div><h1>欢迎来到 I岛</h1><p>使用虚构身份体验。请填写虚构资料，体验记录仅保存在当前标签页。</p><button class=\"primary\" data-action=\"persona\" data-persona=\"lin\">以小林身份进入</button><button class=\"secondary\" data-action=\"persona\" data-persona=\"new\">从空白档案开始</button></div>";
  else $('#app').innerHTML = '<div class="boot"><div class="brand-symbol">i</div><p>请使用微信小程序登录你的小岛。</p></div>';
 } catch (error) { $('#app').innerHTML = `<div class="boot"><div class="brand-symbol">i</div><p>${esc(error.message)}</p><button class="primary" id="retry-boot">重新连接</button></div>`; $('#retry-boot')?.addEventListener('click', boot); }
}
await boot();
setInterval(poll, 4000);
