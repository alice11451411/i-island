const { request } = require('../../utils/api');
const { avatarSymbol, generationLabel } = require('../../utils/profile');
Page({
  data: { id: '', match: null, loading: true, error: '', ownAvatar: '🌱' },
  onLoad(query) { this.setData({ id: query.id || getApp().globalData.lastMatchId || '' }); this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      let id = this.data.id;
      if (!id) {
        const result = await request('/api/matches');
        if (result.matches.length) id = result.matches[0].id;
      }
      if (!id) return this.setData({ loading: false });
      const [{ match }, me] = await Promise.all([request('/api/matches/' + encodeURIComponent(id)), request('/api/me')]);
      match.other.avatarSymbol = avatarSymbol(match.other.avatarKey); match.modeLabel = generationLabel(match);
      this.setData({ match, id, loading: false, ownAvatar: avatarSymbol(me.profile.avatarKey) });
    } catch (error) { this.setData({ error: error.message, loading: false }); }
  },
  report() { if (this.data.id) wx.navigateTo({ url: '/pages/report/report?id=' + encodeURIComponent(this.data.id) }); },
  home() { wx.reLaunch({ url: '/pages/home/home' }); }
});