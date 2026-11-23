// 路径自测：node test/paths.test.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { configurePaths, dshHome, ledgerFile, seatsFile, sessionsRoot } from '../lib/paths.mjs';

// 默认：$DSH_HOME 或 ~/.dsh
configurePaths({});
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
assert.equal(dshHome(), home);
assert.equal(ledgerFile(), path.join(home, 'subagent-admin.json'));
assert.equal(seatsFile(), path.join(home, 'subagent-seats.json'));
assert.equal(sessionsRoot(), path.join(home, 'sessions'));

// 自定义台账位置：工位台账跟着放同一个目录
configurePaths({ ledgerPath: path.join('/tmp', 'custom', 'ledger.json') });
assert.equal(ledgerFile(), path.resolve('/tmp', 'custom', 'ledger.json'));
assert.equal(seatsFile(), path.join(path.dirname(path.resolve('/tmp/custom/ledger.json')), 'subagent-seats.json'));
assert.equal(sessionsRoot(), path.join(home, 'sessions'), '只改台账不该影响会话目录');

// 自定义会话根目录：相对路径解析成绝对路径
configurePaths({ sessionRoot: 'relative/sessions' });
assert.equal(sessionsRoot(), path.resolve('relative/sessions'));
assert.equal(ledgerFile(), path.join(home, 'subagent-admin.json'), '只改会话目录不该影响台账');

// 同时给两个
configurePaths({ ledgerPath: '/tmp/l.json', sessionRoot: '/tmp/s' });
assert.equal(ledgerFile(), path.resolve('/tmp/l.json'));
assert.equal(sessionsRoot(), path.resolve('/tmp/s'));

// 空串 / 非字符串 -> 回默认
configurePaths({ ledgerPath: '', sessionRoot: 42 });
assert.equal(ledgerFile(), path.join(home, 'subagent-admin.json'));
assert.equal(sessionsRoot(), path.join(home, 'sessions'));

configurePaths({});
console.log('paths 自测通过');
