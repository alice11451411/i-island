# I岛 MVP Implementation Plan

> Implementer: test security and domain behavior before implementation; keep changes inside assigned paths. User PRD and autonomous delivery instructions define approved scope.

**Goal:** 可运行的原生微信小程序、Node.js/SQLite 后端与浏览器演示，验证从 Agent 到真人连接的完整闭环。

**Architecture:** Node 24 built-ins, same-origin browser client, native WeChat client. Authenticated API with server-side consent projection and mutual decisions. Demo is visibly labeled and never silently substitutes real auth/model execution.

**Tech Stack:** Node.js 24, node:sqlite, node:test, HTML/CSS/ES modules, native WXML/WXSS/JS.

## API contract

All JSON responses use `{ ...data }`; errors `{ error: { code, message } }`. Bearer token for all private routes.

GET /api/config -> { demoMode, aiMode }
POST /api/demo/session { persona: lin | momo | new } -> { token, user }
POST /api/auth/wechat { code } -> { token, user }
GET /api/me -> { profile, agent, consent, matchingEnabled, id }
PUT /api/me { nickname, ageRange, city, mbti, interests[], traits[], friendshipGoal, boundaries, bio, adultConfirmed, authorizedFields[] } -> same as GET /api/me
POST /api/me/matching { enabled } -> same as GET /api/me
DELETE /api/me -> { deleted: true }
GET /api/matches -> { matches: Match[] }
POST /api/matches -> { match }
GET /api/matches/:id -> { match }
POST /api/matches/:id/decision { decision: accept | decline } -> { match }
POST /api/matches/:id/close -> { match }
POST /api/matches/:id/block -> { blocked: true }
POST /api/matches/:id/report { reason } -> { reported: true }
GET /api/matches/:id/messages -> { messages: [{ id, mine, text, createdAt }] }
POST /api/matches/:id/messages { text } -> { message }
POST /api/matches/:id/icebreaker -> { suggestions: string[] }

Match = { id, status: ready | waiting | connected | declined | closed, other: { nickname, interests[], traits[], avatarColor }, transcript: [{ speaker: self | other, text, round }], report: { commonInterests[], compatibility, differences, topics[] }, selfDecision, otherDecision, createdAt, aiMode }
Me.profile = nickname, ageRange, city, mbti, interests[], traits[], friendshipGoal, boundaries, bio, adultConfirmed.
Me.agent = { name, summary, tags[], chatStyle }; consent = { authorizedFields[], version }.
Authorized fields allowlist: interests, traits, friendshipGoal, boundaries, city, mbti. At least interests/goal must support matching; boundaries must be authorized when present. Revoking material consent closes active matches. Max six alternating transcript messages. Report uses authorized data only.

## Task 1: server (separate ownership)

Files: server/**, test/**, package.json, .env.example, .gitignore.
1. Write node:test integration tests using temporary SQLite under E:\i-island\test-data, covering adult gate, auth, permission projection, bounded conversation, mutual consent, decline, blocking, consent revocation and deletion.
2. Run `node --test`, confirm fail due to missing app behavior.
3. Implement built-in HTTP/SQLite API, rate/size limits, demo seeds and optional real WeChat login and model adapter.
4. Run tests, verify all pass; report real integrations not validated.

## Task 2: native client (separate ownership)

Files: miniprogram/**, project.config.json.
Five main pages: home, agent, encounter, report, inbox (messages/my segments and chat detail).
Use contract above. App-level session via demo session for demo config, wx.login for real config. Adult and per-field consent form; no auto-sent real messages; actionable empty/loading/error states. Demo role switch explicitly labeled.
Verify all JSON parse and JS syntax. AppID is placeholder to replace; document device validation pending.

## Task 3: browser client (root ownership)

Files: web/**, README.md, docs/**.
Warm mint/cream/coral responsive dashboard with functional five-page navigation, form, match consent, transcript, report decisions, explicit demo persona switch, chat, reporting/blocking/delete/pause.
Use accessible buttons/forms/dialogs, no external CDN dependencies.
Verify syntax and actual API flow, then screenshot desktop and mobile if browser automation is available.

## Task 4: final review

Review API integration and authorization. Run test suite and static validation. Start local preview and deliver paths + commands + actual limitations. Do not claim real model, WeChat device or deployment verification without evidence.
