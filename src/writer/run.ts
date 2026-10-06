/** 真实进程 runner（M5 编译面）：execFile + timeout + stdout/stderr 收集。
 * 非零退出抛错（message 内含输出——compile.ts 拿它当日志解析 nonstopmode
 * 错误）。测试不经过这里（注入假 runner）。 */

import { execFile } from 'node:child_process'
import type { RunPort } from './engine.ts'

export const nodeRun: RunPort = (command, args, options) => new Promise((resolve, reject) => {
  execFile(
    command,
    [...args],
    { timeout: options.timeoutMs, cwd: options.cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
    (error, stdout, stderr) => {
      if (error !== null) {
        const code = typeof error.code === 'string' || typeof error.code === 'number' ? `exit ${error.code}` : 'spawn failed'
        reject(new Error(`${code}\n${stdout}\n${stderr}`.trim()))
      } else {
        resolve({ stdout, stderr })
      }
    },
  )
})
