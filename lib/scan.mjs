// 只读扫描：把 ~/.dsh/sessions 下的会话头拼成一棵树。
// 纯函数，不依赖 DSH 运行时；node test/scan.test.mjs 就能验。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sessionsRoot } from './paths.mjs';

/** 默认会话根目录：$DSH_HOME/sessions，可在配置里改。 */
export function defaultRoot() {
  return sessionsRoot();
}

/** 读一个会话文件的头行（第一行是 session 记录）。拿不到就返回 null。 */
export function readHeader(file) {
  try {
    const buf = zlib.zstdDecompressSync(fs.readFileSync(file));
    const line = buf.toString('utf8').split('\n', 1)[0];
    if (!line) return null;
    const rec = JSON.parse(line);
    if (rec?.type !== 'session') return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * 扫根目录，返回节点数组：[{ id, parentSession, origin, depth, createdAt, cwd, bytes, bucket }]
 * 不解析对话内容，只看头行与文件大小。
 */
export function scanSessions(root = defaultRoot()) {
  const out = [];
  let buckets = [];
  try {
    buckets = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return out;
  }
  for (const b of buckets) {
    const bucketDir = path.join(root, b.name);
    let dirs = [];
    try {
      dirs = fs.readdirSync(bucketDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const d of dirs) {
      const file = path.join(bucketDir, d.name, 'session.v4.jsonl.zstd');
      let bytes = 0;
      try {
        bytes = fs.statSync(file).size;
      } catch {
        continue;
      }
      const h = readHeader(file);
      if (!h) continue;
      out.push({
        id: String(h.id ?? d.name),
        parentSession: h.parentSession ? String(h.parentSession) : null,
        origin: h.origin ? String(h.origin) : 'root',
        depth: Number.isFinite(h.delegationDepth) ? Number(h.delegationDepth) : 0,
        createdAt: Number(h.createdAt) || 0,
        cwd: h.cwd ? String(h.cwd) : '',
        bytes,
        bucket: b.name,
        mtime: safeMtime(file),
      });
    }
  }
  return out;
}

function safeMtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 会话 id 归一：根会话的 id 带 `session-` 前缀，子会话的 id 是裸 uuid，
 * 而 parentSession 记的又是带前缀的那种。两边都削掉前缀再比，才不会把父子认丢。
 */
export function normId(value) {
  const s = String(value || '');
  return s.startsWith('session-') ? s.slice(8) : s;
}

/** 拼树：每个节点带 children；父不存在的挂到 roots。 */
export function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [normId(n.id), { ...n, children: [] }]));
  const roots = [];
  for (const n of byId.values()) {
    const parent = n.parentSession ? byId.get(normId(n.parentSession)) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (arr) => {
    arr.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const c of arr) sortRec(c.children);
  };
  sortRec(roots);
  return roots;
}


/** 找出某个会话节点（按归一后的 id 匹配，带不带 `session-` 前缀都认）。 */
export function findNode(roots, id) {
  if (!id) return null;
  const want = normId(id);
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (normId(n.id) === want) return n;
    stack.push(...n.children);
  }
  return null;
}
