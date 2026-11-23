// 配置自测：node test/config.test.mjs
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, RENDER_STATUSES } from '../lib/config.mjs';

// 空配置 / 坏配置 -> 全默认
assert.deepEqual(normalizeConfig(), { ...DEFAULTS });
assert.deepEqual(normalizeConfig(null), { ...DEFAULTS });
assert.deepEqual(normalizeConfig('nope'), { ...DEFAULTS });
assert.deepEqual(normalizeConfig(42), { ...DEFAULTS });

// 深度：1-10 有效，其它回默认
assert.equal(normalizeConfig({ maxDepth: 5 }).maxDepth, 5);
assert.equal(normalizeConfig({ maxDepth: 0 }).maxDepth, DEFAULTS.maxDepth);
assert.equal(normalizeConfig({ maxDepth: 11 }).maxDepth, DEFAULTS.maxDepth);
assert.equal(normalizeConfig({ maxDepth: 2.5 }).maxDepth, DEFAULTS.maxDepth);

// 超时：下限 1000，上限 maxWaitMs
assert.equal(normalizeConfig({ defaultTimeoutMs: 500 }).defaultTimeoutMs, 1000);
assert.equal(normalizeConfig({ defaultTimeoutMs: 12345 }).defaultTimeoutMs, 12345);
assert.equal(normalizeConfig({ defaultTimeoutMs: 9e9 }).defaultTimeoutMs, DEFAULTS.maxWaitMs);

// 默认等待不能超过最长等待
const squeezed = normalizeConfig({ maxWaitMs: 5000, defaultTimeoutMs: 60000 });
assert.equal(squeezed.maxWaitMs, 5000);
assert.equal(squeezed.defaultTimeoutMs, 5000);

// 渲染状态表：去重、滤掉未知状态，空表回默认
assert.deepEqual(normalizeConfig({ renderStatuses: ['done', 'done', 'nope'] }).renderStatuses, ['done']);
assert.deepEqual(normalizeConfig({ renderStatuses: ['running', 'stopped'] }).renderStatuses, [
  'running',
  'stopped',
]);
assert.deepEqual(normalizeConfig({ renderStatuses: [] }).renderStatuses, DEFAULTS.renderStatuses);
assert.deepEqual(normalizeConfig({ renderStatuses: 'done' }).renderStatuses, DEFAULTS.renderStatuses);
assert.ok(RENDER_STATUSES.includes('archived'));

// 布尔开关：只认真布尔
assert.equal(normalizeConfig({ allowPreview: 'yes' }).allowPreview, DEFAULTS.allowPreview);
assert.equal(normalizeConfig({ allowPreview: false }).allowPreview, false);
assert.equal(normalizeConfig({ allowOpen: 0 }).allowOpen, DEFAULTS.allowOpen);
assert.equal(normalizeConfig({ allowOpen: false }).allowOpen, false);
assert.equal(normalizeConfig({ notifyOnComplete: false }).notifyOnComplete, false);

// 在用子 agent 上限：1-100 有效
assert.equal(normalizeConfig({ maxChildren: 5 }).maxChildren, 5);
assert.equal(normalizeConfig({ maxChildren: 0 }).maxChildren, DEFAULTS.maxChildren);
assert.equal(normalizeConfig({ maxChildren: 101 }).maxChildren, DEFAULTS.maxChildren);
assert.equal(normalizeConfig({ maxChildren: '8' }).maxChildren, DEFAULTS.maxChildren);

console.log('config 自测通过');
