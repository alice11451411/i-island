function request(path, method, data) {
  const app = getApp();
  return app.ensureSession().then(() => new Promise((resolve, reject) => {
    const token = app.globalData.token;
    wx.request({
      url: app.globalData.apiBase + path, method: method || 'GET', data, timeout: 30000,
      header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      success(response) {
        if (token !== app.globalData.token) return reject(new Error('身份已切换，请在当前身份下重新操作'));
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data);
        const detail = response.data && response.data.error;
        const error = new Error((detail && detail.message) || '操作未完成，请重试');
        error.code = detail && detail.code;
        if (response.statusCode === 401) app.globalData.token = '';
        reject(error);
      },
      fail() { reject(new Error('连接失败，请检查服务地址与网络设置')); }
    });
  }));
}
function statusLabel(status) {
  return { ready: '等待你的选择', waiting: '等待另一方确认', connected: '双方已同意', declined: '这次先到这里', closed: '已结束' }[status] || '等待认识';
}
function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
module.exports = { request, statusLabel, formatTime };