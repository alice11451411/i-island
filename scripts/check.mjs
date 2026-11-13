import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
let js = 0, json = 0;
function check(dir) {
 for (const entry of readdirSync(dir, { withFileTypes: true })) {
  const file = path.join(dir, entry.name);
  if (entry.isDirectory()) { check(file); continue; }
  if (/\.(js|mjs|cjs)$/.test(file)) { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); js++; }
  if (file.endsWith('.json')) { JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); json++; }
 }
}
for (const dir of ['server', 'web', 'miniprogram', 'test', 'scripts']) check(path.join(root, dir));
for (const file of ['package.json', 'project.config.json']) { JSON.parse(readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '')); json++; }
const app = JSON.parse(readFileSync(path.join(root, 'miniprogram', 'app.json'), 'utf8').replace(/^\uFEFF/, ''));
for (const page of app.pages) for (const ext of ['.js', '.json', '.wxml', '.wxss']) if (!existsSync(path.join(root, 'miniprogram', page + ext))) throw new Error(`Missing page file: ${page}${ext}`);
console.log(`Syntax OK: ${js} JavaScript files, ${json} JSON files, ${app.pages.length} complete mini-program pages.`);
