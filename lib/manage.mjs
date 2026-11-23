// 分离型子 agent 的宿主侧操作：开、停、改名、隐藏（软删）、恢复。
//
// 原则：
// - 子 agent 建成一条**独立会话**（头里不写 parentSession）——它不进任何窗口的目录结构，
//   所以删它/改它不会把谁的结构弄坏。
// - 归属只记在插件台账里；DSH 的会话日志一句不碰（除了给它自己追加消息）。
// - 所有破坏性动作都带条件：活着的先停，软删=台账隐藏+DSH 归档，文件一律不动。
import { randomUUID } from 'node:crypto';
import { childrenOf, getChild, patchChild, upsertChild } from './registry.mjs';

/** 这个 id 是不是本插件台账里的子 agent（不是就不归我们管）。 */
export function isManaged(id) {
  return Boolean(getChild(id));
}

/** 当前会话 id（不同版本字段名不一样，兜两个）。 */
export function sessionIdOf(agent) {
  if (!agent) return '';
  return String(agent.id || agent.sessionId || '');
}

/** 一条 assistant/message 事件里的正文。 */
function textOfEventEvent(ev) {
  if (!ev || ev.type !== 'assistant/message') return '';
  const content = ev.data && ev.data.message && ev.data.message.content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  return parts.join('\n').trim();
}

/** 活着的 agent 身上找最后一段答复。 */
export function lastAssistantText(agent) {
  try {
    const events = agent.session.snapshotEvents();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const text = textOfEventEvent(events[i]);
      if (text) return text;
    }
  } catch {
    /* 读不到就算了 */
  }
  return '';
}

/** sessionController.wait 返回的 records 里找最后一段答复。 */
export function textFromRecords(records) {
  if (!Array.isArray(records)) return '';
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const rec = records[i];
    const ev = rec && rec.type === 'event' ? rec.event : rec;
    const text = textOfEventEvent(ev);
    if (text) return text;
  }
  return '';
}

/** 台账 + 运行时，合成面板/工具要的行。 */
export function listManaged(ctx, owner, { includeHidden = true } = {}) {
  const rows = childrenOf(owner, { includeHidden });
  return rows.map((row) => {
    const live = ctx.agents ? ctx.agents.get(row.id) : undefined;
    const running = Boolean(live && live.status === 'running');
    const status = running ? 'running' : row.status || 'idle';
    return {
      id: row.id,
      owner: row.owner || '',
      label: row.label || '',
      title: row.title || '',
      name: row.title || row.label || row.id,
      status,
      live: Boolean(live),
      hidden: Boolean(row.hidden),
      archived: Boolean(row.archived),
      depth: Number(row.depth) || 1,
      createdAt: row.createdAt || 0,
      finishedAt: row.finishedAt || 0,
      ageMinutes: row.createdAt ? Math.round((Date.now() - row.createdAt) / 60000) : null,
      lastText: (row.lastText || '').slice(0, 400),
    };
  });
}

/**
 * 派一个分离型子 agent。
 * @param ctx 宿主 ctx
 * @param owner 归属会话 id（只记在台账里）
 * @param cwd 工作目录（跟父会话一致）
 * @param task 任务正文
 * @param label 短名
 * @param notify 跑完要不要给 owner 回执（wait=true 时由工具自己回，不要重复）
 */
