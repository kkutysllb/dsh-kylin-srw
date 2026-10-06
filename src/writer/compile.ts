/** 编译编排（Task 5.3）：引擎选择序（探测结果优先）→ spawn 编译 → 日志解析
 * （79 列回接）→ 产物/日志落 build/。裸 xelatex/pdflatex 按日志 Rerun 提示
 * 重跑至多 2 次；进程执行经注入端口，测试全程用假引擎。 */

import { compileCommand, type RunPort, type TeXEngine } from './engine.ts'
import { parseTeXLog, type ParsedTeXLog } from './texlog.ts'

export interface CompileOutcome {
  readonly ok: boolean
  readonly engine: TeXEngine
  /** 编译日志全文（调用方落 build/main.log，测试断言用）。 */
  readonly log: string
  readonly pdfProduced: boolean
  readonly reran: number
  readonly parsed: ParsedTeXLog
  readonly durationMs: number
}

/** 裸引擎的重跑判定：日志含「Rerun to get」且还有余量。 */
function needsRerun(log: string): boolean {
  return /Rerun to get|Label\(s\) may have changed/.test(log)
}

export async function compilePaper(options: {
  engine: TeXEngine
  /** 工作目录内入口（相对），如 main.tex。 */
  readonly entry: string
  readonly run: RunPort
  /** 编译工作目录（paper/）。 */
  readonly cwd: string
  readonly maxReruns?: number
}): Promise<CompileOutcome> {
  const maxReruns = options.maxReruns ?? 2
  const startedAt = Date.now()
  let reran = 0
  let log = ''
  // 产物存在性由调用方核对磁盘（假引擎没有真 PDF）；这里以退出码为准
  let ok = true
  for (let attempt = 0; attempt <= maxReruns; attempt += 1) {
    const { command, args } = compileCommand(options.engine, options.entry)
    try {
      const output = await options.run(command, args, { timeoutMs: 300_000, cwd: options.cwd })
      log = output.stdout + output.stderr
      ok = true
    } catch (error: unknown) {
      // nonstopmode 下编译失败也产日志（进程非零退出）：拿 stderr/stdout 解析
      ok = false
      log = error instanceof Error ? error.message : String(error)
    }
    if (!ok || !needsRerun(log) || attempt === maxReruns) break
    reran += 1
  }
  return {
    ok,
    engine: options.engine,
    log,
    pdfProduced: ok,
    reran,
    parsed: parseTeXLog(log),
    durationMs: Date.now() - startedAt,
  }
}

/** 编译失败但非零退出信息不友好时（假引擎/超时），把 message 包成结构化错误
 * 的兜底（run 抛错时 error.message 就是我们的日志替代品）。 */
export function fallbackError(log: string): { file?: string; line?: number; code: string; message: string } | undefined {
  const { errors } = parseTeXLog(log)
  return errors[0] ?? (log.trim() === '' ? undefined : { code: 'UPSTREAM', message: log.trim().slice(0, 500) })
}
