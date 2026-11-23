// 分离型子 agent 的台账：只记「谁派了谁、叫什么、什么状态、要不要回执」。
//
// 为什么要有这一层：
//   DSH 原生的子 agent 是挂在父会话日志里的（subagent/catalog 事件，只增不改），
//   父窗口的「子 agent 目录」由它投影出来——那一层删不掉也改不了。
//   这里换个办法：子 agent 建成独立会话（头里没有 parentSession），
//   归属只记在这份 JSON 里。删、改、隐藏都只动这份台账 + 子会话自己，
//   永远不会碰到任何窗口的会话结构。
//
// 台账坏了不影响任何会话（最坏是丢了名字和归属）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** DSH 家目录（跟工位台账同一个推导方式）。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** 台账文件。 */
export function registryPath() {
  return path.join(dshHome(), 'subagent-admin.json');
}

function emptyDoc() {
  return { version: 1, children: {} };
}

/** 读台账；坏文件当空台账，不抛。 */
export function loadDoc(file = registryPath()) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc || typeof doc !== 'object' || !doc.children || typeof doc.children !== 'object') return emptyDoc();
    return { version: 1, children: doc.children };
  } catch {
    return emptyDoc();
  }
}

/** 写台账：先写临时文件再改名，断电最多丢最后一次改动。 */
export function saveDoc(doc, file = registryPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 取一条（不存在返回 null）。 */
export function getChild(id, file = registryPath()) {
  const key = String(id || '');
  if (!key) return null;
  return loadDoc(file).children[key] || null;
}

/** 新建或合并一条。 */
export function upsertChild(patch, file = registryPath()) {
  const id = String((patch && patch.id) || '');
  if (!id) throw new Error('upsertChild: 缺 id');
  const doc = loadDoc(file);
  const prev = doc.children[id] || {};
  const next = { ...prev, ...patch, id, updatedAt: Date.now() };
  if (!next.createdAt) next.createdAt = Date.now();
  doc.children[id] = next;
  saveDoc(doc, file);
  return next;
}

/** 只改现有条目；不存在就返回 null（不偷偷新建）。 */
export function patchChild(id, patch, file = registryPath()) {
  const key = String(id || '');
  const doc = loadDoc(file);
  const prev = doc.children[key];
  if (!prev) return null;
  const next = { ...prev, ...patch, id: key, updatedAt: Date.now() };
  doc.children[key] = next;
  saveDoc(doc, file);
  return next;
}

/** 删一条（只在「彻底不留记录」时用；一般用 hidden 软删）。 */
export function removeChild(id, file = registryPath()) {
  const key = String(id || '');
  const doc = loadDoc(file);
  if (!doc.children[key]) return false;
  delete doc.children[key];
  saveDoc(doc, file);
  return true;
}

/** 某个窗口名下的子 agent（默认只给没隐藏的）。 */
export function childrenOf(owner, { includeHidden = false } = {}, file = registryPath()) {
  const want = String(owner || '');
  const doc = loadDoc(file);
  const rows = Object.values(doc.children);
  return rows
    .filter((r) => (want ? r.owner === want : true))
    .filter((r) => includeHidden || !r.hidden)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
