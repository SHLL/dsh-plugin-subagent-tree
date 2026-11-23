// 台账自测：不装 DSH 也能跑（node test/registry.test.mjs）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  childrenOf,
  getChild,
  isSafeId,
  loadDoc,
  patchChild,
  registryPath,
  removeChild,
  upsertChild,
} from '../lib/registry.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-admin-test-'));
const file = path.join(dir, 'admin.json');

// 空文件当空台账
assert.deepEqual(Object.keys(loadDoc(file).children), []);

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
assert.deepEqual(Object.keys(loadDoc(file).children), []);

// 删
upsertChild({ id: 'a', owner: 'w1' }, file);
assert.equal(removeChild('a', file), true);
assert.equal(removeChild('a', file), false);

// 默认路径能用
assert.ok(registryPath().endsWith('subagent-admin.json'));

// id 安全：正常会话 id 通过，原型键和怪字符拒绝
assert.equal(isSafeId('session-3d58abec-41c1-4948-93e4-f280ead76034'), true);
assert.equal(isSafeId('0d6b4b1f-6d0d-4a1e-9b5e-6c1f0a2b3c4d'), true);
assert.equal(isSafeId('__proto__'), false);
assert.equal(isSafeId('constructor'), false);
assert.equal(isSafeId('prototype'), false);
assert.equal(isSafeId('a/b'), false);
assert.equal(isSafeId('a b'), false);
assert.equal(isSafeId(''), false);
assert.equal(isSafeId(42), false);
assert.equal(isSafeId('x'.repeat(200)), false);

// 原型键读不到、写不进
assert.equal(getChild('__proto__', file), null);
assert.throws(() => upsertChild({ id: '__proto__', owner: 'w1' }, file), /id 不合法/);
assert.equal(patchChild('__proto__', { owner: 'evil' }, file), null);
assert.equal(removeChild('__proto__', file), false);

// 台账文件里混进原型键/坏键，读的时候直接丢
fs.writeFileSync(
  file,
  JSON.stringify({ version: 1, children: { __proto__: { owner: 'evil' }, constructor: { owner: 'evil' }, ok: { owner: 'w1' } } }),
  'utf8',
);
const cleaned = loadDoc(file);
assert.deepEqual(Object.keys(cleaned.children), ['ok']);
assert.equal(getChild('__proto__', file), null);
assert.equal(Object.prototype.owner, undefined, '不能污染 Object.prototype');

fs.rmSync(dir, { recursive: true, force: true });
console.log('registry 自测通过');
