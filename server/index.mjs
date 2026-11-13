import { createApp } from './app.mjs';
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '127.0.0.1';
const app = createApp();
app.listen(port, host, () => console.log(`I岛已启动 http://${host}:${port} · ${process.env.DEMO_MODE === 'false' ? '微信登录模式' : '本地演示，虚构用户'} · ${process.env.AI_MODE === 'model' ? '模型规划' : '规则生成'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => process.exit(0)));
