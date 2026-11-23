// 打包清单自测：node test/manifest.test.mjs
// 对着 DSH 插件规范核一遍：manifest 字段、导出、files、locale、图标、详情文档。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(root, rel));

// 基础字段
assert.equal(typeof pkg.name, 'string');
assert.match(pkg.version, /^\d+\.\d+\.\d+/);
assert.equal(pkg.private, false, '要发出去必须 private:false');
assert.equal(pkg.license, 'MIT');
assert.ok(pkg.engines && typeof pkg.engines.dsh === 'string', '缺 engines.dsh');
assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0);

// 导出与入口
assert.equal(pkg.type, 'module');
assert.equal(pkg.exports['.'], './index.js');
assert.equal(pkg.exports['./client'], './client.js');
assert.equal(pkg.exports['./icon'], './icon.svg');
assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(Array.isArray(pkg.dsh.client.inject));

// 入口文件都在
for (const rel of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']) {
  assert.ok(exists(rel), `缺文件：${rel}`);
}

// files 覆盖运行时要带的东西
for (const rel of ['index.js', 'client.js', 'lib', 'cordis.patch.yml', 'locale/*.json', 'docs', 'icon.svg']) {
  assert.ok(pkg.files.includes(rel), `files 缺：${rel}`);
}

// 8 语 locale：meta.title/description 齐、英文有详情、路径存在
const locales = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];
for (const lang of locales) {
  const file = path.join(root, 'locale', `${lang}.json`);
  assert.ok(fs.existsSync(file), `缺 locale：${lang}.json`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(doc.meta && doc.meta.title && doc.meta.description, `${lang} 缺 meta.title/description`);
  if (doc.meta.detail) {
    assert.ok(exists(doc.meta.detail), `${lang} 的 meta.detail 指向不存在的文件：${doc.meta.detail}`);
  }
}
assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8')).meta.detail);

// 详情文档：规范要求「只有一张图」
for (const rel of ['docs/DETAIL.md', 'docs/DETAIL.zh.md']) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8').trim();
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 1, `${rel} 只允许一行图片`);
  const match = /^!\[.+\]\((.+)\)$/.exec(lines[0]);
  assert.ok(match, `${rel} 必须是 ![alt](path) 形式`);
  assert.ok(exists(path.join('docs', match[1])), `${rel} 引用的图片不存在`);
}

// 图标：SVG 尺寸约定
const icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
assert.match(icon, /width="36"/);
assert.match(icon, /height="36"/);
assert.match(icon, /viewBox="0 0 36 36"/);
assert.ok(!/<text|<style|<script|<image|<foreignObject/.test(icon), '图标里不能有 text/style/script 等');

// 预览图：640x300，无文字
const preview = fs.readFileSync(path.join(root, 'docs', 'preview.svg'), 'utf8');
assert.match(preview, /width="640"/);
assert.match(preview, /height="300"/);
assert.ok(!/<text|<style|<script|<image|<foreignObject/.test(preview), '预览图里不能有 text/style/script 等');

console.log('manifest 自测通过');
