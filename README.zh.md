# dsh-plugin-subagent-tree

给 DeepSeek Harness（DSH）每个会话加一格 **subagent tree**：派「分离型」子 agent、只读查看原生子 agent 树、维护常驻工位台账。

> English: see [README.md](README.md).

## 为什么是「分离型」

DSH 原生子 agent 与父会话的关系写在父会话日志的 `subagent/catalog` 事件里，是只增投影——那一条记录删不掉也改不了，硬删会话文件还会在父窗口里留悬空行。

本插件换个办法：子 agent **创建时就跟窗口物理解绑**，是一条独立会话（头里不写 `parentSession`），归属只记在插件自己的台账 `~/.dsh/subagent-admin.json`。所以删它、改它、停它，都只动台账和它自己那条会话，不会破坏任何窗口的会话结构。

## 安装

```bash
# 在 DSH 里
plugin_manager install_bundle target=/path/to/subagent-tree
```

或用插件管理界面「添加插件」指向本地目录。安装后**新开一个会话**，会话头会多出 `subagent tree` 标签。

要求 DSH `>=0.2.2-rc.3`。

## 用法

### 面板

- **派活**：顶部输入框写任务，点「派活」；它看不到当前对话，任务要写全。
- **每行操作**：打开（跳到该子会话）/ 查看（页内展开它的几句对话）/ 停（只停当前这一轮）/ 改名 / 隐藏（软删：台账隐藏 + 归档，文件不动）/ 恢复。
- **右键菜单**：同样的操作 + 复制会话 id / 复制最后答复。
- **折叠页**：三块的标题条可以点开点收，状态记在浏览器本地。
- **常驻工位（活页）**：能加、能删、能退役、能恢复；只是台账，不碰会话。
- **中间表**：页面只渲染「启用」状态的行（默认 running/idle/done）；停掉或归档的会立刻消失，勾标题右边的「显示已停」才看得到。
- **横栏**：只有分离型子 agent 的页面，标签栏下面会出现一条横栏——左「← 返回主会话」（回到派它的窗口并切到对话栏）、中间标题、右「×」收起。

### 工具

| 工具 | 作用 |
|---|---|
| `spawn_agent` | 派一个分离型子 agent。`task` 必填；`label` 短名；`start=false` 只建空位；`wait`（默认 true）等它跑完直接返回答复；`timeout_ms` 等待上限 |
| `manage_subagents` | `list` / `stop` / `rename` / `hide` / `restore`，只动台账和子会话本身 |
| `subagent_tree` | 只读：当前会话（或全部）的原生子 agent 树，附带分离型清单 |
| `subagent_seat` | 工位台账：`list` / `bind` / `rename` / `retire` / `revive` / `remove` |

子 agent 跑完，最后一段答复会作为一条消息回执给派它的会话（`notifyOnComplete` 可关）。

## 配置

写在 profile 的 `cordis.patch.yml` 里，改完重载插件生效：

```yaml
- insert:
    - id: subagent-tree
      name: dsh-plugin-subagent-tree
      config:
        ledgerPath: ''              # 台账文件；空＝$DSH_HOME/subagent-admin.json
        sessionRoot: ''             # 会话目录；空＝$DSH_HOME/sessions
        maxDepth: 3                 # 子 agent 再派子 agent 的层数上限
        defaultTimeoutMs: 600000    # spawn_agent 默认等待
        maxWaitMs: 1800000          # spawn_agent 最长等待
        maxChildren: 16             # 同时在用的子 agent 上限
        notifyOnComplete: true      # 跑完是否回执
        renderStatuses: [running, idle, done]   # 页面渲染哪些状态
        allowPreview: true          # 允许「查看」读子会话正文
        allowOpen: true             # 允许「打开」跳到子会话
```

坏值不会抛错：类型不对回默认，数值越界夹到范围内。

**路径都是算出来的，没有写死任何机器上的绝对路径**：默认跟 `DSH_HOME`（没设就是 `~/.dsh`）走，换目录就配 `ledgerPath` / `sessionRoot`，相对路径按进程工作目录解析。装到哪个 profile、哪个盘都一样能用。

## 边界与已知取舍

- **不改写 DSH 会话日志**：不写 `subagent/catalog`，父会话的结构事件一个都不碰。
- **软删**：`hide` = 台账隐藏 + `workspaceRegistry.archiveSession` 归档，会话文件不动，随时 `restore`。
- 分离型子 agent 建成后不挂工作区（不在侧栏出现），只在面板里管。
- **HTTP 口只给本机页面用**：要求回环 Host、同源 Origin、`x-subagent-admin: 1` 头，挡的是跨站页面；同机其它进程不在防护范围内（假定本机可信）。
- **只认台账里的 id**：停、改名、隐藏、恢复都先查台账，别的会话 id 一律拒绝——手里的口子不能拿来动别人的会话。
- **台账键白名单**：id 只允许字母数字和 `._:-`，`__proto__` / `constructor` / `prototype` 直接丢，读到脏键不污染原型。
- **在用量有上限**（`maxChildren`，默认 16），防止被页面或脚本拿来刷子 agent。
- **横栏是 `document.body` 上的浮层**：标签栏下面没有任何全宽槽位，header 槽位又有 overflow 裁剪，所以这一条是唯一挂到 body 的元素，随组件卸载移除。其余 UI 全部走槽位。
- 原生那套子 agent（`subagent` 工具创建的）在窗口目录里仍然删不掉——那是框架的只增投影，本插件只提供只读树 + 「停」。
- 停用插件会撤掉页面、工具和路由；已派出去的子会话和台账留在磁盘上，还在跑的子 agent 不会被杀。
- 面板文案目前中英双语硬编码；插件详情页的 8 语 locale 在 `locale/`。

## 目录

```
index.js            host 入口（工具 + HTTP 路由 + 状态监听）
client.js           浏览器入口（会话页 / 横栏）
lib/config.mjs      配置收敛
lib/guard.mjs       路由守卫
lib/manage.mjs      派活、停、改名、隐藏、恢复
lib/registry.mjs    子 agent 台账
lib/seats.mjs       工位台账
lib/scan.mjs        会话头扫描与拼树
lib/shape.mjs       树的展示形状
docs/               插件详情页（一图）与预览图
locale/             8 语插件元数据
test/               node 自测（无 DSH 也能跑）
```

## 自测

```bash
node test/scan.test.mjs
node test/registry.test.mjs
node test/config.test.mjs
node test/guard.test.mjs
```

## 许可

MIT，见 [LICENSE](LICENSE)。
