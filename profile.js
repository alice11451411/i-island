const avatarOptions = [
  { key: 'sprout', symbol: '🌱', label: '小芽' }, { key: 'cloud', symbol: '☁️', label: '云朵' },
  { key: 'mushroom', symbol: '🍄', label: '蘑菇' }, { key: 'moon', symbol: '🌙', label: '月亮' },
  { key: 'cat', symbol: '🐱', label: '小猫' }, { key: 'orange', symbol: '🍊', label: '橘子' }
];
function avatarKey(value) { return avatarOptions.some(item => item.key === value) ? value : 'sprout'; }
function avatarSymbol(value) { return avatarOptions.find(item => item.key === avatarKey(value)).symbol; }
function generationLabel(record) { return record && record.aiMode === 'model' ? 'AI 模型模拟' : '规则模拟'; }
function canStartMatching(user) {
  const profile = user?.profile || {};
  const fields = new Set(user?.consent?.authorizedFields || []);
  const shareable = ['interests', 'traits', 'friendshipGoal', 'boundaries', 'city', 'mbti'];
  return profile.adultConfirmed === true && ['18-24', '25-30', '31-40', '41+'].includes(profile.ageRange)
    && [...fields].every(key => shareable.includes(key))
    && (!profile.boundaries || fields.has('boundaries'))
    && (!profile.sameCityOnly || !!profile.city && fields.has('city'))
    && !!(fields.has('interests') && profile.interests?.length || fields.has('friendshipGoal') && profile.friendshipGoal);
}
function validateSameCity(profile, authorizedFields) {
  if (!profile.sameCityOnly) return;
  if (!String(profile.city || '').trim()) throw new Error('仅匹配同城朋友时，请填写所在城市。');
  if (!authorizedFields.includes('city')) throw new Error('仅匹配同城朋友时，请授权 Agent 使用城市资料。');
}
function profileSubmission(formData, selections) {
  const body = Object.assign(Object.fromEntries(formData.entries()), selections, {
    avatarKey: avatarKey(formData.get('avatarKey')), sameCityOnly: formData.has('sameCityOnly'),
    adultConfirmed: formData.has('adultConfirmed'), authorizedFields: formData.getAll('authorizedFields')
  });
  validateSameCity(body, body.authorizedFields);
  return body;
}
export { avatarOptions, avatarKey, avatarSymbol, generationLabel, canStartMatching, profileSubmission };
