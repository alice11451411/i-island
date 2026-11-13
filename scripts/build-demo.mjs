import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const write = (file, data) => writeFile(new URL(`dist/${file}`, root), data);
await mkdir(new URL('dist/', root), { recursive: true });

for (const asset of ['styles.css', 'profile.js', 'hero-island.svg', 'island.svg']) {
  await copyFile(new URL(`web/${asset}`, root), new URL(`dist/${asset}`, root));
}
await copyFile(new URL('server/domain.mjs', root), new URL('dist/domain.mjs', root));
await copyFile(new URL('demo/api.mjs', root), new URL('dist/demo-api.mjs', root));

const html = (await read('web/index.html')).replaceAll('href="/', 'href="./').replace('src="/app.js"', 'src="./app.js"');
await write('index.html', html);
await write('.nojekyll', '');

const source = await read('web/app.js');
const entry = '<div class="boot"><div class="brand-symbol">i</div><h1>欢迎来到 I岛</h1><p>使用虚构身份体验。请填写虚构资料，体验记录仅保存在当前标签页。</p><button class="primary" data-action="persona" data-persona="lin">以小林身份进入</button><button class="secondary" data-action="persona" data-persona="new">从空白档案开始</button></div>';
if (!source.includes('await fetch(`/api${path}`') || !source.includes("if (state.config.demoMode) await session('lin');")) throw new Error('Web entry changed; update the demo adapter wiring');
const app = `import { createDemoTransport } from './demo-api.mjs';\nconst demoRequest = createDemoTransport(sessionStorage);\n${source}`
  .replace('await fetch(`/api${path}`', 'await demoRequest(`/api${path}`')
  .replace('src="/hero-island.svg"', 'src="./hero-island.svg"')
  .replace("if (state.config.demoMode) await session('lin');", `if (state.config.demoMode) $('#app').innerHTML = ${JSON.stringify(entry)};`)
  .replaceAll('本地演示', '浏览器演示')
  .replace('举报会保存到服务端，供人工审核处理。请不要在描述中填写联系方式。', '这是演示举报，记录仅保存在当前标签页。请不要填写真实个人信息。')
  .replace('举报已保存，等待人工审核处理', '演示举报已保存');
await write('app.js', app);
