/** 编译编排（Task 5.3）：引擎选择序（探测结果优先）→ spawn 编译 → 日志解析
 * （79 列回接）→ 产物/日志落 build/。裸 xelatex/pdflatex 按日志 Rerun 提示
 * 重跑至多 2 次；进程执行经注入端口，测试全程用假引擎。 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
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
  /** 裸引擎引用工具结果（latexmk/tectonic 内部处理 bib，不填）。 */
  readonly bib?: { readonly tool: 'bibtex' | 'biber'; readonly bbl: boolean; readonly undefinedCitations: number }
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
  /** 引用工具：latexmk/tectonic 自带；裸 xelatex/pdflatex 需要显式跑 bibtex/biber。 */
  readonly bibTool?: 'bibtex' | 'biber'
}): Promise<CompileOutcome> {
  const maxReruns = options.maxReruns ?? 2
  const startedAt = Date.now()
  let reran = 0
  let log = ''
  let lastPass = ''
  let ok = true
  let bib: CompileOutcome['bib']
  const invoke = async (): Promise<void> => {
    const { command, args } = compileCommand(options.engine, options.entry)
    const output = await options.run(command, args, { timeoutMs: 300_000, cwd: options.cwd })
    lastPass = output.stdout + output.stderr
    log = log === '' ? lastPass : `${log}\n${lastPass}`
  }
  try {
    await invoke()
  } catch (error: unknown) {
    // nonstopmode 下编译失败也产日志（进程非零退出）：拿 stderr/stdout 解析
    ok = false
    log = error instanceof Error ? error.message : String(error)
  }
  if (ok && options.bibTool !== undefined && (options.engine === 'xelatex' || options.engine === 'pdflatex')) {
    // 裸引擎不会自动处理引用：先跑 bibtex/biber，再跑两遍 TeX 让 [1][2] 落进 PDF。
    const base = options.entry.replace(/\.tex$/, '')
    const bibArgs = options.bibTool === 'biber'
      ? ['--input-directory', 'build', '--output-directory', 'build', base]
      : [`build/${base}`]
    try {
      const output = await options.run(options.bibTool, bibArgs, { timeoutMs: 120_000, cwd: options.cwd })
      log += `\n${output.stdout}${output.stderr}`
    } catch (error: unknown) {
      // 没有引用时 bibtex 会非零退出；保留日志但不把编译判死（由最终 PDF 日志兜底）。
      log += `\n${error instanceof Error ? error.message : String(error)}`
    }
    for (let pass = 0; pass < 2 && ok; pass += 1) {
      try {
        await invoke()
        reran += 1
      } catch (error: unknown) {
        ok = false
        lastPass += error instanceof Error ? error.message : String(error)
        log += `\n${error instanceof Error ? error.message : String(error)}`
      }
    }
    const bbl = await access(join(options.cwd, 'build', `${base}.bbl`)).then(() => true).catch(() => false)
    const undefinedCitations = (lastPass.match(/Citation .*? undefined/g) ?? []).length
    bib = { tool: options.bibTool, bbl, undefinedCitations }
  } else if (ok) {
    for (let attempt = 0; attempt < maxReruns; attempt += 1) {
      if (!needsRerun(log)) break
      try {
        await invoke()
        reran += 1
      } catch (error: unknown) {
        ok = false
        log += `\n${error instanceof Error ? error.message : String(error)}`
        break
      }
    }
  }
  return {
    ok,
    engine: options.engine,
    log,
    pdfProduced: ok,
    reran,
    parsed: parseTeXLog(log),
    durationMs: Date.now() - startedAt,
    ...(bib !== undefined ? { bib } : {}),
  }
}

/** 编译失败但非零退出信息不友好时（假引擎/超时），把 message 包成结构化错误
 * 的兜底（run 抛错时 error.message 就是我们的日志替代品）。 */
export function fallbackError(log: string): { file?: string; line?: number; code: string; message: string } | undefined {
  const { errors } = parseTeXLog(log)
  return errors[0] ?? (log.trim() === '' ? undefined : { code: 'UPSTREAM', message: log.trim().slice(0, 500) })
}
