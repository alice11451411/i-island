const { request, statusLabel } = require('../../utils/api');
const { avatarSymbol, generationLabel, canStartMatching } = require('../../utils/profile');
Page({
  data: { loading: true, busy: false, error: '', me: null, latest: null, demoMode: false, ownAvatar: '🌱', agentModeLabel: '规则模拟', defaultModeLabel: '规则模拟' },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [me, result] = await Promise.all([request('/api/me'), request('/api/matches')]);
      const latest = result.matches[0] || null;
      if (latest) { latest.statusText = statusLabel(latest.status); latest.other.avatarSymbol = avatarSymbol(latest.other.avatarKey); }
      this.setData({ me, latest, loading: false, demoMode: getApp().globalData.demoMode, ownAvatar: avatarSymbol(me.profile.avatarKey), agentModeLabel: generationLabel(me.agent), defaultModeLabel: generationLabel(getApp().globalData) });
    } catch (error) { this.setData({ error: error.message, loading: false }); }
  },
  editAgent() { wx.navigateTo({ url: '/pages/agent/agent' }); },
  async startMatch() {
    if (this.data.busy) return;
    if (!this.data.me || !this.data.me.agent || !canStartMatching(this.data.me)) return this.editAgent();
    const reviewNote = getApp().globalData.aiMode === 'model' ? '本次授权资料会发送给生成与后台质检模型服务；你只会看到简短结果。' : '';
    this.setData({ busy: true, error: '' });
    try {
      const consent = await new Promise((resolve, reject) => wx.showModal({
        title: '让 Agent 先打个招呼', content: '开启匹配后，Agent 仅使用你勾选授权的资料，与同样开启匹配的 Agent 进行最多 3 轮模拟交流。' + reviewNote + '你可以随时暂停；真人聊天仍需双方同意。',
        confirmText: '同意并出发', confirmColor: '#496f54', success: resolve, fail: () => reject(new Error('暂时无法确认授权，请重试'))
      }));
      if (!consent.confirm) return;
      const me = await request('/api/me/matching', 'POST', { enabled: true });
      this.setData({ me });
      const { match } = await request('/api/matches', 'POST');
      getApp().globalData.lastMatchId = match.id;
      wx.navigateTo({ url: '/pages/report/report?id=' + encodeURIComponent(match.id) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  viewLatest() {
    if (this.data.latest) wx.navigateTo({ url: '/pages/report/report?id=' + encodeURIComponent(this.data.latest.id) });
  },
  async pauseMatching() {
    try {
      const me = await request('/api/me/matching', 'POST', { enabled: false });
      this.setData({ me });
      wx.showToast({ title: '已暂停匹配', icon: 'none' });
    } catch (error) { this.setData({ error: error.message }); }
  }
});
