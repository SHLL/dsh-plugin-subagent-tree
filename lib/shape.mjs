// 纯函数：把扫描出的树整理成「给人看」的形状——命名、汇总、渲染成文本。
// 不做 IO，方便单测。

const RUNNING_MS = 90 * 1000; // 90 秒内有写入就算「在跑」（粗略但够用）

/** 没名字就给个能认的短名：主窗口 `main-xxxx`，子会话 `agent-xxxx`。 */
export function displayName(node, nameMap = {}) {
  if (nameMap[node.id]) return nameMap[node.id];
  const id = String(node.id || '');
  if (id.startsWith('session-')) return `main-${id.slice(-6) || id.slice(0, 6)}`;
  return `agent-${id.slice(0, 6) || '?'}`;
}

/** unavailable = 会话目录还在但文件读不出头（被删空/损坏）；此处仅按 origin 标注。 */
export function stateOf(node, now = Date.now()) {
  if (!node.bytes) return 'unavailable';
  if (node.mtime && now - node.mtime < RUNNING_MS) return 'running';
  return 'inactive';
}

function fmtAge(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}分`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}时`;
  return `${Math.round(h / 24)}天`;
}

function fmtBytes(b) {
  if (!b) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

const MARK = { running: '▶', inactive: '·', unavailable: '×' };

/** 文本树：一行一个节点，缩进表示层级。 */
export function renderText(roots, { now = Date.now(), nameMap = {}, header = "" } = {}) {
  const lines = [];
  let count = 0;
  let running = 0;
  let unavailable = 0;
  let bytes = 0;

  const walk = (node, depth) => {
    count += 1;
    const st = stateOf(node, now);
    if (st === 'running') running += 1;
    if (st === 'unavailable') unavailable += 1;
    bytes += node.bytes || 0;
    const age = node.createdAt ? fmtAge(now - node.createdAt) : '?';
    lines.push(
      `${'  '.repeat(depth)}${MARK[st]} ${displayName(node, nameMap)}` +
        `  [${st}] d${node.depth} ${age} ${fmtBytes(node.bytes)}${node.cwd ? '' : ''}`,
    );
    for (const c of node.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);

  const summary =
    (header ? header + "｜" : "") +
    `共 ${count} 个会话（在跑 ${running} / unavailable ${unavailable} / 占 ${fmtBytes(bytes)}）` +
    `｜根 ${roots.length}`;
  return [summary, ...lines].join('\n');
}

/** 给页面用的 JSON：节点形状 + 汇总。 */
export function shape(roots, { now = Date.now(), nameMap = {} } = {}) {
  let count = 0;
  let running = 0;
  let unavailable = 0;
  let bytes = 0;

  const toNode = (n, depth) => {
    count += 1;
    const st = stateOf(n, now);
    if (st === 'running') running += 1;
    if (st === 'unavailable') unavailable += 1;
    bytes += n.bytes || 0;
    return {
      id: n.id,
      name: displayName(n, nameMap),
      state: st,
      depth,
      absDepth: Number(n.depth) || 0,
      origin: n.origin,
      createdAt: n.createdAt,
      ageMinutes: n.createdAt ? Math.round((now - n.createdAt) / 60000) : null,
      bytes: n.bytes || 0,
      children: n.children.map((c) => toNode(c, depth + 1)),
    };
  };

  const nodes = roots.map((r) => toNode(r, 0));
  return {
    generatedAt: new Date(now).toISOString(),
    summary: { total: count, running, unavailable, bytes, roots: roots.length },
    nodes,
  };
}
