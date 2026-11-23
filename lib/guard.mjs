// 路由守卫：插件自己的 HTTP 口只给本机的 DSH 页面用。
//
// 三道闸：
//   ① Host 是回环地址（有带就得对；Fetch Request 可能不带 Host，跳过这条）；
//   ② Origin 如果有，必须跟本机 web 服务同源；
//   ③ 必须带 x-subagent-admin 头——跨站页面要带自定义头会先发 CORS 预检，
//      我们不回应预检，所以别的域名页面发不出来；同源的 DSH 页面可以。
//
// 这挡不住同机的其它进程（它能直接抄头），文档里写清楚：本插件假定本机可信。

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** 取请求头：既接受 Node IncomingMessage（普通对象），也接受 Fetch Request（Headers）。 */
function headerOf(req, name) {
  const headers = req && req.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }
  return headers[name] !== undefined ? headers[name] : headers[name.toLowerCase()];
}

/** 是否是本机请求：有 Host 就校验，没有 Host（Fetch 请求）不拦。 */
export function isLoopbackRequest(req) {
  const host = headerOf(req, 'host');
  if (host === undefined || host === '') return true;
  return LOOPBACK.test(String(host));
}

/**
 * 面板请求检查。
 * @returns null 通过；否则返回一句拒绝原因。
 */
export function checkPanelRequest(req, origin) {
  if (!req || !req.headers) return '缺请求头';
  if (!isLoopbackRequest(req)) return '只接受本机请求';

  const requestOrigin = headerOf(req, 'origin');
  if (requestOrigin !== undefined && String(requestOrigin) !== '') {
    const allowed = origin ? String(origin).replace(/\/$/, '') : '';
    const normalized = String(requestOrigin).replace(/\/$/, '');
    if (allowed === '' || allowed !== normalized) return '来源不认识';
  }

  if (String(headerOf(req, 'x-subagent-admin') || '') !== '1') return '缺 x-subagent-admin 头';
  return null;
}

/** POST 还要是 JSON。 */
export function checkJsonRequest(req) {
  const type = String(headerOf(req, 'content-type') || '');
  if (!type.toLowerCase().startsWith('application/json')) return '请求体必须是 application/json';
  return null;
}
