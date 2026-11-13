const { request } = require('../../utils/api');
const { avatarOptions, avatarKey, profilePayload, generationLabel } = require('../../utils/profile');
const interestOptions = ['游戏', '音乐', '电影', '阅读', '二次元', '散步', '摄影', '咖啡', '运动', '旅行'];
const traitOptions = ['慢热', '话少', '敏感', '幽默', '温柔', '好奇', '随性', '善于倾听', '真诚'];
const fieldOptions = [
  { key: 'interests', label: '兴趣爱好', hint: '用于寻找共同话题' }, { key: 'traits', label: '性格与聊天节奏', hint: '让交流更舒服' },
  { key: 'friendshipGoal', label: '交友期待', hint: '了解彼此希望的连接' }, { key: 'boundaries', label: '社交边界', hint: '填写边界后，匹配时需要遵守' },
  { key: 'city', label: '所在城市', hint: '可选，不使用精确位置' }, { key: 'mbti', label: 'MBTI', hint: '可选，仅供参考' }
];
Page({
  data: { loading: true, busy: false, error: '', ages: ['18-24', '25-30', '31-40', '41+'], ageIndex: 0,
    profile: { nickname: '', avatarKey: 'sprout', sameCityOnly: false, ageRange: '18-24', city: '', mbti: '', interests: [], traits: [], friendshipGoal: '', boundaries: '', bio: '', adultConfirmed: false },
    interestOptions: [], traitOptions: [], fields: [], avatars: [], authorizedFields: [], adultConfirmed: false, defaultModeLabel: '规则模拟' },
  onLoad() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const me = await request('/api/me');
      const profile = Object.assign({}, this.data.profile, me.profile);
      if (!this.data.ages.includes(profile.ageRange)) profile.ageRange = this.data.ages[0];
      const authorizedFields = me.consent && Array.isArray(me.consent.authorizedFields) ? me.consent.authorizedFields : [];
      this.setData({ profile, authorizedFields, adultConfirmed: !!profile.adultConfirmed, ageIndex: Math.max(0, this.data.ages.indexOf(profile.ageRange)), loading: false });
      this.setData({ defaultModeLabel: generationLabel(getApp().globalData) });
      this.syncOptions();
    } catch (error) { this.setData({ error: error.message, loading: false }); }
  },
  syncOptions() {
    this.setData({
      avatars: avatarOptions.map(item => Object.assign({}, item, { selected: avatarKey(this.data.profile.avatarKey) === item.key })),
      interestOptions: interestOptions.map(label => ({ label, selected: this.data.profile.interests.includes(label) })),
      traitOptions: traitOptions.map(label => ({ label, selected: this.data.profile.traits.includes(label) })),
      fields: fieldOptions.map(field => Object.assign({}, field, { selected: this.data.authorizedFields.includes(field.key) }))
    });
  },
  chooseAvatar(event) { this.setData({ 'profile.avatarKey': avatarKey(event.currentTarget.dataset.key) }); this.syncOptions(); },
  sameCityChange(event) { this.setData({ 'profile.sameCityOnly': event.detail.value }); },
  input(event) { this.setData({ ['profile.' + event.currentTarget.dataset.field]: event.detail.value }); },
  chooseAge(event) { const index = Number(event.detail.value); this.setData({ ageIndex: index, 'profile.ageRange': this.data.ages[index] }); },
  toggleTag(event) {
    const { kind, value } = event.currentTarget.dataset;
    const selected = this.data.profile[kind];
    const max = kind === 'interests' ? 8 : 6;
    if (!selected.includes(value) && selected.length >= max) return wx.showToast({ title: '最多选择 ' + max + ' 项', icon: 'none' });
    this.setData({ ['profile.' + kind]: selected.includes(value) ? selected.filter(item => item !== value) : selected.concat(value) });
    this.syncOptions();
  },
  consentChange(event) {
    const key = event.currentTarget.dataset.key;
    const current = this.data.authorizedFields;
    this.setData({ authorizedFields: event.detail.value ? current.concat(key).filter((item, index, list) => list.indexOf(item) === index) : current.filter(item => item !== key) });
    this.syncOptions();
  },
  adultChange(event) { this.setData({ adultConfirmed: event.detail.value }); },
  async save() {
    if (this.data.busy) return;
    if (!this.data.adultConfirmed) return this.setData({ error: 'I岛仅面向成年人，请先确认你已年满 18 岁。' });
    if (!this.data.profile.nickname.trim()) return this.setData({ error: '先取一个你喜欢的昵称吧。' });
    if (!this.data.profile.interests.length) return this.setData({ error: '至少选择一个兴趣，让 Agent 有话可聊。' });
    if (this.data.profile.boundaries.trim() && !this.data.authorizedFields.includes('boundaries')) return this.setData({ error: '你填写了社交边界，请允许 Agent 在匹配时遵守这些边界，或先移除该内容。' });
    let body;
    try { body = profilePayload(this.data.profile, this.data.adultConfirmed, this.data.authorizedFields); }
    catch (error) { return this.setData({ error: error.message }); }
    this.setData({ busy: true, error: '' });
    try {
      await request('/api/me', 'PUT', body);
      wx.showToast({ title: 'Agent 已准备好', icon: 'success' });
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  }
});