// 工位台账：一份 JSON，记「常驻子 agent」的名字、角色、绑定的子会话。
// 只读不改会话；台账坏了大不了丢名字，不影响扫描。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 台账位置：跟长记忆放在一起，换机器也能找到（用 DSH 家目录推导）。 */
export function seatsPath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'subagent-seats.json');
}

function emptyDoc() {
  return { version: 1, seats: [] };
}

export function loadSeats(file = seatsPath()) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.seats)) return emptyDoc();
    return doc;
  } catch {
    return emptyDoc();
  }
}

function saveSeats(doc, file = seatsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function find(doc, key) {
  const k = String(key || '').toLowerCase();
  return doc.seats.find((s) => s.id.toLowerCase() === k || (s.name || '').toLowerCase() === k);
}

const now = () => new Date().toISOString();

/** action=list */
export function listSeats(file = seatsPath()) {
  return loadSeats(file).seats;
}

/**
 * action=bind：把某个子会话认成某工位。
 * seat: 工位 id 或名字（不存在就新建）；sessionId: 子会话 id；role/name 可选。
 */
export function bindSeat({ seat, agent, sessionId, name, role, file = seatsPath() }) {
  if (!seat) throw new Error('缺少 seat（工位 id 或名字）');
  const doc = loadSeats(file);
  let s = find(doc, seat);
  if (!s) {
    s = { id: String(seat).toLowerCase(), name: name || String(seat), role: role || '', agent: '', sessionId: '', createdAt: now(), retiredAt: null };
    doc.seats.push(s);
  }
  if (name) s.name = name;
  if (role) s.role = role;
  if (agent) s.agent = String(agent);
  if (sessionId) s.sessionId = String(sessionId);
  s.updatedAt = now();
  saveSeats(doc, file);
  return s;
}

/** action=rename：改名字或角色。 */
export function renameSeat({ seat, name, role, file = seatsPath() }) {
  const doc = loadSeats(file);
  const s = find(doc, seat);
  if (!s) throw new Error(`没有这个工位：${seat}`);
  if (name) s.name = name;
  if (role !== undefined) s.role = role;
  s.updatedAt = now();
  saveSeats(doc, file);
  return s;
}

/** action=retire：标退役（不删会话文件，页面会把它归到「已退役」）。 */
export function retireSeat({ seat, file = seatsPath() }) {
  const doc = loadSeats(file);
  const s = find(doc, seat);
  if (!s) throw new Error(`没有这个工位：${seat}`);
  s.retiredAt = now();
  s.updatedAt = s.retiredAt;
  saveSeats(doc, file);
  return s;
}

/** action=revive：撤掉退役标记，工位回到在用。 */
export function reviveSeat({ seat, file = seatsPath() }) {
  const doc = loadSeats(file);
  const s = find(doc, seat);
  if (!s) throw new Error(`没有这个工位：${seat}`);
  s.retiredAt = null;
  s.updatedAt = now();
  saveSeats(doc, file);
  return s;
}

/** action=remove：把这一页从活页夹里抽掉（只是台账，不碰任何会话）。 */
export function removeSeat({ seat, file = seatsPath() }) {
  const doc = loadSeats(file);
  const s = find(doc, seat);
  if (!s) throw new Error(`没有这个工位：${seat}`);
  doc.seats = doc.seats.filter((x) => x !== s);
  saveSeats(doc, file);
  return s;
}
