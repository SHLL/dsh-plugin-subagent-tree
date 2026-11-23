// 插件配置：只在 cordis.patch.yml 里写，代码里给默认值并做收敛。
// 没有导出 Config schema（DSH 的 schemastery 是安装包内依赖，profile 插件解析不到），
// 所以这里自己校验：类型不对就回默认，数值越界就夹到范围内。

export const RENDER_STATUSES = ['running', 'idle', 'done', 'stopped', 'archived', 'failed'];

export const DEFAULTS = Object.freeze({
  /** 子 agent 台账文件；空＝$DSH_HOME/subagent-admin.json。 */
  ledgerPath: '',
  /** 会话根目录；空＝$DSH_HOME/sessions。 */
  sessionRoot: '',
  /** 允许的最大嵌套深度（子 agent 再派子 agent 的层数）。 */
  maxDepth: 3,
  /** spawn_agent 默认等多久（毫秒）。 */
  defaultTimeoutMs: 600000,
  /** spawn_agent 最长等多久（毫秒）。 */
  maxWaitMs: 1800000,
  /** 子 agent 跑完默认是否回执给派它的窗口。 */
  notifyOnComplete: true,
  /** 页面上渲染哪些状态的行；不在表里的不显示。 */
  renderStatuses: ['running', 'idle', 'done'],
  /** 是否允许页面里的「查看对话」读子会话正文。 */
  allowPreview: true,
  /** 是否允许页面里的「打开会话」跳到子会话。 */
  allowOpen: true,
});

const isInt = (value) => Number.isSafeInteger(value) && value > 0;

/** 把 patch 里的原始 config 收敛成可用值；坏值一律回默认，不抛。 */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const config = { ...DEFAULTS };

  if (isInt(input.maxDepth) && input.maxDepth >= 1 && input.maxDepth <= 10) {
    config.maxDepth = input.maxDepth;
  }

  if (isInt(input.defaultTimeoutMs)) {
    config.defaultTimeoutMs = Math.max(1000, Math.min(input.defaultTimeoutMs, DEFAULTS.maxWaitMs));
  }
  if (isInt(input.maxWaitMs)) {
    config.maxWaitMs = Math.max(1000, Math.min(input.maxWaitMs, 1800000 * 2));
  }
  if (config.defaultTimeoutMs > config.maxWaitMs) config.defaultTimeoutMs = config.maxWaitMs;

  if (typeof input.ledgerPath === 'string') config.ledgerPath = input.ledgerPath.trim();
  if (typeof input.sessionRoot === 'string') config.sessionRoot = input.sessionRoot.trim();

  if (typeof input.notifyOnComplete === 'boolean') config.notifyOnComplete = input.notifyOnComplete;
  if (typeof input.allowPreview === 'boolean') config.allowPreview = input.allowPreview;
  if (typeof input.allowOpen === 'boolean') config.allowOpen = input.allowOpen;

  if (Array.isArray(input.renderStatuses)) {
    const wanted = input.renderStatuses.filter((name) => RENDER_STATUSES.includes(name));
    if (wanted.length > 0) config.renderStatuses = [...new Set(wanted)];
  }

  return config;
}
