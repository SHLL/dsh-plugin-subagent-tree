// 路径统一从环境与配置算出来，不写死任何机器上的绝对路径。
//
// 默认：
//   ledger   $DSH_HOME/subagent-admin.json（或 ~/.dsh/subagent-admin.json）
//   seats    跟 ledger 同目录的 subagent-seats.json
//   sessions $DSH_HOME/sessions（或 ~/.dsh/sessions）
//
// 配置里给了 ledgerPath / sessionRoot 就用配置的（相对路径按进程工作目录解析）。
import os from 'node:os';
import path from 'node:path';

let overrides = { ledger: '', sessions: '' };

/** DSH 家目录：优先 DSH_HOME，回落到 ~/.dsh。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** 应用配置里的路径覆盖；传空值就回默认。 */
export function configurePaths({ ledgerPath, sessionRoot } = {}) {
  overrides = {
    ledger: typeof ledgerPath === 'string' ? ledgerPath.trim() : '',
    sessions: typeof sessionRoot === 'string' ? sessionRoot.trim() : '',
  };
}

/** 子 agent 台账文件。 */
export function ledgerFile() {
  return overrides.ledger ? path.resolve(overrides.ledger) : path.join(dshHome(), 'subagent-admin.json');
}

/** 工位台账文件：默认跟子 agent 台账放同一个目录。 */
export function seatsFile() {
  return path.join(path.dirname(ledgerFile()), 'subagent-seats.json');
}

/** 会话根目录。 */
export function sessionsRoot() {
  return overrides.sessions ? path.resolve(overrides.sessions) : path.join(dshHome(), 'sessions');
}
