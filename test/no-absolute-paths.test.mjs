// 发布守卫：随包发的文件里不许出现机器绝对路径。
// node test/no-absolute-paths.test.mjs
//
// 只扫「会发出去的东西」：入口、lib、清单、locale、docs、SVG、README。
// test/ 自己不在发布物里（files 不含 test），所以不扫。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHIPPED = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'package.json',
  'icon.svg',
  'README.md',
  'README.zh.md',
  'LICENSE',
  'docs/DETAIL.md',
  'docs/DETAIL.zh.md',
  'docs/preview.svg',
];

for (const dir of ['lib', 'locale']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    SHIPPED.push(`${dir}/${name}`);
  }
}

// 盘符路径（C:\ 或 C:/），但排除 http:// 这类 URL——它前面是字母
const DRIVE = /(?<![A-Za-z])[A-Za-z]:[\\/]/;
const UNIX_HOME = /\/(Users|home|root)\//;
const FILE_URL = /file:\/\//i;

let scanned = 0;
for (const rel of SHIPPED) {
  const file = path.join(root, rel);
  assert.ok(fs.existsSync(file), `发布清单里的文件不存在：${rel}`);
  if (/\.(png|jpe?g|webp|gif)$/i.test(rel)) continue; // 二进制跳过
  const text = fs.readFileSync(file, 'utf8');
  scanned += 1;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    assert.ok(!DRIVE.test(line), `${rel}:${i + 1} 出现盘符路径：${line.trim()}`);
    assert.ok(!UNIX_HOME.test(line), `${rel}:${i + 1} 出现 Unix 家目录路径：${line.trim()}`);
    assert.ok(!FILE_URL.test(line), `${rel}:${i + 1} 出现 file:// 路径：${line.trim()}`);
  }
}

assert.ok(scanned > 10, '扫到的文件太少，检查一下清单');
console.log(`no-absolute-paths 自测通过（${scanned} 个文件）`);