export async function spawnDetached(ctx, { owner, cwd, task, label, notify = true, start = true, maxDepth = 3, maxChildren = 16, signal }) {
  const text = String(task || '').trim();
  if (start !== false && !text) throw new Error('task 不能是空的');
  const parent = owner ? getChild(owner) : null;
  const depth = (parent ? Number(parent.depth) || 1 : 0) + 1;
  if (depth > maxDepth) throw new Error(`嵌套太深了（第 ${depth} 层，上限 ${maxDepth}），先等上一层跑完再说`);
  const active = childrenOf('', { includeHidden: false }).length;
  if (active >= maxChildren) {
    throw new Error(`在用的子 agent 已经有 ${active} 个（上限 ${maxChildren}），先收几个再派`);
  }

  const request = {
    ...(cwd ? { cwd } : {}),
  };
  const created = await ctx.sessionController.create(request);
  const id = String(created.sessionId);
  const now = Date.now();
  const labelText = String(label || text.replace(/\s+/g, ' ').slice(0, 24) || '空位');
  upsertChild({
    id,
    owner: String(owner || ''),
    label: labelText,
    title: '',
    depth,
    status: 'idle',
    createdAt: now,
    notify,
    notified: false,
    lastSeenRunning: false,
    lastText: '',
    hidden: false,
    archived: false,
  });
  if (start === false) return { id, label: labelText, depth };

  const requestId = randomUUID();
  try {
    await ctx.sessionController.prompt(
      {
        requestId,
        sessionId: id,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      signal || new AbortController().signal,
    );
  } catch (error) {
    patchChild(id, {
      status: 'failed',
      lastText: `开局失败：${String((error && error.message) || error)}`,
    });
    throw error;
  }
  return { id, label: labelText, depth };
}

/** 等一条会话静下来，拿最后一段答复。 */
export async function waitForChild(ctx, id, timeoutMs = 600000, signal, maxWaitMs = 1800000) {
  const value = await ctx.sessionController.wait(
    {
      sessionId: id,
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs) || 600000, maxWaitMs)),
      maxMessages: 400,
    },
    signal || new AbortController().signal,
  );
  const text = textFromRecords(value && value.output && value.output.records);
  return {
    reason: (value && value.reason) || 'timeout',
    running: Boolean(value && value.state && value.state.running),
    text,
  };
}

/** 停：只停当前这一轮，会话留着，后面还能接着用。 */
export function stopChild(ctx, id) {
  const key = String(id || '');
  const live = ctx.agents ? ctx.agents.get(key) : undefined;
  if (!live) return { ok: false, reason: '这条没在跑（或者没加载）' };
  if (live.status !== 'running') return { ok: false, reason: '现在没在跑' };
  ctx.sessionController.cancel({ sessionId: key });
  patchChild(key, { status: 'stopped', stoppedAt: Date.now() });
  return { ok: true };
}

/** 改名：真写到会话标题上（侧栏、页签都会跟着变），台账也记一份。 */
export async function renameChild(ctx, id, title) {
  const key = String(id || '');
  const name = String(title || '').trim();
  if (!name) throw new Error('新名字不能是空的');
  const value = await ctx.sessionController.rename({ sessionId: key, title: name });
  patchChild(key, { title: String(value && value.title ? value.title : name) });
  return { ok: true, title: String(value && value.title ? value.title : name) };
}

/**
 * 软删：台账里隐藏 + DSH 归档（从侧栏/分组里消失），会话文件一个字节不动。
 * 先停在跑的那一轮，避免归档后还有东西在写。
 */
export async function hideChild(ctx, id) {
  const key = String(id || '');
  const live = ctx.agents ? ctx.agents.get(key) : undefined;
  if (live && live.status === 'running') {
    try {
      ctx.sessionController.cancel({ sessionId: key });
    } catch {
      /* 停不动就继续归档 */
    }
  }
  let archived = false;
  let note = '';
  try {
    await ctx.workspaceRegistry.archiveSession(key, { stopActivity: true });
    archived = true;
  } catch (error) {
    note = String((error && error.message) || error);
  }
  patchChild(key, { hidden: true, archived, hiddenAt: Date.now(), status: 'archived' });
  return { ok: true, archived, note };
}

/** 恢复：台账去掉隐藏 + DSH 取消归档。 */
export async function restoreChild(ctx, id) {
  const key = String(id || '');
  try {
    await ctx.workspaceRegistry.unarchiveSession(key);
  } catch {
    /* 本来就没归档也算恢复 */
  }
  patchChild(key, { hidden: false, archived: false, hiddenAt: null, status: 'idle' });
  return { ok: true };
}
