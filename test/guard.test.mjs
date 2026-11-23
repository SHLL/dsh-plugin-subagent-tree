// 路由守卫自测：node test/guard.test.mjs
import assert from 'node:assert/strict';
import { checkJsonRequest, checkPanelRequest, isLoopbackRequest } from '../lib/guard.mjs';

const ORIGIN = 'http://127.0.0.1:56849';
const req = (headers) => ({ headers });
const okHeaders = { host: '127.0.0.1:56849', 'x-subagent-admin': '1' };

// 回环 Host 才收
assert.equal(isLoopbackRequest(req({ host: '127.0.0.1:56849' })), true);
assert.equal(isLoopbackRequest(req({ host: 'localhost:56849' })), true);
assert.equal(isLoopbackRequest(req({ host: '[::1]:56849' })), true);
assert.equal(isLoopbackRequest(req({ host: '192.168.1.5:56849' })), false);
assert.equal(isLoopbackRequest(req({ host: 'evil.example' })), false);

// Fetch Request 可能不带 Host：不拦（跨站靠自定义头挡）
assert.equal(isLoopbackRequest(req({})), true);
const fetchReq = { headers: { get: (name) => (name.toLowerCase() === 'x-subagent-admin' ? '1' : null) } };
assert.equal(isLoopbackRequest(fetchReq), true);
assert.equal(checkPanelRequest(fetchReq, ORIGIN), null);

// 正常请求通过
assert.equal(checkPanelRequest(req(okHeaders), ORIGIN), null);

// 缺自定义头 -> 拒绝
assert.notEqual(checkPanelRequest(req({ host: '127.0.0.1:56849' }), ORIGIN), null);

// 跨站 Origin -> 拒绝
assert.notEqual(checkPanelRequest(req({ ...okHeaders, origin: 'http://evil.example' }), ORIGIN), null);

// 同源 Origin（带不带尾斜杠）-> 通过
assert.equal(checkPanelRequest(req({ ...okHeaders, origin: ORIGIN }), ORIGIN), null);
assert.equal(checkPanelRequest(req({ ...okHeaders, origin: `${ORIGIN}/` }), ORIGIN), null);

// 非回环 Host 即便带齐头也拒绝（DNS rebinding）
assert.notEqual(checkPanelRequest(req({ ...okHeaders, host: 'evil.example' }), ORIGIN), null);

// 请求体必须是 JSON
assert.equal(checkJsonRequest(req({ 'content-type': 'application/json' })), null);
assert.equal(checkJsonRequest(req({ 'content-type': 'application/json; charset=utf-8' })), null);
assert.notEqual(checkJsonRequest(req({ 'content-type': 'text/plain' })), null);
assert.notEqual(checkJsonRequest(req({})), null);

console.log('guard 自测通过');
