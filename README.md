# I岛 · 完整本地 MVP

让你的 Agent 先认识 TA。

包含原生微信小程序、Node.js / SQLite 后端和浏览器演示。核心闭环为创建 Agent → 授权匹配 → 最多三轮模拟交流 → 缘分报告 → 双方确认 → 真人文字聊天。

默认使用**虚构用户与离线规则生成**，无须密钥即可体验。另已实现可配置的模型接口，档案与每次报告都标记各自的实际生成方式。应用尚未发布。

## 参赛浏览器 Demo

在线体验：https://alice11451411.github.io/i-island/

运行 `npm run build:demo`，将生成的 `dist/` 作为静态网站托管。演示复用 Web 界面和离线匹配规则，支持以小林、木木或新岛民体验建档、三轮模拟交流、缘分报告、双向确认和消息。体验数据仅保存在当前标签页，不需要数据库、账号服务或模型 API。请使用虚构资料。

## 启动

需要 Node.js 24 或更新版本。没有第三方运行依赖，无须 npm install。

```powershell
cd E:\i-island
npm start
```

打开 <http://127.0.0.1:3210>。默认仅监听本机；数据保存在 `E:\i-island\data\island.sqlite`，用 Ctrl+C 停止服务。

复制 `.env.example` 为 `.env` 可调整端口、数据库、登录与生成模式。模型和微信密钥只由服务端环境变量读取，前端无法获得。

## 体验一次相遇

1. 默认进入“小林”这个虚构演示身份。点击“让我的 Agent 去交朋友”，确认本次资料使用授权。
2. 完成后直接查看缘分报告；想了解细节时，可从报告回看六条、最多三轮模拟交流。
3. 点击“想认识 TA”。此时聊天仍然锁定。
4. 点击右上角头像或左下角身份入口，切换到“木木”，进入报告，亲自确认另一方的意向。
5. 双方同意后进入聊天。破冰建议只会填入输入框，点击发送才发送。
6. 切回“小林”可看到另一方发出的消息。系统不会自动生成真人回复。
7. 切换到“新岛民”可从空白资料开始，选择六种预设头像、填写兴趣与边界并逐字段授权。

同一对用户的有效匹配会复用；拒绝、解除或拉黑后不会立即再次配对。同城偏好是双边硬筛选：任一方选择“仅匹配同城朋友”，双方都必须授权城市且城市相同。

需要重新体验种子样例时，停止服务，把 `data` 文件夹移到备份位置，再启动即可生成新的虚构样例。

## 配置模型

`.env` 示例，地址、模型名和密钥需替换为所选服务的实际值：

```dotenv
AI_MODE=model
MODEL_API_URL=https://your-provider.example/v1/chat/completions
MODEL_API_KEY=your-server-side-key
MODEL_NAME=your-model-name
MODEL_TIMEOUT_MS=15000
REVIEW_MODEL_NAME=your-low-cost-review-model
# REVIEW_MODEL_API_URL=https://your-provider.example/v1/chat/completions
# REVIEW_MODEL_API_KEY=your-review-key
REVIEW_MODEL_TIMEOUT_MS=5000
```

接口使用 Chat Completions 格式并要求 JSON 输出。外部接口必须使用 HTTPS；HTTP 仅限本机模拟，且不跟随重定向。`AI_MODE=rules` 为离线模式；显式 `model` 模式缺少配置、服务失败、超时或输出不合法时返回明确错误，不静默降级。主模型默认超时 15 秒，上限 20 秒；质检模型默认 5 秒，上限 8 秒。质检模型默认沿用主模型的接口地址和密钥，但必须单独选择模型名，也可配置独立接口与密钥。

主模型负责从已授权资料中选择证据和表达方案，服务端验证索引与固定模板后生成档案、六条对话和报告。独立质检模型只接收授权资料投影与最终候选文本，以固定问题代码返回通过或拒绝；不改写内容、不把推理过程展示给用户。模型模式会将所选授权资料发送给生成与质检模型服务；拒绝、调用失败或输出格式无效时不保存档案/匹配。质检输入不包含账号 ID，模型也不接收昵称、年龄、头像、原始简介或未授权字段。等待模型返回后，服务端再次核对授权与匹配状态，避免撤权期间的旧结果落库。

现已通过本地模拟模型服务的接口及浏览器集成验证，**尚未调用真实外部模型进行实网验收**。旧规则生成记录不会因切换配置而被重新标为模型生成。

## 导入微信开发者工具

导入 `E:\i-island`，项目配置已指定 `miniprogram/`。

