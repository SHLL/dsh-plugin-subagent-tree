// 台账自测：不装 DSH 也能跑（node test/registry.test.mjs）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childrenOf, getChild, loadDoc, patchChild, registryPath, removeChild, upsertChild } from '../lib/registry.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-admin-test-'));
const file = path.join(dir, 'admin.json');

// 空文件当空台账
assert.deepEqual(loadDoc(file).children, {});

upsertChild({ id: 'a', owner: 'w1', label: '一号', status: 'idle' }, file);
upsertChild({ id: 'b', owner: 'w1', label: '二号', status: 'done', hidden: true }, file);
upsertChild({ id: 'c', owner: 'w2', label: '三号', status: 'idle' }, file);

assert.equal(Object.keys(loadDoc(file).children).length, 3);
assert.equal(getChild('a', file).label, '一号');
assert.equal(getChild('nope', file), null);

// 只给 owner 的、默认滤掉隐藏的
assert.deepEqual(childrenOf('w1', {}, file).map((r) => r.id), ['a']);
assert.deepEqual(childrenOf('w1', { includeHidden: true }, file).map((r) => r.id).sort(), ['a', 'b']);
assert.deepEqual(childrenOf('', { includeHidden: true }, file).map((r) => r.id).sort(), ['a', 'b', 'c']);

// patch 不新建
assert.equal(patchChild('zzz', { label: 'x' }, file), null);
assert.equal(patchChild('a', { label: '一号改' }, file).label, '一号改');
assert.equal(getChild('a', file).label, '一号改');

// 坏文件当空台账
fs.writeFileSync(file, '{oops', 'utf8');
assert.deepEqual(loadDoc(file).children, {});

// 删
upsertChild({ id: 'a', owner: 'w1' }, file);
assert.equal(removeChild('a', file), true);
assert.equal(removeChild('a', file), false);

// 默认路径能用
assert.ok(registryPath().endsWith('subagent-admin.json'));

fs.rmSync(dir, { recursive: true, force: true });
console.log('registry 自测通过');
