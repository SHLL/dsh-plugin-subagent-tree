// 浏览器半边：会话里的「子 agent」页（和「对话 / 轨迹」并排的第三个标签）。
// 两块：
//   ① 分离型子 agent —— 能派活、能停、能改名、能隐藏/恢复。它们是独立会话，
//      归属只记在插件台账里，所以这些操作永远不会动到当前窗口的会话结构。
//   ② 这轮会话的树 / 常驻工位 —— 只读，只有「停」是安全的（只取消当前一轮）。
//
// 规矩：不 import 任何 @deepseek-ai/*；React 由模块加载器给；颜色只用系统色。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-subagent-tree',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'subagent-tree';
    const DICT = {
      zh: { 'view.subagents': 'sub-agent tree' },
      en: { 'view.subagents': 'sub-agent tree' },
    };

    /** apply 里注入的客户端能力（打开会话）。 */
    let api = { openSession: null };

    /** 待切视图：返回主会话后，把那一页的视图切回「对话」。 */
    let pendingView = null;

    function humanBytes(b) {
      if (!b) return '-';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
      return (b / 1024 / 1024).toFixed(1) + ' MB';
    }

    // 中间表兜底：服务端（插件配置 renderStatuses）没给时用这一份。
    // running/idle/done 算在用；stopped/archived/failed 默认不渲染（勾「显示已停」才看）。
    const DEFAULT_RENDER_STATUS = ['running', 'idle', 'done'];

    const STATE_META = {
      running: { mark: '▶', label: '在跑', color: 'var(--dsw-alias-state-success-primary, #2ea043)' },
      inactive: { mark: '·', label: '睡着', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 45%, transparent)' },
      unavailable: { mark: '×', label: '失效', color: 'var(--dsw-alias-state-error-primary, #d1242f)' },
      named: { mark: '●', label: '命名工位', color: 'var(--dsw-alias-state-success-primary, #2ea043)' },
      retired: { mark: '—', label: '已退役', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 40%, transparent)' },
      unbound: { mark: '○', label: '未绑', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 40%, transparent)' },
      idle: { mark: '·', label: '待命', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 45%, transparent)' },
      done: { mark: '✓', label: '跑完', color: 'var(--dsw-alias-state-success-primary, #2ea043)' },
      stopped: { mark: '■', label: '停了', color: 'var(--dsw-alias-state-warn-primary, #bf8700)' },
      archived: { mark: '▢', label: '已隐藏', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 40%, transparent)' },
      failed: { mark: '×', label: '失败', color: 'var(--dsw-alias-state-error-primary, #d1242f)' },
    };

    const btn = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 18%, transparent)',
      borderRadius: 7,
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, CanvasText)',
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };

    const btnMini = { ...btn, height: 22, padding: '0 7px', fontSize: 11, borderRadius: 6 };

    const subtle = 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 55%, transparent)';

    async function callAdmin(body) {
      const res = await fetch('/subagent-admin/act', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-subagent-admin': '1' },
        body: JSON.stringify(body),
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = { ok: false, error: 'HTTP ' + res.status };
      }
      return json || { ok: false, error: '空响应' };
    }

    /** 复制到剪贴板（Electron 里 localhost 算安全上下文，失败再退回 execCommand）。 */
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(String(text));
        return true;
      } catch {
        try {
          const el = document.createElement('textarea');
          el.value = String(text);
          el.style.position = 'fixed';
          el.style.opacity = '0';
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
          return true;
        } catch {
          return false;
        }
      }
    }

    /** 菜单贴鼠标，但不越出窗口。 */
    function menuAt(event, height) {
      const pad = 8;
      const width = 220;
      const x = Math.max(pad, Math.min(event.clientX, window.innerWidth - width - pad));
      const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - height - pad));
      return { x, y };
    }

    function TreeRow({ node, depth, seat, onStop, onMenu }) {
      const meta = STATE_META[node.state] || STATE_META.inactive;
      const [hover, setHover] = React.useState(false);
      return h(
        'div',
        {
          onContextMenu: (event) => {
            event.preventDefault();
            onMenu && onMenu(event, node);
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 12px 6px ' + (14 + depth * 20) + 'px',
            borderRadius: 6,
            background: hover ? 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 11%, transparent)' : 'transparent',
            transition: 'background 120ms',
            opacity: node.state === 'unavailable' ? 0.55 : 1,
          },
        },
        h('span', { style: { width: 10, color: meta.color, fontSize: 11 } }, meta.mark),
        h(
          'span',
          {
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 12.5,
              letterSpacing: '.2px',
            },
          },
          node.name,
        ),
        seat
          ? h(
              'span',
              {
                style: {
                  fontSize: 10.5,
                  padding: '1px 6px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 25%, transparent)',
                  opacity: 0.85,
                },
              },
              '工位·' + seat.name,
            )
          : null,
        h(
          'span',
          {
            style: {
              fontSize: 10.5,
              padding: '1px 6px',
              borderRadius: 999,
              color: meta.color,
              border:
                '1px solid color-mix(in srgb, ' +
                (node.state === 'running' ? 'var(--dsw-alias-state-success-primary, #2ea043)' : 'var(--dsw-alias-label-primary, CanvasText)') +
                ' 30%, transparent)',
            },
          },
          meta.label,
        ),
        h('span', { style: { flex: 1, borderBottom: '1px dotted color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 15%, transparent)' } }),
        node.state === 'running'
          ? h(
              'button',
              {
                type: 'button',
                style: btnMini,
                title: '只停它当前这一轮，会话留着',
                onClick: () => onStop && onStop(node.id),
              },
              '停',
            )
          : null,
        h('span', { style: { fontSize: 11, opacity: 0.6, fontVariantNumeric: 'tabular-nums' } }, 'L' + node.absDepth),
        h(
          'span',
          { style: { fontSize: 11, opacity: 0.6, fontVariantNumeric: 'tabular-nums' } },
          node.ageMinutes == null ? '?' : node.ageMinutes + ' 分',
        ),
        h(
          'span',
          {
            style: {
              fontSize: 11,
              opacity: 0.6,
              width: 64,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            },
          },
          humanBytes(node.bytes),
        ),
      );
    }

    /** 折叠页标题条：点一下展开/收起。 */
    function SectionHeader({ title, count, open, onToggle, right }) {
      return h(
        'div',
        {
          onClick: onToggle,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 12px 6px',
            cursor: 'pointer',
            userSelect: 'none',
          },
        },
        h('span', { style: { width: 10, fontSize: 8, color: subtle, opacity: 0.8 } }, open ? '▼' : '▶'),
        h('span', { style: { fontSize: 11, letterSpacing: '.4px', opacity: 0.65 } }, title),
        h('span', { style: { fontSize: 10.5, opacity: 0.45 } }, count == null ? '' : String(count)),
        h('span', { style: { flex: 1 } }),
        right ? h('span', { onClick: (event) => event.stopPropagation() }, right) : null,
      );
    }

    /** 一条常驻工位。 */
    function SeatRow({ seat, busy, onRevive, onRemove, onMenu }) {
      const meta = STATE_META[seat.state] || { mark: '·', label: seat.state || '未知', color: 'var(--dsw-alias-label-primary, CanvasText)' };
      const [hover, setHover] = React.useState(false);
      return h(
        'div',
        {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onContextMenu: (event) => {
            event.preventDefault();
            onMenu(event, seat);
          },
          style: {
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            padding: '6px 12px',
            borderRadius: 6,
            background: hover ? 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 11%, transparent)' : 'transparent',
            transition: 'background 120ms',
            opacity: seat.retiredAt ? 0.6 : 1,
          },
        },
        h('span', { style: { width: 10, color: meta.color, fontSize: 11 } }, meta.mark),
        h('strong', { style: { fontSize: 12.5, minWidth: 84 } }, seat.name),
        seat.role ? h('span', { style: { fontSize: 11.5, opacity: 0.7 } }, seat.role) : null,
        h('span', { style: { flex: 1, borderBottom: '1px dotted color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 15%, transparent)' } }),
        seat.retiredAt
          ? h('button', { type: 'button', style: btnMini, disabled: busy, onClick: () => onRevive(seat) }, '恢复')
          : null,
        h('button', { type: 'button', style: btnMini, disabled: busy, onClick: () => onRemove(seat) }, '删'),
        h('span', { style: { fontSize: 11, opacity: 0.65 } }, meta.label),
        h(
          'span',
          { style: { fontSize: 11, opacity: 0.55, fontFamily: 'ui-monospace, monospace' } },
          seat.agent ? seat.agent : '未绑工位',
        ),
      );
    }

    /**
     * 分离型子 agent 的悬浮卡：挂在三个标签栏下面，只在插件管的子 agent 页出现。
     * 走 document.body 直接挂 DOM——header 槽位有 overflow 裁剪，fixed 在里头会被切掉。
     */
    function BackBar(props) {
      const sessionId = props.sessionId || '';
      const [row, setRow] = React.useState(null);

      React.useEffect(() => {
        let alive = true;
        if (!sessionId) {
          setRow(null);
          return () => {
            alive = false;
          };
        }
        fetch('/subagent-admin/owner?id=' + encodeURIComponent(sessionId), {
          cache: 'no-store',
          headers: { 'x-subagent-admin': '1' },
        })
          .then((res) => res.json())
          .then((value) => {
            if (alive) setRow(value && value.ok && value.owner ? value : null);
          })
          .catch(() => {
            if (alive) setRow(null);
          });
        return () => {
          alive = false;
        };
      }, [sessionId]);

      const ownerId = row && row.owner ? row.owner : '';
      const owner = props.useSessions
        ? props.useSessions((state) => (ownerId ? state.byId[ownerId] : undefined))
        : undefined;
      const ownerTitle = (owner && (owner.displayTitle || owner.title)) || ownerId.slice(0, 12);

      React.useEffect(() => {
        if (!ownerId) return undefined;

        // 整条横栏：贴在标签栏下面，占满内容区宽度
        const bar = document.createElement('div');
        Object.assign(bar.style, {
          position: 'fixed',
          top: '128px',
          left: '300px',
          width: 'calc(100vw - 300px)',
          height: '44px',
          zIndex: '9100',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '0 16px',
          boxSizing: 'border-box',
          background: 'var(--dsw-alias-bg-base, Canvas)',
          color: 'var(--dsw-alias-label-primary, CanvasText)',
          borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 12%, transparent)',
          fontFamily: 'inherit',
          fontSize: '13px',
        });

        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = '← 返回主会话';
        back.title = '回到 ' + ownerTitle;
        Object.assign(back.style, {
          display: 'inline-flex',
          alignItems: 'center',
          height: '28px',
          padding: '0 12px',
          borderRadius: '7px',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 28%, transparent)',
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary, CanvasText)',
          fontSize: '12.5px',
          fontWeight: '600',
          cursor: 'pointer',
          fontFamily: 'inherit',
          flex: '0 0 auto',
        });
        back.addEventListener('click', () => {
          pendingView = { sessionId: ownerId, at: Date.now() };
          try {
            if (api.openSession) api.openSession(ownerId);
          } catch {
            /* 打不开就算了 */
          }
        });
        bar.appendChild(back);

        // 中间：绿点 + 标题，整体居中
        const mid = document.createElement('div');
        Object.assign(mid.style, {
          position: 'absolute',
          left: '0',
          right: '0',
          top: '0',
          bottom: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '0 150px',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          minWidth: '0',
        });

        const dot = document.createElement('span');
        Object.assign(dot.style, {
          width: '7px',
          height: '7px',
          borderRadius: '999px',
          background: 'var(--dsw-alias-state-success-primary, #2ea043)',
          flex: '0 0 auto',
        });
        mid.appendChild(dot);

        const title = document.createElement('span');
        title.textContent = '分离型子 agent' + (row && row.name ? ' · ' + row.name : '');
        title.title = '这条会话是分离型子 agent：不进任何窗口的子 agent 目录，删改不动窗口结构';
        Object.assign(title.style, {
          color: 'var(--dsw-alias-label-primary, CanvasText)',
          fontSize: '14px',
          fontWeight: '600',
          letterSpacing: '.2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        });
        mid.appendChild(title);

        bar.appendChild(mid);

        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = '收起来（只是这页不显示）';
        Object.assign(close.style, {
          border: 'none',
          background: 'transparent',
          color: 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 45%, transparent)',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: '1',
          padding: '0 4px',
          fontFamily: 'inherit',
          flex: '0 0 auto',
          marginLeft: 'auto',
        });
        close.addEventListener('click', () => {
          bar.remove();
        });
        bar.appendChild(close);

        document.body.appendChild(bar);

        // 量三个标签栏的位置和内容区宽度，把横栏贴上去
        const measure = () => {
          try {
            const nodes = Array.from(document.querySelectorAll('button, [role="tab"], a'));
            const tab = nodes.find(
              (el) => el.textContent.trim() === '对话' && el.getBoundingClientRect().top < 300,
            );
            if (!tab) return;
            let box = tab;
            for (let i = 0; i < 8 && box.parentElement; i += 1) {
              if (box.getBoundingClientRect().width >= window.innerWidth * 0.55) break;
              box = box.parentElement;
            }
            const rect = box.getBoundingClientRect();
            bar.style.top = Math.round(rect.bottom) + 'px';
            bar.style.left = Math.round(rect.left) + 'px';
            bar.style.width = Math.round(rect.width) + 'px';
          } catch {
            /* 量不到就用默认位置 */
          }
        };
        measure();
        window.addEventListener('resize', measure);

        return () => {
          window.removeEventListener('resize', measure);
          bar.remove();
        };
      }, [ownerId, ownerTitle, row && row.name]);

      return null;
    }

    /** 一条分离型子 agent。 */
    function ManagedRow({ row, busy, allowOpen, onAct, onPreview, onOpen, onMenu }) {
      const meta = STATE_META[row.status] || STATE_META.idle;
      const [hover, setHover] = React.useState(false);
      const dim = row.hidden || row.status === 'archived';
      return h(
        'div',
        {
          onContextMenu: (event) => {
            event.preventDefault();
            onMenu && onMenu(event, row);
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 6,
            background: hover ? 'color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 11%, transparent)' : 'transparent',
            transition: 'background 120ms',
            opacity: dim ? 0.55 : 1,
          },
        },
        h('span', { style: { width: 10, color: meta.color, fontSize: 11 } }, meta.mark),
        h(
          'span',
          { style: { fontSize: 12.5, fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          row.name,
        ),
        h(
          'span',
          {
            style: {
              fontSize: 10.5,
              padding: '1px 6px',
              borderRadius: 999,
              color: meta.color,
              border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 25%, transparent)',
            },
          },
          meta.label,
        ),
        h(
          'span',
          { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          row.lastText ? row.lastText.replace(/\s+/g, ' ') : '（还没答复）',
        ),
        h(
          'span',
          { style: { fontSize: 10.5, color: subtle, fontFamily: 'ui-monospace, monospace' } },
          row.id.slice(0, 10),
        ),
        row.hidden || row.archived || !allowOpen
          ? null
          : h('button', { type: 'button', style: btnMini, onClick: () => onOpen(row.id) }, '打开'),
        h('button', { type: 'button', style: btnMini, onClick: () => onPreview(row) }, '查看'),
        row.status === 'running'
          ? h('button', { type: 'button', style: btnMini, disabled: busy, onClick: () => onAct(row, 'stop') }, '停')
          : null,
        row.hidden
          ? h('button', { type: 'button', style: btnMini, disabled: busy, onClick: () => onAct(row, 'restore') }, '恢复')
          : h(
              'button',
              { type: 'button', style: btnMini, disabled: busy, onClick: () => onAct(row, 'rename') },
              '改名',
            ),
        row.hidden
          ? null
          : h(
              'button',
              { type: 'button', style: { ...btnMini, color: 'var(--dsw-alias-state-error-primary, #d1242f)' }, disabled: busy, onClick: () => onAct(row, 'hide') },
              '隐藏',
            ),
      );
    }

    function SubagentView(props) {
      const sessionId = props.sessionId || '';
      const [scope, setScope] = React.useState('current');
      const [data, setData] = React.useState(null);
      const [err, setErr] = React.useState('');
      const [loading, setLoading] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [task, setTask] = React.useState('');
      const [note, setNote] = React.useState('');
      // Electron 不支持 window.prompt，改名统一走页内弹窗。
      const [dialog, setDialog] = React.useState(null);

      // 已停/已归档的默认不渲染
      const [showInactive, setShowInactive] = React.useState(() => {
        try {
          return window.localStorage.getItem('subagent-tree/showInactive') === '1';
        } catch {
          return false;
        }
      });
      const setShowInactivePref = (next) => {
        setShowInactive(next);
        try {
          window.localStorage.setItem('subagent-tree/showInactive', next ? '1' : '0');
        } catch {
          /* 存不了就算了 */
        }
      };

      // 折叠页：状态记在浏览器本地，下次进来还是你上次那样
      const [fold, setFold] = React.useState(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem('subagent-tree/fold') || '{}');
          return { managed: false, seats: false, tree: false, ...saved };
        } catch {
          return { managed: false, seats: false, tree: false };
        }
      });
      const toggleFold = (key) => {
        const next = { ...fold, [key]: !fold[key] };
        setFold(next);
        try {
          window.localStorage.setItem('subagent-tree/fold', JSON.stringify(next));
        } catch {
          /* 存不了就算了 */
        }
      };

      const load = React.useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
          const q = new URLSearchParams({ scope });
          if (sessionId) q.set('session', sessionId);
          const res = await fetch('/subagent-admin/tree?' + q.toString(), {
            cache: 'no-store',
            headers: { 'x-subagent-admin': '1' },
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          setData(await res.json());
        } catch (e) {
          setErr(String((e && e.message) || e));
        } finally {
          setLoading(false);
        }
      }, [scope, sessionId]);

      React.useEffect(() => {
        load();
      }, [load]);

      const [preview, setPreview] = React.useState({ id: '', rows: null, error: '', loading: false });

      const onOpen = React.useCallback((id) => {
        try {
          if (!api.openSession) throw new Error('这个版本没有 uiWorkspace');
          api.openSession(id);
          setNote(`已切到这个会话：${String(id).slice(0, 10)}`);
        } catch (e) {
          setNote(`打开失败：${String((e && e.message) || e)}`);
        }
      }, []);

      const onPreview = React.useCallback(
        async (row) => {
          if (preview.id === row.id) {
            setPreview({ id: '', rows: null, error: '', loading: false });
            return;
          }
          setPreview({ id: row.id, rows: null, error: '', loading: true });
          try {
            const res = await fetch('/subagent-admin/preview?id=' + encodeURIComponent(row.id) + '&limit=30', {
              cache: 'no-store',
              headers: { 'x-subagent-admin': '1' },
            });
            const body = await res.json();
            setPreview({
              id: row.id,
              rows: body.rows || [],
              error: body.ok === false ? body.error || '读取失败' : '',
              loading: false,
            });
          } catch (e) {
            setPreview({ id: row.id, rows: [], error: String((e && e.message) || e), loading: false });
          }
        },
        [preview.id],
      );

      const openPrompt = (title, value, onOk, optional = false) =>
        setDialog({ title, value: value || '', onOk, optional });

      const submitDialog = () => {
        if (!dialog) return;
        const value = String(dialog.value || '').trim();
        if (!value && !dialog.optional) return;
        const run = dialog.onOk;
        setDialog(null);
        if (run) run(value);
      };

      const sendAct = React.useCallback(
        async (row, action, title) => {
          setBusy(true);
          try {
            const result = await callAdmin({ action, id: row.id, title });
            if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
            else if (action === 'stop') setNote('已让它停（只停当前这一轮）');
            await load();
          } catch (e) {
            setNote(`没成：${String((e && e.message) || e)}`);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const onAct = React.useCallback(
        (row, action) => {
          setNote('');
          if (action === 'rename') {
            openPrompt('新名字', row.title || row.label || '', (value) => sendAct(row, 'rename', value));
            return;
          }
          if (action === 'hide') {
            const ok = window.confirm(`隐藏「${row.name}」？\n\n只在台账里隐藏并归档，会话文件一个字节都不动，随时能恢复。`);
            if (!ok) return;
          }
          sendAct(row, action);
        },
        [openPrompt, sendAct],
      );

      const onStopTree = React.useCallback(async (id) => {
        setBusy(true);
        try {
          const result = await fetch('/subagent-admin/act', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-subagent-admin': '1' },
            body: JSON.stringify({ action: 'stop', id }),
          }).then((r) => r.json());
          if (!result.ok) setNote(`没停：${result.error || '未知原因'}`);
          await load();
        } catch (e) {
          setNote(`没停：${String((e && e.message) || e)}`);
        } finally {
          setBusy(false);
        }
      }, [load]);

      const onSpawn = React.useCallback(async () => {
        const text = task.trim();
        if (!text) return;
        setBusy(true);
        setNote('');
        try {
          const result = await callAdmin({ action: 'spawn', owner: sessionId, task: text });
          if (!result.ok) setNote(`没派成：${result.error || '未知原因'}`);
          else {
            setTask('');
            setNote(`派出去了：${String(result.id).slice(0, 10)}，跑完会在这个窗口回一条`);
          }
          await load();
        } catch (e) {
          setNote(`没派成：${String((e && e.message) || e)}`);
        } finally {
          setBusy(false);
        }
      }, [task, sessionId, load]);

      // 从子 agent 页点「返回主会话」回来时，把这个窗口的视图切回「对话」
      React.useEffect(() => {
        if (!pendingView || pendingView.sessionId !== props.sessionId) return;
        if (Date.now() - pendingView.at > 8000) {
          pendingView = null;
          return;
        }
        pendingView = null;
        const openView = props.openView;
        if (typeof openView !== 'function') return;
        window.setTimeout(() => {
          try {
            openView('chat', '');
          } catch {
            /* 切不了就算了 */
          }
        }, 0);
      }, [props.sessionId, props.openView]);

      // ── 右键菜单 ───────────────────────────────────────────
      const [menu, setMenu] = React.useState(null);
      const menuRef = React.useRef(null);

      React.useEffect(() => {
        if (!menu) return;
        const onDown = (e) => {
          if (menuRef.current && menuRef.current.contains(e.target)) return;
          setMenu(null);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') setMenu(null);
        };
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
          window.removeEventListener('mousedown', onDown, true);
          window.removeEventListener('keydown', onKey);
        };
      }, [menu]);

      const copyTo = React.useCallback(async (text) => {
        const ok = await copyText(text);
        setNote(ok ? '已复制' : '复制失败');
      }, []);

      const openManagedMenu = React.useCallback(
        (event, row) => {
          const items = [
            row.hidden || row.archived || !allowOpen ? null : { label: '打开会话', run: () => onOpen(row.id) },
            { label: '查看对话', run: () => onPreview(row) },
            row.status === 'running' ? { label: '停（只停这一轮）', run: () => onAct(row, 'stop') } : null,
            { label: '改名…', run: () => onAct(row, 'rename') },
            row.hidden
              ? { label: '恢复', run: () => onAct(row, 'restore') }
              : { label: '隐藏（软删 + 归档）', danger: true, run: () => onAct(row, 'hide') },
            { label: '复制会话 id', run: () => copyTo(row.id) },
            row.lastText ? { label: '复制最后答复', run: () => copyTo(row.lastText) } : null,
          ].filter(Boolean);
          setMenu({ ...menuAt(event, items.length * 30 + 40), title: row.name, items });
        },
        [onAct, onPreview, onOpen, copyTo, allowOpen],
      );

      const openTreeMenu = React.useCallback(
        (event, node) => {
          const items = [
            node.state === 'running' ? { label: '停（只停这一轮）', run: () => onStopTree(node.id) } : null,
            { label: '复制会话 id', run: () => copyTo(node.id) },
            { label: '复制名字', run: () => copyTo(node.name) },
          ].filter(Boolean);
          setMenu({ ...menuAt(event, items.length * 30 + 36), title: node.name, items });
        },
        [onStopTree, copyTo],
      );

      const seatSend = React.useCallback(
        async (seat, patch) => {
          setBusy(true);
          try {
            const result = await callAdmin({ action: 'seat-rename', id: seat.id, ...patch });
            if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
            else setNote(`工位「${seat.name}」改好了`);
            await load();
          } catch (e) {
            setNote(`没成：${String((e && e.message) || e)}`);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const seatEdit = React.useCallback(
        (seat, nameOnly) => {
          openPrompt(
            nameOnly ? '工位新名字' : '角色说明（一句话）',
            nameOnly ? seat.name : seat.role || '',
            (value) => seatSend(seat, nameOnly ? { name: value } : { role: value }),
          );
        },
        [openPrompt, seatSend],
      );

      const seatRetire = React.useCallback(
        async (seat) => {
          if (!window.confirm(`退役工位「${seat.name}」？\n\n只改台账，不动任何会话。`)) return;
          setBusy(true);
          try {
            const result = await callAdmin({ action: 'seat-retire', id: seat.id });
            if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
            else setNote(`工位「${seat.name}」退役了`);
            await load();
          } catch (e) {
            setNote(`没成：${String((e && e.message) || e)}`);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const seatRevive = React.useCallback(
        async (seat) => {
          setBusy(true);
          try {
            const result = await callAdmin({ action: 'seat-revive', id: seat.id });
            if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
            else setNote(`工位「${seat.name}」恢复了`);
            await load();
          } catch (e) {
            setNote(`没成：${String((e && e.message) || e)}`);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const seatRemove = React.useCallback(
        async (seat) => {
          if (!window.confirm(`把工位「${seat.name}」从活页夹里抽掉？\n\n只删这一行台账，不碰任何会话。`)) return;
          setBusy(true);
          try {
            const result = await callAdmin({ action: 'seat-remove', id: seat.id });
            if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
            else setNote(`工位「${seat.name}」删了`);
            await load();
          } catch (e) {
            setNote(`没成：${String((e && e.message) || e)}`);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const seatAdd = React.useCallback(() => {
        openPrompt('新工位名字', '', (name) => {
          openPrompt(
            '它做什么（一句话，可空）',
            '',
            async (role) => {
              setBusy(true);
              try {
                const result = await callAdmin({ action: 'seat-add', name, role });
                if (!result.ok) setNote(`没成：${result.error || '未知原因'}`);
                else setNote(`工位「${name}」加好了`);
                await load();
              } catch (e) {
                setNote(`没成：${String((e && e.message) || e)}`);
              } finally {
                setBusy(false);
              }
            },
            true,
          );
        });
      }, [openPrompt, load]);

      const openSeatMenu = React.useCallback(
        (event, seat) => {
          const items = [
            seat.retiredAt ? { label: '恢复工位', run: () => seatRevive(seat) } : null,
            { label: '改角色说明…', run: () => seatEdit(seat, false) },
            { label: '改名…', run: () => seatEdit(seat, true) },
            { label: '复制工位信息', run: () => copyTo(`${seat.name}｜${seat.role || ''}｜${seat.agent || '未绑'}`) },
            seat.retiredAt ? null : { label: '退役', danger: true, run: () => seatRetire(seat) },
            { label: '删掉工位', danger: true, run: () => seatRemove(seat) },
          ].filter(Boolean);
          setMenu({ ...menuAt(event, items.length * 30 + 40), title: '工位 ' + seat.name, items });
        },
        [seatEdit, seatRetire, seatRevive, seatRemove, copyTo],
      );

      const seats = (data && data.seats) || [];
      const managed = (data && data.managed) || [];
      // 只留中间表里算「启用」的；刷新时重新算，所以停/归档的会立刻从列表里消失
      const renderStatuses = new Set(
        data && Array.isArray(data.renderStatuses) && data.renderStatuses.length
          ? data.renderStatuses
          : DEFAULT_RENDER_STATUS,
      );
      const allowOpen = !data || data.allowOpen !== false;
      const shown = managed.filter((row) => showInactive || renderStatuses.has(row.status));
      const seatBySession = new Map(seats.filter((x) => x.sessionId).map((x) => [x.sessionId, x]));

      const seatRows = seats.map((seat) =>
        h(SeatRow, {
          key: 'seat-' + seat.id,
          seat,
          busy,
          onRevive: seatRevive,
          onRemove: seatRemove,
          onMenu: openSeatMenu,
        }),
      );

      const rows = [];
      const walk = (node, depth) => {
        rows.push(h(TreeRow, { key: node.id, node, depth, seat: seatBySession.get(node.id), onStop: onStopTree, onMenu: openTreeMenu }));
        for (const c of node.children || []) walk(c, depth + 1);
      };
      for (const n of (data && data.nodes) || []) walk(n, 0);

      const sum = (data && data.summary) || {};
      const managedVisible = shown.length;

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            color: 'var(--dsw-alias-label-primary, CanvasText)',
            fontFamily: 'inherit',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 12%, transparent)',
              flex: '0 0 auto',
            },
          },
          h('strong', { style: { fontSize: 13 } }, '子 agent'),
          h(
            'span',
            { style: { fontSize: 12, opacity: 0.65 } },
            `${data && data.scope === 'all' ? '全部会话' : '当前会话'} · 分离型 ${managedVisible} · 树里 ${sum.total || 0} 个（在跑 ${sum.running || 0} / 失效 ${sum.unavailable || 0} / ${humanBytes(sum.bytes || 0)}）`,
          ),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: btn, onClick: () => setScope(scope === 'all' ? 'current' : 'all') }, scope === 'all' ? '只看当前会话' : '看全部会话'),
          h('button', { type: 'button', style: btn, onClick: load, disabled: loading || busy }, loading ? '刷新中…' : '刷新'),
        ),
        err ? h('div', { style: { padding: 16, color: 'var(--dsw-alias-state-error-primary, #d1242f)', fontSize: 12.5 } }, '读取失败：' + err) : null,
        note ? h('div', { style: { padding: '8px 16px', fontSize: 12, color: subtle, borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 10%, transparent)' } }, note) : null,
        h(
          'div',
          { style: { flex: 1, overflow: 'auto', padding: '8px 8px 20px' } },
          h(SectionHeader, {
            title: '分离型子 agent（独立会话，删改不动这个窗口的结构）',
            count: shown.length,
            open: !fold.managed,
            onToggle: () => toggleFold('managed'),
            right: h(
              'label',
              {
                title: '把已停 / 已归档的也列出来',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  color: subtle,
                  cursor: 'pointer',
                },
              },
              h('input', {
                type: 'checkbox',
                checked: showInactive,
                onChange: (event) => setShowInactivePref(event.target.checked),
                style: { margin: 0 },
              }),
              '显示已停',
            ),
          }),
          fold.managed ? null : h(
            'div',
            { style: { display: 'flex', gap: 8, padding: '2px 12px 10px' } },
            h('input', {
              value: task,
              placeholder: '派个活：写清任务，它看不到这段对话',
              onChange: (e) => setTask(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !busy) onSpawn();
              },
              style: {
                flex: 1,
                height: 30,
                padding: '0 10px',
                borderRadius: 7,
                border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 20%, transparent)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary, CanvasText)',
                fontSize: 12.5,
              },
            }),
            h('button', { type: 'button', style: btn, disabled: busy || !task.trim(), onClick: onSpawn }, busy ? '忙着…' : '派活'),
          ),
          fold.managed ? null : shown.length
            ? h(
                'div',
                null,
                shown.map((row) =>
                  h(
                    React.Fragment,
                    { key: row.id },
                    h(ManagedRow, { row, busy, allowOpen, onAct, onPreview, onOpen, onMenu: openManagedMenu }),
                    preview.id === row.id
                      ? h(
                          'div',
                          {
                            style: {
                              margin: '0 12px 8px 34px',
                              padding: '8px 10px',
                              borderLeft: '2px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 22%, transparent)',
                              fontSize: 12,
                              lineHeight: 1.55,
                              maxHeight: 260,
                              overflow: 'auto',
                            },
                          },
                          preview.loading
                            ? h('span', { style: { color: subtle } }, '读取中…')
                            : preview.error
                              ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary, #d1242f)' } }, '读取失败：' + preview.error)
                              : (preview.rows || []).length
                                ? (preview.rows || []).map((m, i) =>
                                    h(
                                      'div',
                                      { key: 'm' + i, style: { marginBottom: 6 } },
                                      h(
                                        'span',
                                        {
                                          style: {
                                            fontSize: 10.5,
                                            color: subtle,
                                            marginRight: 6,
                                            fontFamily: 'ui-monospace, monospace',
                                          },
                                        },
                                        m.role === 'user' ? '我' : '它',
                                      ),
                                      m.text,
                                    ),
                                  )
                                : h('span', { style: { color: subtle } }, '（没有可显示的文字）'),
                        )
                      : null,
                  ),
                ),
              )
            : h(
                'div',
                { style: { padding: '2px 12px 12px', fontSize: 12, opacity: 0.6 } },
                managed.length
                  ? '在用的一条都没有（已停 / 已归档的不显示；要看就勾标题右边的「显示已停」）。'
                  : '还没有分离型子 agent。上面输入框派一个，或者让 agent 用 spawn_agent。',
              ),
          h(SectionHeader, {
            title: '常驻工位',
            count: seats.length,
            open: !fold.seats,
            onToggle: () => toggleFold('seats'),
            right: h('button', { type: 'button', style: btnMini, disabled: busy, onClick: seatAdd }, '＋ 加工位'),
          }),
          fold.seats ? null : seatRows.length
            ? h('div', null, seatRows)
            : h(
                'div',
                { style: { padding: '2px 12px 12px', fontSize: 12, opacity: 0.6 } },
                '还没有工位，点上面的「＋ 加工位」加一个。',
              ),
          h(SectionHeader, {
            title: '这轮会话的树（DSH 原生，只读）',
            count: sum.total || 0,
            open: !fold.tree,
            onToggle: () => toggleFold('tree'),
          }),
          fold.tree ? null : rows.length
            ? rows
            : h(
                'div',
                { style: { padding: 20, opacity: 0.65, fontSize: 12.5 } },
                loading ? '读取中…' : '这轮会话下还没有子 agent。',
              ),
        ),
        h(
          'div',
          {
            style: {
              flex: '0 0 auto',
              padding: '8px 16px',
              fontSize: 11,
              opacity: 0.55,
              borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 12%, transparent)',
            },
          },
          '分离型：能改名/停/隐藏（软删+归档，文件不动）。原生树：只读，只有「停」是安全的。右键有菜单。',
        ),
        menu
          ? h(
              'div',
              {
                ref: menuRef,
                onContextMenu: (event) => event.preventDefault(),
                style: {
                  position: 'fixed',
                  left: menu.x,
                  top: menu.y,
                  zIndex: 9999,
                  minWidth: 200,
                  maxWidth: 280,
                  padding: 4,
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 18%, transparent)',
                  background: 'var(--dsw-alias-bg-base, Canvas)',
                  color: 'var(--dsw-alias-label-primary, CanvasText)',
                  boxShadow: '0 10px 30px rgba(0,0,0,.22)',
                  fontSize: 12.5,
                },
              },
              menu.title
                ? h(
                    'div',
                    {
                      style: {
                        padding: '5px 8px 6px',
                        fontSize: 11,
                        color: subtle,
                        borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 10%, transparent)',
                        marginBottom: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    menu.title,
                  )
                : null,
              menu.items.map((item, index) =>
                h(
                  'button',
                  {
                    key: 'mi' + index,
                    type: 'button',
                    onClick: () => {
                      setMenu(null);
                      item.run();
                    },
                    style: {
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      color: item.danger ? 'var(--dsw-alias-state-error-primary, #d1242f)' : 'var(--dsw-alias-label-primary, CanvasText)',
                      fontSize: 12.5,
                      cursor: 'pointer',
                    },
                  },
                  item.label,
                ),
              ),
            )
          : null,
        dialog
          ? h(
              'div',
              {
                onClick: (event) => {
                  if (event.target === event.currentTarget) setDialog(null);
                },
                style: {
                  position: 'fixed',
                  inset: 0,
                  zIndex: 10000,
                  background: 'rgba(0,0,0,.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              h(
                'div',
                {
                  style: {
                    width: 320,
                    padding: 14,
                    borderRadius: 10,
                    background: 'var(--dsw-alias-bg-base, Canvas)',
                    color: 'var(--dsw-alias-label-primary, CanvasText)',
                    border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 18%, transparent)',
                    boxShadow: '0 16px 40px rgba(0,0,0,.28)',
                  },
                },
                h('div', { style: { fontSize: 13, marginBottom: 10 } }, dialog.title),
                h('input', {
                  autoFocus: true,
                  value: dialog.value,
                  onChange: (event) => setDialog({ ...dialog, value: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') submitDialog();
                    if (event.key === 'Escape') setDialog(null);
                  },
                  style: {
                    width: '100%',
                    height: 30,
                    padding: '0 8px',
                    boxSizing: 'border-box',
                    borderRadius: 6,
                    border: '1px solid color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 22%, transparent)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary, CanvasText)',
                    fontSize: 12.5,
                  },
                }),
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
                  h('button', { type: 'button', style: btn, onClick: () => setDialog(null) }, '取消'),
                  h('button', { type: 'button', style: btn, onClick: submitDialog }, '确定'),
                ),
              ),
            )
          : null,
      );
    }

    // 一个什么都不做的 builder：这个 View 不消费会话事件，数据自己 fetch。
    const builder = {
      empty: { nodes: [] },
      replace: () => ({ nodes: [] }),
      apply: () => ({ nodes: [] }),
    };

    return {
      inject: ['slots', 'locale', 'uiConversation', 'uiWorkspace'],
      apply(ctx) {
        api = {
          openSession: (id) => {
            ctx.uiWorkspace.openSession(id);
          },
        };
        ctx.effect(
          () => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }),
          'subagent-tree: dictionaries',
        );
        const t = ctx.locale.bind(NS);

        ctx.uiConversation.views.register({
          target: 'subagents',
          create: () => ({
            get empty() {
              return builder.empty;
            },
            replace: () => builder.empty,
            apply: () => builder.empty,
          }),
        });

        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'subagent-back',
              order: 5,
              locale: NS,
            },
            BackBar,
          ),
        );

        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: 'subagents',
              order: 20,
              locale: NS,
              label: () => t('view.subagents'),
            },
            SubagentView,
          ),
        );
      },
    };
  },
});
