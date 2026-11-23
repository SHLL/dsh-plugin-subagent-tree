// host 入口：三层。
//   ① 只读树：subagent_tree 工具 + 页面数据（扫 ~/.dsh/sessions 的会话头）
//   ② 工位台账：subagent_seat（只记名字与绑定）
//   ③ 分离型子 agent：spawn_agent / manage_subagents —— 子 agent 建成独立会话，
//      归属只记插件台账。删、改、隐藏都只动台账和子会话自己，永远不碰任何窗口的会话结构。
//
// 注意：不 import @deepseek-ai/* —— profile 安装的 bundle 解析不到它们。
// 工具按 ToolDefinition 裸形状注册；参数校验由注册器按 JSON Schema 做。
import { randomUUID } from 'node:crypto';
import { buildTree, defaultRoot, findNode, scanSessions } from './lib/scan.mjs';
import { renderText, shape, stateOf } from './lib/shape.mjs';
import { bindSeat, listSeats, removeSeat, renameSeat, retireSeat, reviveSeat } from './lib/seats.mjs';
import { getChild, patchChild } from './lib/registry.mjs';
import { normalizeConfig } from './lib/config.mjs';
import { checkJsonRequest, checkPanelRequest } from './lib/guard.mjs';
import {
  hideChild,
  lastAssistantText,
  listManaged,
  renameChild,
  restoreChild,
  sessionIdOf,
  spawnDetached,
  stopChild,
  waitForChild,
} from './lib/manage.mjs';

export const name = 'subagent-tree';
export const inject = ['tools', 'webServer', 'agents', 'sessions', 'sessionController', 'workspaceRegistry'];

/** 当前 agent 的会话 id（不同版本字段名可能不同，兜两个）。 */
function currentSessionId(exec) {
  return sessionIdOf(exec && exec.agent);
}

/** 面板派活时猜工作目录：活的会话直接读头，不然退回进程目录。 */
function cwdForOwner(ctx, owner) {
  try {
    const session = ctx.sessions && ctx.sessions.get ? ctx.sessions.get(owner) : undefined;
    if (session && session.header && session.header.cwd) return String(session.header.cwd);
  } catch {
    /* 读不到就退 */
  }
  return process.cwd();
}

/** 扫一次并算好：scope=current 时只看该会话，加上工位和分离型子 agent。 */
function buildPayload(ctx, { root, scope, session }, renderStatuses = [], allowOpen = true) {
  const nodes = scanSessions(root);
  const roots = buildTree(nodes);
  const now = Date.now();
  let view = roots;
  let header = '';
  const sid = String(session || '');
  if (scope !== 'all') {
    const node = sid ? findNode(roots, sid) : null;
    if (node) {
      view = [node];
      header = `当前会话 ${sid.slice(0, 12)} 的子 agent`;
    } else if (sid) {
      view = [];
      header = `当前会话 ${sid.slice(0, 12)}（树里没找到它的记录）`;
    } else {
      header = '没拿到当前会话 id，下面按全部会话列';
    }
  }
  const shaped = shape(view, { now });
  // 工位：把台账和树对起来——工位绑的子会话还在不在、什么状态
  const flat = [];
  const collect = (n) => {
    flat.push(n);
    for (const c of n.children || []) collect(c);
  };
  for (const r of roots) collect(r);
  const byId = new Map(flat.map((n) => [n.id, n]));
  const seats = listSeats().map((s) => {
    const node = s.sessionId ? byId.get(String(s.sessionId)) : null;
    return {
      id: s.id,
      name: s.name,
      role: s.role || '',
      agent: s.agent || '',
      sessionId: s.sessionId || '',
      resolved: Boolean(node),
      state: node ? stateOf(node, now) : s.retiredAt ? 'retired' : s.agent ? 'named' : 'unbound',
      ageMinutes: node && node.createdAt ? Math.round((now - node.createdAt) / 60000) : null,
      bytes: node ? node.bytes || 0 : 0,
      retiredAt: s.retiredAt || null,
      updatedAt: s.updatedAt || s.createdAt || null,
    };
  });
  const managed = listManaged(ctx, scope === 'all' ? '' : sid, { includeHidden: true });
  return {
    scope: scope === 'all' ? 'all' : 'current',
    session: sid,
    header,
    seats,
    managed,
    renderStatuses,
    allowOpen: allowOpen === true,
    ...shaped,
  };
}

