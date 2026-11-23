// 纯函数自测：造一个假 sessions 目录（zstd 头行），断言树拼得对。
// 跑法：node test/scan.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildTree, scanSessions } from '../lib/scan.mjs';
import { renderText, shape } from '../lib/shape.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-tree-'));

function writeSession(bucket, id, header) {
  const dir = path.join(tmp, bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'session', version: 4, id, ...header });
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(line + '\n')));
}

writeSession('--C-work--', 'root-1', { createdAt: 1000, cwd: 'C:/work', isSeeded: false, origin: 'root' });
writeSession('--C-work--', 'kid-1', { createdAt: 2000, parentSession: 'root-1', origin: 'subagent', delegationDepth: 1 });
writeSession('--C-work--', 'kid-2', { createdAt: 3000, parentSession: 'kid-1', origin: 'subagent', delegationDepth: 2 });
writeSession('--C-work--', 'orphan', { createdAt: 4000, parentSession: 'gone', origin: 'subagent', delegationDepth: 1 });

const nodes = scanSessions(tmp);
assert.equal(nodes.length, 4, '应扫到 4 个会话');

const roots = buildTree(nodes);
assert.equal(roots.length, 2, '应该有 2 个根（root-1 和断链的 orphan）');
assert.equal(roots[0].id, 'root-1');
assert.equal(roots[0].children.length, 1);
assert.equal(roots[0].children[0].children[0].id, 'kid-2');

const text = renderText(roots, { now: 5000 });
assert.match(text, /共 4 个会话/);
assert.match(text, /root-1/);
assert.match(text, /d2/);

const s = shape(roots, { now: 5000 });
assert.equal(s.summary.total, 4);
assert.equal(typeof s.nodes[0].children[0].children[0].id, 'string');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('scan/shape 自测通过');
