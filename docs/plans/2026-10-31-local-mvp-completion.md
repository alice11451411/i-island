# I岛 完整本地 MVP 补全计划

用户已确认交付：原生微信小程序 + Node.js 后端 + 浏览器可体验的完整本地 MVP。保留现有实现，仅补核心缺口。

## 1. 模型生成与后端（server Agent）

拥有 server/**、test/**、.env.example。

新增 AI_MODE=rules|model，MODEL_API_URL（完整 chat/completions 地址）、MODEL_API_KEY、MODEL_NAME；无配置默认 rules，显式 model 配置缺失/失败明确报错，不静默降级。

采用模型输出受限的结构化计划：只能选择已授权字段、已有兴趣/性格索引以及固定的谨慎表达模板；服务端验证并渲染档案、至多六条交替对话和报告，防止模型编造用户经历、情绪或承诺。模型不接收 nickname/age/bio/联系方式等无必要资料。允许基于共同兴趣提供问题。模型配置与密钥仅在服务端。

模型调用引入 await 后，保存档案和匹配前重读并验证身份、授权版本、资料、暂停、拉黑/结束/删除状态，避免旧输出恢复撤权记录。

API 兼容扩展：profile.avatarKey 为 sprout|cloud|mushroom|moon|cat|orange，默认 sprout；profile.sameCityOnly 布尔值，默认 false。头像为公开昵称同级展示字段，不参与模型。sameCityOnly=true 时要求 city 非空且已授权；匹配只选择双方已授权同城市的候选（任一方要求同城都生效）。更新这些硬偏好需关闭旧匹配并暂停。Match.other.avatarKey 返回选定头像。Match.aiMode 保存该次生成的实际模式；旧数据缺失按 rules。

首次 session 成功时只记录一次 onboarding_started；每次有效档案保存保持 agent_saved。首次双方同意时 match.connectedAt 存 ISO，并保留；只记一次 mutual_connected。保留原 events 表结构（id,user_id,event,created_at），给 metrics 使用。

测试先失败再实现：provider 请求仅授权资料、恶意未知引用拒绝、失败不降级、三轮限制、模型延迟下撤权/删号/暂停、头像枚举、双边同城、真实模式隔离等。mock provider 用 Node HTTP :memory:，不调用真实付费接口。所有测试临时文件 E 盘并清理。

## 2. 双端界面（client Agent）

拥有 web/**、miniprogram/**（含客户端测试），不修改 server/test/根package/docs。

保持已有审美和核心交互，新增六个可选预设头像（sprout🌱, cloud☁️, mushroom🍄, moon🌙, cat🐱, orange🍊），表单保存 avatarKey，主视图和相遇/消息展示头像；字段不授权项里重复。新增 sameCityOnly 复选，提示需填城市并授权，true 时客户端亦验证；默认false。旧存档无字段时兼容默认。

模型标记按具体 Match.aiMode 显示，不能把旧规则记录重标模型；启动 config.aiMode 显示当前默认模式。Agent 档案新增 agent.aiMode，个人卡片按实际标记。不要伪造模型成功、另一方同意或消息。增加操作 loading 显示，AI 生成可耗时15秒而不假进度。小程序 wx.request timeout>=25000。

新增测试仅针对头像/同城数据序列化、授权校验、旧记录模式标记。保持既有6个行为测试。

## 3. 本地运营脚本（ops Agent）

拥有 scripts/metrics.mjs、scripts/reports.mjs、test/ops.test.mjs。不得修改其他文件。

metrics 使用 Node内置SQLite，默认根data/island.sqlite，支持 --db 和 --since ISO；读取只读，不输出个人资料。输出带分子分母与null空样本的四指标：创建完成率（agent_saved用户/onboarding_started用户）；交流使用率（参与有transcript的match用户/agent_saved用户）；双向同意率（曾connectedAt的匹配/完成模拟的匹配）；7日持续率（连接已满7天的匹配中，在前7天内至少两个不同UTC日期双方各有一条消息/所有已满7天的连接）。给出清楚口径、matureMatches和未成熟样本数，不伪造百分比。所有脚本默认排除demo用户，--include-demo 可纳入。纯函数汇总导出方便用合成fixtures测试；CLI import不自动执行。兼容旧 match 缺 connectedAt（connected状态以createdAt保守fallback并明确legacy样本数）。

reports 提供本地 CLI list [--db path]、review <reportId> --action dismiss|reviewed --note 文本 [--db path]，不对外暴露管理API，不自动发消息。CREATE TABLE IF NOT EXISTS report_reviews(report_id PRIMARY KEY,action,note,reviewed_at)，原reports保持不变。默认list仅显示必要id、reason、createdAt及review状态，不输出聊天内容。不存在id报错；note最多500字。它是本地人工处理记录，用户拉黑保护仍由既有功能执行。

TDD fixtures全部内存或E盘test-data目录，清理。读写E用exec require_escalated，禁止C盘落盘。

## 4. 集成验收（root）

根package补 metrics/reports脚本；README更新真实能力和未实网验证项。跑完整测试、语法检查与浏览器回归，在E盘保留结果，重启预览。不需要用户再次批准常规实现。