/** 分离型子 agent 的文本行。 */
function renderManaged(rows) {
  if (!rows.length) return [];
  const mark = { running: '▶', idle: '·', done: '✓', stopped: '■', archived: '▢', failed: '×' };
  const lines = [`分离型子 agent（${rows.length}）`];
  for (const row of rows) {
    const tail = row.lastText ? ' · ' + row.lastText.replace(/\s+/g, ' ').slice(0, 40) : '';
    lines.push(
      `${mark[row.status] || '·'} ${row.id.slice(0, 10)} 「${row.name}」 [${row.status}] 第${row.depth}层` +
        (row.hidden ? '（已隐藏）' : '') +
        (row.ageMinutes == null ? '' : ` ${row.ageMinutes}分`) +
        tail,
    );
  }
  return lines;
}

/** 跑完回执：把子 agent 的答复投回它归属的窗口。 */
async function deliverNotice(ctx, entry, childId, text) {
  const owner = String(entry.owner || '');
  if (!owner || owner === childId) return;
  const name = entry.title || entry.label || childId.slice(0, 8);
  const body = text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
  const requestId = randomUUID();
  await ctx.sessionController.prompt(
    {
      requestId,
      sessionId: owner,
      mode: 'queue',
      content: [{ type: 'text', text: `〔子 agent「${name}」跑完了〕\n${body}` }],
    },
    new AbortController().signal,
  );
}

/** agent 状态翻转：跑→停时记答复，必要时回执。 */
function watchChildren(ctx) {
  return ctx.effect(
    () =>
      ctx.on('agent/status', ({ agent, status }) => {
        let entry;
        try {
          entry = getChild(agent.id);
        } catch {
          return;
        }
        if (!entry) return;
        if (status === 'running') {
          patchChild(agent.id, { status: 'running', lastSeenRunning: true, runningSince: Date.now() });
          return;
        }
        const text = lastAssistantText(agent);
        patchChild(agent.id, {
          status: text ? 'done' : entry.status === 'stopped' ? 'stopped' : 'done',
          lastText: text.slice(0, 4000),
          finishedAt: Date.now(),
          lastSeenRunning: false,
        });
        if (entry.notify === false || entry.notified || entry.lastSeenRunning !== true || !text) return;
        patchChild(agent.id, { notified: true });
        Promise.resolve()
          .then(() => deliverNotice(ctx, entry, agent.id, text))
          .catch((error) => {
            try {
              ctx.logger?.warn?.(`subagent-admin: 回执投递失败：${String((error && error.message) || error)}`);
            } catch {
              /* 日志也失败就算了 */
            }
          });
      }),
    'subagent-admin.status-watch',
  );
}

