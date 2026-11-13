const shareable = ['interests', 'traits', 'friendshipGoal', 'boundaries', 'city', 'mbti'];
const adultAgeRanges = ['18-24', '25-30', '31-40', '41+'];
const avatars = ['sprout', 'cloud', 'mushroom', 'moon', 'cat', 'orange'];
const emptyProfile = { avatarKey: 'sprout', sameCityOnly: false, nickname: '', ageRange: '', city: '', mbti: '', interests: [], traits: [], friendshipGoal: '', boundaries: '', bio: '', adultConfirmed: false };
const emptyReport = () => ({ commonInterests: [], compatibility: '资料已撤回或匹配已关闭。', differences: '暂无可用分析。', topics: [] });
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };

function text(value, max, label = '内容') {
  if (typeof value !== 'string' || value.trim().length > max) fail(400, 'INVALID_INPUT', `${label}格式不正确或超过${max}字`);
  return value.trim();
}
function list(value, maxItems, maxLength, label) {
  if (!Array.isArray(value) || value.length > maxItems) fail(400, 'INVALID_INPUT', `${label}数量不正确`);
  return [...new Set(value.map(item => text(item, maxLength, label)).filter(Boolean))];
}
function moderate(value) {
  if (/约炮|裸聊|未成年色情|出售毒品|加我微信|加我手机号|\b1[3-9]\d{9}\b/i.test(value)) fail(400, 'CONTENT_REJECTED', '这段内容暂时无法使用，请勿发布骚扰、违法内容或直接联系方式');
}
function validateProfile(body, previous) {
  const data = { ...emptyProfile, ...previous.profile, ...Object.fromEntries(Object.keys(emptyProfile).filter(key => key in body).map(key => [key, body[key]])) };
  if (data.adultConfirmed !== true) fail(400, 'ADULT_REQUIRED', 'I岛仅面向18岁及以上用户，请先确认已成年');
  data.nickname = text(data.nickname, 20, '昵称');
  data.ageRange = text(data.ageRange, 20, '年龄段');
  if (!data.nickname || !adultAgeRanges.includes(data.ageRange)) fail(400, 'INVALID_PROFILE', '请填写昵称并选择18岁以上年龄段');
  for (const [key, max] of Object.entries({ city: 30, mbti: 30, friendshipGoal: 150, boundaries: 200, bio: 600 })) data[key] = text(data[key], max, key);
  data.interests = list(data.interests, 8, 30, '兴趣');
  data.traits = list(data.traits, 6, 30, '性格');
  const authorizedFields = list(body.authorizedFields ?? previous.consent.authorizedFields, 6, 30, '授权字段');
  if (authorizedFields.some(key => !shareable.includes(key))) fail(400, 'INVALID_CONSENT', '包含不允许分享的字段');
  if (data.boundaries && !authorizedFields.includes('boundaries')) fail(400, 'BOUNDARY_CONSENT_REQUIRED', '填写社交边界后，请允许Agent遵守该边界，或清空边界并暂停匹配');
  if (!avatars.includes(data.avatarKey) || typeof data.sameCityOnly !== 'boolean') fail(400, 'INVALID_PREFERENCE', '请选择有效头像与同城偏好');
  if (data.sameCityOnly && (!data.city || !authorizedFields.includes('city'))) fail(400, 'CITY_CONSENT_REQUIRED', '同城匹配需要填写城市并授权使用城市');
  moderate(JSON.stringify(data));
  return { profile: data, authorizedFields };
}
function project(user) {
  return Object.fromEntries(user.consent.authorizedFields.map(key => [key, user.profile[key]]));
}
function hasMatchConsent(user) {
  if (!user || user.profile.adultConfirmed !== true || !adultAgeRanges.includes(user.profile.ageRange)) return false;
  const fields = user.consent.authorizedFields;
  return Array.isArray(fields) && fields.every(key => shareable.includes(key))
    && (!user.profile.boundaries || fields.includes('boundaries'))
    && (!user.profile.sameCityOnly || !!user.profile.city && fields.includes('city'))
    && !!(fields.includes('interests') && user.profile.interests.length || fields.includes('friendshipGoal') && user.profile.friendshipGoal);
}
function makeAgent(profile, plan = null, authorized = {}) {
  if (plan) {
    const interests = plan.interestIndices.map(index => authorized.interests[index]);
    const traits = plan.traitIndices.map(index => authorized.traits[index]);
    const summary = { interests_goal: `喜欢${interests.join('、')}，希望${authorized.friendshipGoal}。`, interests: `喜欢${interests.join('、')}，可以从共同兴趣慢慢认识。`, goal: `希望${authorized.friendshipGoal}。`, minimal: '已建立Agent，先从愿意分享的小事开始认识。' }[plan.summaryTemplate];
    return { name: `${profile.nickname}的Agent`, summary, tags: [...interests, ...traits], chatStyle: plan.chatStyle === 'slow' ? '慢慢来，给彼此一点回应的空间' : '尊重边界，从共同兴趣聊起', aiMode: 'model' };
  }
  return { aiMode: 'rules', name: profile.nickname ? `${profile.nickname}的Agent` : '我的Agent', summary: profile.interests.length ? `喜欢${profile.interests.join('、')}，希望${profile.friendshipGoal || '慢慢认识新朋友'}。` : '告诉我一点关于你的事，让Agent陪你迈出第一步。', tags: [...profile.interests, ...profile.traits].slice(0, 8), chatStyle: profile.traits.includes('慢热') ? '慢慢来，给彼此一点回应的空间' : '尊重边界，从共同兴趣聊起' };
}
function makeSimulation(a, b, plan = null) {
  const x = project(a), y = project(b);
  const common = (x.interests || []).filter(item => (y.interests || []).includes(item));
  const interest = value => value.interests?.length ? `TA选择的兴趣有${value.interests.join('、')}。` : 'TA暂未授权分享兴趣。';
  const preference = value => [value.traits?.length ? `TA选择的性格标签是${value.traits.join('、')}。` : '', value.friendshipGoal ? `TA希望${value.friendshipGoal}。` : ''].filter(Boolean).join('') || '我们可以先从已授权的兴趣了解彼此。';
  const boundary = value => value.boundaries ? `TA的社交边界是“${value.boundaries}”。` : '目前没有更多已授权的社交边界信息，可以在真人聊天时询问。';
  const renderTopic = { interests: interest, preferences: preference, boundaries: boundary };
  const lines = plan ? plan.roundTopics.flatMap(topic => [renderTopic[topic](x), renderTopic[topic](y)]) : [interest(x), interest(y), preference(x), preference(y), boundary(x), boundary(y)];
  const transcript = lines.map((message, index) => ({ speakerId: index % 2 ? b.id : a.id, text: message, round: Math.floor(index / 2) + 1 }));
  return { transcript, report: { commonInterests: plan ? plan.commonInterestIndices.map(index => common[index]) : common, compatibility: (plan ? plan.compatibilityTemplate === 'pace' : x.traits?.length && y.traits?.length) ? `你们提供的性格标签分别是“${x.traits.join('、')}”和“${y.traits.join('、')}”。可以试着商量舒适的聊天节奏，实际相处还需要彼此了解。` : '已授权资料不足以判断性格是否互补，可以从聊天节奏开始了解。', differences: (plan ? plan.differenceTemplate === 'boundaries' : x.boundaries || y.boundaries) ? `彼此的边界需要尊重。${x.boundaries ? `一方希望“${x.boundaries}”。` : ''}${y.boundaries ? `另一方希望“${y.boundaries}”。` : ''}不要把共同兴趣当作一定合拍的保证。` : '聊天频率和交流偏好仍待真人确认，共同兴趣不代表一定合拍。', topics: (plan ? plan.topicInterestIndices.length ? plan.topicInterestIndices.map(index => common[index]) : ['最近让你放松的小事'] : common.length ? common : ['最近让你放松的小事']).slice(0, 3).map(item => `愿意聊聊${item}吗？最近有什么想分享的？`) } };
}

export { emptyProfile, emptyReport, fail, text, moderate, validateProfile, project, hasMatchConsent, makeAgent, makeSimulation };
