const config = require('./config');
function rawRequest(url, method, data) {
  return new Promise((resolve, reject) => wx.request({
    url, method: method || 'GET', data, timeout: 30000,
    header: { 'Content-Type': 'application/json' },
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
      else reject(new Error(((response.data && response.data.error) || {}).message || '服务暂时不可用，请重试'));
    },
    fail() { reject(new Error('连接失败，请检查服务地址与网络设置')); }
  }));
}
App({
  globalData: { apiBase: config.apiBase, token: '', demoMode: false, aiMode: 'rules', persona: 'lin', lastMatchId: '' },
  ensureSession() {
    if (this.globalData.token) return Promise.resolve();
    if (this._session) return this._session;
    this._session = this.createSession().finally(() => { this._session = null; });
    return this._session;
  },
  async createSession() {
    const settings = await rawRequest(this.globalData.apiBase + '/api/config');
    this.globalData.demoMode = settings.demoMode;
    this.globalData.aiMode = settings.aiMode;
    let session;
    if (settings.demoMode) {
      session = await rawRequest(this.globalData.apiBase + '/api/demo/session', 'POST', { persona: this.globalData.persona });
    } else {
      const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: () => reject(new Error('微信登录失败，请重试')) }));
      if (!login.code) throw new Error('没有获取到微信登录凭证，请重试');
      session = await rawRequest(this.globalData.apiBase + '/api/auth/wechat', 'POST', { code: login.code });
    }
    this.globalData.token = session.token;
  },
  async switchPersona(persona) {
    if (!this.globalData.demoMode) throw new Error('当前不是演示环境');
    const session = await rawRequest(this.globalData.apiBase + '/api/demo/session', 'POST', { persona });
    this.globalData.token = session.token;
    this.globalData.persona = persona;
    this.globalData.lastMatchId = '';
  }
});