/** 只读一个请求体（限量 1MB）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 面板动作分发。 */
async function handleAction(ctx, body) {
  const action = String((body && body.action) || '');
  const id = String((body && body.id) || '');
  if (action === 'list') {
    const rows = listManaged(ctx, String(body.owner || ''), { includeHidden: body.includeHidden !== false });
    return { ok: true, rows };
  }
  if (action === 'spawn') {
    const owner = String(body.owner || '');
    const cwd = String(body.cwd || '') || cwdForOwner(ctx, owner);
    const spawned = await spawnDetached(ctx, {
      owner,
      cwd,
      task: String(body.task || ''),
      label: String(body.label || ''),
      notify: config.notifyOnComplete,
      start: body.start !== false,
      maxDepth: config.maxDepth,
    });
    return { ok: true, ...spawned };
  }
  if (action === 'seat-add') {
    const name = String(body.name || '').trim();
    if (!name) return { ok: false, error: '工位得有个名字' };
    const key = String(body.seat || name.toLowerCase()).trim();
    const seat = bindSeat({ seat: key, agent: body.agent, name, role: body.role });
    return { ok: true, seat };
  }
  if (!id) return { ok: false, error: '缺 id' };
  if (action === 'seat-rename') {
    const seat = renameSeat({ seat: id, name: body.name, role: body.role });
    return { ok: true, seat };
  }
  if (action === 'seat-retire') {
    const seat = retireSeat({ seat: id });
    return { ok: true, seat };
  }
  if (action === 'seat-revive') {
    const seat = reviveSeat({ seat: id });
    return { ok: true, seat };
  }
  if (action === 'seat-remove') {
    const seat = removeSeat({ seat: id });
    return { ok: true, seat };
  }
  if (action === 'stop') return stopChild(ctx, id);
  if (action === 'rename') return renameChild(ctx, id, String(body.title || ''));
  if (action === 'hide') return hideChild(ctx, id);
  if (action === 'restore') return restoreChild(ctx, id);
  return { ok: false, error: `不认识的 action：${action}` };
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const origin = (() => {
    try {
      return ctx.webServer.getOrigin();
    } catch {
      return '';
    }
  })();
  watchChildren(ctx);

  ctx.effect(() => ctx.tools.register({
    name: 'subagent_tree',
    description:
      'Read the Session tree: which subagents hang under the calling Session, which are running, and how much space they take. Read-only; it never deletes, stops, or changes anything.',
    isConcurrencySafe: () => true,
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['current', 'all'],
          description: 'current shows only the calling Session (default); all covers every Session',
        },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description: 'text renders an indented tree; json returns the structured payload the panel uses',
        },
        session: { type: 'string', description: 'Session id to inspect; defaults to the calling Session' },
        root: { type: 'string', description: 'Session storage root; defaults to ~/.dsh/sessions' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const a = args || {};
      const root = typeof a.root === 'string' && a.root ? a.root : defaultRoot();
      const payload = buildPayload(
        ctx,
        {
          root,
          scope: a.scope === 'all' ? 'all' : 'current',
          session: a.session || currentSessionId(exec),
        },
        config.renderStatuses,
        config.allowOpen,
      );
      if ((a.format || 'text') === 'json') return JSON.stringify(payload, null, 2);
      const managedLines = renderManaged(payload.managed || []);
      if (!payload.nodes.length) {
        return [`${payload.header || '（空）'}：没有子 agent。`, ...managedLines].join('\n');
      }
      // 页面拿的是结构化数据；文本模式把树再渲染一遍
      const roots = buildTree(scanSessions(root));
      const sid = payload.session;
      const node = sid ? findNode(roots, sid) : null;
      const view = payload.scope === 'all' ? roots : node ? node.children : [];
      const text = renderText(view, { now: Date.now(), header: payload.header });
      return [text, ...managedLines].join('\n');
    },
  }), 'subagent-tree/tool:tree');

  ctx.effect(() => ctx.tools.register({
    name: 'subagent_seat',
    description:
      'Seat ledger for detached subagents: list, bind, rename, retire, revive, remove. It records names and bindings only; it never creates or deletes Sessions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'bind', 'rename', 'retire', 'revive', 'remove'] },
        seat: { type: 'string', description: 'Seat id or name; bind creates it when it is unknown' },
        agent: { type: 'string', description: 'Agent name this seat stands for (used by bind)' },
        sessionId: { type: 'string', description: 'Optional child Session id to bind; named agents usually have none' },
        name: { type: 'string', description: 'Display name for rename' },
        role: { type: 'string', description: 'One-line description of what this seat does' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const a = args || {};
      try {
        if (a.action === 'bind') {
          const s = bindSeat({ seat: a.seat, agent: a.agent, sessionId: a.sessionId, name: a.name, role: a.role });
          return `工位 ${s.id}（${s.name}）→ agent「${s.agent || '还没绑'}」${s.sessionId ? '｜会话 ' + s.sessionId.slice(0, 10) : ''}${s.role ? '｜' + s.role : ''}`;
        }
        if (a.action === 'rename') {
          const s = renameSeat({ seat: a.seat, name: a.name, role: a.role });
          return `工位 ${s.id} 改成：${s.name}${s.role ? '｜' + s.role : ''}`;
        }
        if (a.action === 'retire') {
          const s = retireSeat({ seat: a.seat });
          return `工位 ${s.id}（${s.name}）已标退役，会话文件没动。`;
        }
        if (a.action === 'revive') {
          const s = reviveSeat({ seat: a.seat });
          return `工位 ${s.id}（${s.name}）恢复了。`;
        }
        if (a.action === 'remove') {
          const s = removeSeat({ seat: a.seat });
          return `工位 ${s.id}（${s.name}）从台账里删了（任何会话都没动）。`;
        }
        const seats = listSeats();
        if (!seats.length) return '还没有工位。用 action=bind 建第一个（必须带 seat 和 sessionId）。';
        return seats
          .map((s) => `${s.retiredAt ? '[退役] ' : ''}${s.id}｜${s.name}${s.role ? '｜' + s.role : ''}｜agent「${s.agent || '未绑'}」`)
          .join('\n');
      } catch (e) {
        return `没成：${(e && e.message) || e}`;
      }
    },
  }), 'subagent-tree/tool:seat');

  ctx.effect(() => ctx.tools.register({
    name: 'spawn_agent',
    description:
      'Start a detached subagent: a standalone Session outside the calling window\'s subagent catalog, so deleting or renaming it cannot damage that window. It cannot see this conversation, so make the task self-contained. By default it waits for completion and returns the final answer; with wait=false it returns immediately and a completion notice arrives later.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task for the child; it cannot see this conversation' },
        label: { type: 'string', description: 'Short display name used in the panel and completion notices' },
        start: { type: 'boolean', description: 'false creates an idle seat without running a task (default true)' },
        wait: { type: 'boolean', description: 'Wait for completion before returning (default true)' },
        timeout_ms: { type: 'integer', description: 'Wait budget in milliseconds; defaults to the plugin config' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const a = args || {};
      const ownerAgent = exec.agent;
      const ownerId = sessionIdOf(ownerAgent);
      if (!ownerId) return '没拿到当前会话 id，没法记归属，先不派。';
      const cwd =
        (ownerAgent && ownerAgent.session && ownerAgent.session.header && ownerAgent.session.header.cwd) || '';
      const wait = a.wait !== false;
      const start = a.start !== false;
      let spawned;
      try {
        spawned = await spawnDetached(ctx, {
          owner: ownerId,
          cwd,
          task: a.task,
          label: a.label,
          notify: !wait,
          start,
          signal: exec.signal,
        });
      } catch (error) {
        return `没派成：${(error && error.message) || error}`;
      }
      const shortId = spawned.id.slice(0, 10);
      if (!start) return `建好了：${shortId}「${spawned.label}」（待命，没派任务）`;
      if (!wait) {
        return `分离型子 agent「${spawned.label}」开跑了（${shortId}）。\n它跑完会给你回一条消息；也可以 manage_subagents action=list 看状态。`;
      }
      let result;
      try {
        result = await waitForChild(
          ctx,
          spawned.id,
          Number(a.timeout_ms) || config.defaultTimeoutMs,
          exec.signal,
          config.maxWaitMs,
        );
      } catch (error) {
        patchChild(spawned.id, { notify: true, notified: false });
        return `「${spawned.label}」已经开跑（${shortId}），但等待出错：${(error && error.message) || error}。跑完会给你回一条。`;
      }
      if (result.reason === 'input-required') {
        patchChild(spawned.id, { notify: true, notified: false });
        return `「${spawned.label}」停在等你回话（${shortId}）：它要审批或要答案，去面板里打开它看看。`;
      }
      if (result.reason === 'timeout' || result.running) {
        patchChild(spawned.id, { notify: true, notified: false });
        return `「${spawned.label}」还在跑（${shortId}），跑完会给你回一条。`;
      }
      patchChild(spawned.id, {
        status: 'done',
        lastText: (result.text || '').slice(0, 4000),
        finishedAt: Date.now(),
        notified: true,
      });
      return result.text
        ? `「${spawned.label}」跑完了：\n\n${result.text}`
        : `「${spawned.label}」跑完了，但没有文字答复（${shortId}）。`;
    },
  }), 'subagent-tree/tool:spawn');

  ctx.effect(() => ctx.tools.register({
    name: 'manage_subagents',
    description:
      'Manage detached subagents: list, stop the current turn, rename, hide (soft delete: ledger plus archive, files untouched), restore. It touches only the plugin ledger and the child Session, never the calling window\'s structure.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'stop', 'rename', 'hide', 'restore'] },
        id: { type: 'string', description: 'Child Session id; omit for list' },
        title: { type: 'string', description: 'New name for rename' },
        all: { type: 'boolean', description: 'list across every owner Session (default: only the calling one)' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const a = args || {};
      try {
        if (a.action === 'list') {
          const rows = listManaged(ctx, a.all ? '' : currentSessionId(exec), { includeHidden: true });
          if (!rows.length) return '名下还没有分离型子 agent。用 spawn_agent 派一个。';
          return renderManaged(rows).join('\n');
        }
        if (!a.id) return '要带 id（子 agent 的会话 id）。';
        if (a.action === 'stop') {
          const r = stopChild(ctx, a.id);
          return r.ok ? `已让它停：${a.id.slice(0, 10)}` : `没停：${r.reason}`;
        }
        if (a.action === 'rename') {
          const r = await renameChild(ctx, a.id, a.title);
          return `改好了：${r.title}`;
        }
        if (a.action === 'hide') {
          const r = await hideChild(ctx, a.id);
          return r.archived
            ? `已隐藏并归档：${a.id.slice(0, 10)}（会话文件没动，可 restore 恢复）`
            : `已在台账里隐藏：${a.id.slice(0, 10)}（归档没成功：${r.note || '未知原因'}）`;
        }
        if (a.action === 'restore') {
          await restoreChild(ctx, a.id);
          return `已恢复：${a.id.slice(0, 10)}`;
        }
        return `不认识的 action：${a.action}`;
      } catch (error) {
        return `没成：${(error && error.message) || error}`;
      }
    },
  }), 'subagent-tree/tool:manage');

  // 页面用的数据口：GET /subagent-admin/tree?session=<id>&scope=current|all
  ctx.effect(() => ctx.webServer.register({
    path: '/subagent-admin/tree',
    kind: 'exact',
    resource(request) {
      const denied = checkPanelRequest(request, origin);
      if (denied) {
        return new Response(JSON.stringify({ error: denied }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      const url = new URL(request.url, 'http://local');
      const session = url.searchParams.get('session') || '';
      const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'current';
      let payload;
      try {
        payload = buildPayload(
          ctx,
          { root: defaultRoot(), scope, session },
          config.renderStatuses,
          config.allowOpen,
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    },
  }), 'subagent-tree/route:tree');

  // 归属查询口：GET /subagent-admin/owner?id=<childId>
  // 给子 agent 自己的页面用：这页显示的小孩是谁派的，好挂一个「返回主会话」。
  ctx.effect(() => ctx.webServer.register({
    path: '/subagent-admin/owner',
    kind: 'exact',
    resource(request) {
      const denied = checkPanelRequest(request, origin);
      if (denied) {
        return new Response(JSON.stringify({ ok: false, error: denied }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      const url = new URL(request.url, 'http://local');
      const id = url.searchParams.get('id') || '';
      let row = null;
      try {
        row = id ? getChild(id) : null;
      } catch {
        row = null;
      }
      const body = row
        ? { ok: true, owner: row.owner || '', name: row.title || row.label || '', depth: row.depth || 1, status: row.status || '' }
        : { ok: false };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  }), 'subagent-tree/route:owner');

  // 面板预览口：GET /subagent-admin/preview?id=<id>&limit=20
  ctx.effect(() => ctx.webServer.register({
    path: '/subagent-admin/preview',
    kind: 'exact',
    async resource(request) {
      const denied = checkPanelRequest(request, origin);
      if (denied) {
        return new Response(JSON.stringify({ ok: false, error: denied }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      const url = new URL(request.url, 'http://local');
      const id = url.searchParams.get('id') || '';
      const limit = Math.max(2, Math.min(Number(url.searchParams.get('limit')) || 20, 60));
      const reply = (status, value) => new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
      if (!config.allowPreview) return reply(403, { ok: false, error: '配置里关了 allowPreview' });
      if (!id) return reply(400, { ok: false, error: '缺 id' });
      try {
        const value = await ctx.sessionController.events(
          { address: { kind: 'session', sessionId: id }, maxMessages: limit },
          new AbortController().signal,
        );
        const rows = [];
        for (const record of (value && value.records) || []) {
          const ev = record && record.event ? record.event : record;
          if (!ev || !ev.type) continue;
          if (ev.type === 'user/message') {
            const kind = ev.data && ev.data.source && ev.data.source.kind;
            if (kind && kind !== 'user') continue;
          }
          let role = '';
          let content = null;
          if (ev.type === 'user/message') {
            role = 'user';
            content = ev.data && ev.data.content;
          } else if (ev.type === 'assistant/message') {
            role = 'assistant';
            content = ev.data && ev.data.message && ev.data.message.content;
          }
          if (!role || !Array.isArray(content)) continue;
          const text = content
            .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('\n')
            .trim();
          if (text) rows.push({ role, text: text.slice(0, 2000) });
        }
        return reply(200, { ok: true, rows });
      } catch (error) {
        return reply(200, { ok: false, error: String((error && error.message) || error) });
      }
    },
  }), 'subagent-tree/route:preview');

  // 面板动作口：POST /subagent-admin/act  {action, owner, id, title, task, label}
  ctx.effect(() => ctx.webServer.register({
    path: '/subagent-admin/act',
    kind: 'exact',
    async handler(req, res) {
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' });
      const denied = checkPanelRequest(req, origin);
      if (denied) return send(403, { ok: false, error: denied });
      const notJson = checkJsonRequest(req);
      if (notJson) return send(415, { ok: false, error: notJson });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (error) {
        return send(400, { ok: false, error: `请求体不是 JSON：${(error && error.message) || error}` });
      }
      try {
        const result = await handleAction(ctx, body);
        return send(200, result);
      } catch (error) {
        return send(200, { ok: false, error: String((error && error.message) || error) });
      }
    },
  }), 'subagent-tree/route:act');
}
