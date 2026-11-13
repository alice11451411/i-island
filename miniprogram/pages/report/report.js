const { request, statusLabel } = require('../../utils/api');
const { avatarSymbol, generationLabel } = require('../../utils/profile');
Page({
  data: { id: '', loading: true, busy: false, error: '', match: null },
  onLoad(query) { this.setData({ id: query.id || getApp().globalData.lastMatchId || '' }); },
  onShow() { this.load(); this.stopPolling(); this._poll = setInterval(() => { if (!this.data.busy && this.data.id) this.refreshQuietly(); }, 5000); },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },
  stopPolling() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      let id = this.data.id;
      if (!id) { const list = await request('/api/matches'); if (list.matches.length) id = list.matches[0].id; }
      if (!id) return this.setData({ loading: false });
      this.setData({ id });
      await this.refreshQuietly();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  async refreshQuietly() {
    try {
      const { match } = await request('/api/matches/' + encodeURIComponent(this.data.id));
      match.statusText = statusLabel(match.status); match.modeLabel = generationLabel(match); match.other.avatarSymbol = avatarSymbol(match.other.avatarKey);
      this.setData({ match, error: '' });
    } catch (error) { this.setData({ error: error.message }); }
  },
  async decide(event) {
    if (this.data.busy) return;
    const decision = event.currentTarget.dataset.decision;
    if (decision === 'decline') {
      const answer = await new Promise(resolve => wx.showModal({ title: '这次先到这里？', content: '结束后，这次相遇将不再开放真人聊天。按自己的节奏就好。', confirmText: '结束相遇', confirmColor: '#a37560', success: resolve }));
      if (!answer.confirm) return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const { match } = await request('/api/matches/' + encodeURIComponent(this.data.id) + '/decision', 'POST', { decision });
      match.statusText = statusLabel(match.status); match.modeLabel = generationLabel(match); match.other.avatarSymbol = avatarSymbol(match.other.avatarKey);
      this.setData({ match });
      if (match.status === 'connected') wx.showToast({ title: '你们都愿意认识', icon: 'none' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  chat() { if (this.data.match && this.data.match.status === 'connected') wx.reLaunch({ url: '/pages/inbox/inbox?id=' + encodeURIComponent(this.data.id) }); },
  conversation() { wx.navigateTo({ url: '/pages/encounter/encounter?id=' + encodeURIComponent(this.data.id) }); },
  home() { wx.reLaunch({ url: '/pages/home/home' }); }
});