- 本机演示使用占位 AppID `touristappid`；工具要求正式项目身份时，替换为自己的小程序 AppID。
- 后端运行后，`miniprogram/config.js` 默认连接 `http://127.0.0.1:3210`。
- 当前关闭开发环境域名校验，便于本机调试。真机及正式环境需配置可访问的 HTTPS 后端与微信 request 合法域名，并恢复域名校验。
- `DEMO_MODE=false` 时，小程序用 `wx.login` 获取 code，由后端换取身份。需设置 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET`；缺少配置时明确报错。

尚未进行微信开发者工具渲染、真机、真实微信登录或发布验收。

## 权限与数据行为

- 服务端生成会话并鉴权；客户端不能自报其他用户身份。真实与演示身份相互隔离。
- 18+ 自我确认，年龄段限定为成年选项。头像和昵称用于展示，其他字段逐项授权。
- 匹配使用共同兴趣、交友目标和可选城市排序；同城硬筛选同时尊重双方偏好。
- 自由文本边界用于模拟交流和报告提醒，尚不自动解析任意自然语言为筛选条件。
- 双方真人确认前不能读取或发送真人消息。暂停只停止新匹配；拒绝、解除和拉黑关闭相应聊天。
- 修改已授权资料或同城硬偏好后，旧模拟及报告被清空，旧匹配关闭，新匹配暂停。显式解除、拒绝和拉黑不会被资料编辑重置。
- 读完请求体后再读取业务状态；模型返回后再次检查身份、资料版本、暂停与匹配状态，防止旧请求覆盖撤权或删除。
- 删除账号会删除其会话、Agent、关联匹配、消息、举报与相关记录。
- 基础文本过滤、举报收件和拉黑可用；基础聊天与隐私安全功能没有付费门槛。

## 本地指标

```powershell
npm run metrics
npm run metrics -- --since 2026-10-01T00:00:00Z
npm run metrics -- --include-demo
```

默认只统计非演示用户；`--include-demo` 可检查样例。每项输出分子、分母、比率及口径，空分母为 `null`。

| 指标 | 当前统计口径 |
| --- | --- |
| Agent 创建完成率 | 首次进入创建流程的用户中，保存过有效档案的去重用户占比 |
| Agent 交流使用率 | 区间内保存过档案的用户中，参与区间内仍保有模拟交流的去重用户占比 |
| 双向同意率 | 区间内仍保有模拟交流的匹配中，曾双向确认的比例 |
| 7 日真实聊天持续率 | 连接已满 7 天的匹配中，首 7 天至少两个 UTC 日期双方各发过消息的比例 |

未满七天的连接单独列为未成熟样本，不计为失败。`--since` 的用户指标按事件时间取区间，匹配指标按匹配创建时间取区间。只统计仍保留的用户与记录；被删除或因撤权清空的历史不推测补回。旧连接缺少 `connectedAt` 时采用保守回退并单列数量。

## 本地举报处理

```powershell
npm run reports -- list
npm run reports -- list --include-demo
npm run reports -- review report-id --action reviewed --note '已人工查看'
npm run reports -- review report-id --action dismiss --note '经核实不成立'
```

`list` 只读列出必要举报内容；`review` 保存本地人工处理记录。它不会发送消息或修改用户账号，用户侧拉黑由既有功能执行。两类脚本都支持 `--db` 指定数据库。

当前内容过滤是基础本地规则，尚未接入微信平台内容安全服务；举报处理是本地命令，尚无网页运营后台。

## 验证

```powershell
npm test
npm run check
```

测试覆盖授权投影、双向确认、越权、删除、持久化、中文分块、并发撤权、受限模型、同城偏好、双端数据、四项指标和举报记录。

可选浏览器验收需要现有的 `playwright-core` 与 Chromium。设置 `PLAYWRIGHT_MODULE` 为模块路径，`BROWSER_EXECUTABLE` 为浏览器可执行文件路径，再运行：

```powershell
node scripts/browser-check.mjs
node scripts/model-browser-check.mjs
```

两者使用独立内存数据库；第二个只连接本机模拟模型，不向外部发送凭据。临时浏览器资料位于项目 `test-data` 并自动清理，不修改日常演示数据库。

验收结果为 `docs/browser-check.json`、`docs/model-browser-check.json`，截图在 `docs/screenshots/`。

## 主要文件

- `server/app.mjs`：鉴权、SQLite、匹配与聊天 API。
- `server/ai.mjs`：受限模型适配与输出验证。
- `web/`：响应式浏览器界面与本地矢量小岛插画。
- `miniprogram/`：原生微信小程序。
- `scripts/metrics.mjs`、`scripts/reports.mjs`：本地种子测试和运营工具。
- `test/`、`miniprogram/tests/`：自动测试。
- `docs/plans/`：设计与 API 合同。
