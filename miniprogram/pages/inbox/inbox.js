const { request, statusLabel, formatTime } = require('../../utils/api');
const { avatarSymbol, generationLabel } = require('../../utils/profile');
Page({
  data: { section: 'messages', loading: true, busy: false, error: '', me: null, matches: [], selected: null, messages: [], draft: '', suggestions: [], demoMode: false, personaLabel: '', scrollId: '', ownAvatar: '🌱', agentModeLabel: '规则模拟' },
  onLoad(query) { this.setData({ section: query.section === 'me' ? 'me' : 'messages' }); this._requestedId = query.id || ''; },
  onShow() { this.load(); this.startPolling(); },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); this._epoch = (this._epoch || 0) + 1; },
  startPolling() {
    this.stopPolling();
    this._poll = setInterval(() => { if (this.data.selected && !this.data.busy && !this._checkingStatus) this.refreshMatchState(); }, 5000);
  },
  stopPolling() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },
  async load() {
    const epoch = (this._epoch || 0) + 1;
    this._epoch = epoch;
    this.setData({ loading: true, error: '' });
    try {
      const [me, list] = await Promise.all([request('/api/me'), request('/api/matches')]);
      if (this._epoch !== epoch) return;
      const matches = list.matches.map(match => Object.assign({}, match, { statusText: statusLabel(match.status), other: Object.assign({}, match.other, { avatarSymbol: avatarSymbol(match.other.avatarKey) }) }));
      const app = getApp();
      const id = this._requestedId || (this.data.selected && this.data.selected.id);
      const selected = id ? matches.find(match => match.id === id && match.status === 'connected') || null : null;
      this._requestedId = '';
      this.setData({ me, matches, selected, ownAvatar: avatarSymbol(me.profile.avatarKey), agentModeLabel: generationLabel(me.agent), demoMode: app.globalData.demoMode, personaLabel: { lin: '小林', momo: '木木', new: '新用户' }[app.globalData.persona] || '演示用户', loading: false });
      if (selected) this.loadMessages();
    } catch (error) { if (this._epoch === epoch) this.setData({ error: error.message, loading: false }); }
  },
  changeSection(event) { this.setData({ section: event.currentTarget.dataset.section, error: '' }); },
  async selectMatch(event) {
    const match = this.data.matches.find(item => item.id === event.currentTarget.dataset.id);
    if (!match) return;
    if (match.status !== 'connected') return wx.navigateTo({ url: '/pages/report/report?id=' + encodeURIComponent(match.id) });
    this.setData({ selected: match, messages: [], suggestions: [], draft: '', error: '' });
    await this.loadMessages();
  },
  async loadMessages() {
    const selected = this.data.selected;
    if (!selected || selected.status !== 'connected') return;
    const epoch = this._epoch;
    try {
      const data = await request('/api/matches/' + encodeURIComponent(selected.id) + '/messages');
      if (this._epoch !== epoch || !this.data.selected || this.data.selected.id !== selected.id) return;
      const messages = data.messages.map(message => Object.assign({}, message, { time: formatTime(message.createdAt) }));
      this.setData({ messages, scrollId: messages.length ? 'message-' + messages[messages.length - 1].id : '', error: '' });
    } catch (error) {
      if (this._epoch === epoch) this.setData({ error: error.message });
    }
  },
  async refreshMatchState() {
    const selected = this.data.selected;
    if (!selected || this._checkingStatus) return;
    const epoch = this._epoch;
    this._checkingStatus = true;
    try {
      const { match } = await request('/api/matches/' + encodeURIComponent(selected.id));
      if (this._epoch !== epoch || !this.data.selected || this.data.selected.id !== selected.id) return;
      const matches = this.data.matches.map(item => item.id === match.id ? Object.assign({}, item, { status: match.status, statusText: statusLabel(match.status) }) : item);
      if (match.status !== 'connected') {
        this.setData({ matches, selected: null, messages: [], draft: '', suggestions: [], scrollId: '', error: '' });
        return;
      }
      this.setData({ matches, selected: Object.assign({}, selected, { status: match.status, statusText: statusLabel(match.status) }) });
      await this.loadMessages();
    } catch (error) {
      if (this._epoch === epoch) this.setData({ error: error.message });
    } finally { this._checkingStatus = false; }
  },
  closeChat() { this.setData({ selected: null, messages: [], draft: '', suggestions: [], error: '' }); this.load(); },
  inputDraft(event) { this.setData({ draft: event.detail.value }); },
  async send() {
    if (this.data.busy || !this.data.selected || this.data.selected.status !== 'connected') return;
    const text = this.data.draft.trim();
    if (!text) return;
    this.setData({ busy: true, error: '' });
    try {
      await request('/api/matches/' + encodeURIComponent(this.data.selected.id) + '/messages', 'POST', { text });
      this.setData({ draft: '', suggestions: [] });
      await this.loadMessages();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  async icebreaker() {
    if (this.data.busy || !this.data.selected) return;
    try {
      const data = await request('/api/matches/' + encodeURIComponent(this.data.selected.id) + '/icebreaker', 'POST');
      this.setData({ suggestions: data.suggestions });
    } catch (error) { this.setData({ error: error.message }); }
  },
  chooseSuggestion(event) { this.setData({ draft: event.currentTarget.dataset.text, suggestions: [] }); },
  emoji() { if (!this.data.busy) this.setData({ draft: this.data.draft + ' 😊' }); },
  async chatMenu() {
    if (!this.data.selected || this.data.busy) return;
    const result = await new Promise(resolve => wx.showActionSheet({ itemList: ['举报不当内容', '解除匹配', '拉黑并结束联系'], success: resolve, fail: () => resolve(null) }));
    if (!result) return;
    if (result.tapIndex === 0) {
      const reason = await new Promise(resolve => wx.showModal({ title: '举报不当内容', editable: true, placeholderText: '请描述你遇到的问题（最多 200 字）', confirmText: '提交举报', success: resolve }));
      if (!reason.confirm) return;
      const text = (reason.content || '').trim();
      if (!text) return wx.showToast({ title: '请填写举报原因', icon: 'none' });
      try {
        await request('/api/matches/' + encodeURIComponent(this.data.selected.id) + '/report', 'POST', { reason: text.slice(0, 200) });
        wx.showToast({ title: '举报已提交', icon: 'none' });
      } catch (error) { this.setData({ error: error.message }); }
      return;
    }
    const block = result.tapIndex === 2;
    const answer = await new Promise(resolve => wx.showModal({ title: block ? '拉黑这位用户？' : '解除这次匹配？', content: block ? '将结束当前联系，并阻止再次匹配。' : '将结束当前联系，双方都不能继续发送消息。', confirmText: block ? '确认拉黑' : '解除匹配', confirmColor: '#a37560', success: resolve }));
    if (!answer.confirm) return;
    this.setData({ busy: true });
    try {
      await request('/api/matches/' + encodeURIComponent(this.data.selected.id) + (block ? '/block' : '/close'), 'POST');
      this.setData({ selected: null, messages: [], draft: '', suggestions: [] });
      await this.load();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  editAgent() { wx.navigateTo({ url: '/pages/agent/agent' }); },
  async toggleMatching() {
    if (!this.data.me || this.data.busy) return;
    if (!this.data.me.matchingEnabled) {
      const answer = await new Promise(resolve => wx.showModal({ title: '重新开启匹配？', content: 'Agent 将按你最近选择的授权字段参与匹配。你可以在编辑 Agent 中检查与调整这些资料。', confirmText: '同意开启', confirmColor: '#496f54', success: resolve }));
      if (!answer.confirm) return;
    }
    try {
      const me = await request('/api/me/matching', 'POST', { enabled: !this.data.me.matchingEnabled });
      this.setData({ me });
    } catch (error) { this.setData({ error: error.message }); }
  },
  async switchPersona() {
    if (!this.data.demoMode || this.data.busy) return;
    const answer = await new Promise(resolve => wx.showActionSheet({ itemList: ['小林（虚构用户）', '木木（虚构用户）', '新用户（从创建开始）'], success: resolve, fail: () => resolve(null) }));
    if (!answer) return;
    this._epoch = (this._epoch || 0) + 1;
    this.setData({ busy: true, selected: null, messages: [], matches: [], me: null, draft: '', suggestions: [], error: '' });
    try {
      await getApp().switchPersona(['lin', 'momo', 'new'][answer.tapIndex]);
      await this.load();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  async deleteAccount() {
    if (this.data.busy) return;
    const answer = await new Promise(resolve => wx.showModal({ title: '删除账号与个人数据？', content: '将撤回 Agent 资料、结束所有匹配并删除你的聊天内容。此操作不可撤销。', confirmText: '删除数据', confirmColor: '#a37560', success: resolve }));
    if (!answer.confirm) return;
    this.setData({ busy: true });
    try {
      await request('/api/me', 'DELETE');
      this._epoch = (this._epoch || 0) + 1;
      getApp().globalData.token = '';
      if (getApp().globalData.demoMode) getApp().globalData.persona = 'new';
      this.setData({ selected: null, me: null, messages: [], matches: [] });
      wx.showModal({ title: '数据已删除', content: '你的 Agent 与当前联系已结束。', showCancel: false, success: () => wx.reLaunch({ url: '/pages/home/home' }) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  privacy() { wx.showModal({ title: '你决定分享多少', content: '仅勾选授权的资料用于 Agent 模拟交流；昵称用作展示称呼。原始简介、联系方式和精确位置不参与交换。你可以编辑授权、暂停匹配、解除联系或删除账号。基础聊天、隐私和安全入口免费。', showCancel: false }); }
});
