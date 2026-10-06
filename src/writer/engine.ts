/** TeX 引擎探测（Task 5.1）：tectonic / latexmk / xelatex / pdflatex 逐个
 * `--version`。进程执行走注入端口（测试用假 runner）；本机全缺是**常态**
 * （0102 §9 实测），返回全缺表而不抛——UI 据此出安装引导。 */

export type TeXEngine = 'tectonic' | 'latexmk' | 'xelatex' | 'pdflatex'

/** 探测序即编译优先序：tectonic 自包含免多轮；latexmk 管多轮；裸 xelatex/
 * pdflatex 需自管重跑。 */
export const ENGINE_ORDER: readonly TeXEngine[] = ['tectonic', 'latexmk', 'xelatex', 'pdflatex']

/** 进程执行端口：`command args…`（cwd 固定在 paper/），非零退出码抛错；
 * 测试注入假 runner。 */
export type RunPort = (command: string, args: readonly string[], options: { timeoutMs: number; cwd: string }) => Promise<{ stdout: string; stderr: string }>

export interface EngineProbeResult {
  readonly engine: TeXEngine | undefined
  readonly probes: readonly { readonly engine: TeXEngine; readonly available: boolean; readonly version?: string }[]
}

export function probeEngines(run: RunPort, timeoutMs = 3000): Promise<EngineProbeResult> {
  return (async () => {
    const probes: { engine: TeXEngine; available: boolean; version?: string }[] = []
    for (const engine of ENGINE_ORDER) {
      try {
        const output = await run(engine, ['--version'], { timeoutMs, cwd: process.cwd() })
        const version = (output.stdout + output.stderr).split('\n')[0]?.trim() ?? ''
        probes.push({ engine, available: true, ...(version !== '' ? { version: version.slice(0, 120) } : {}) })
      } catch {
        probes.push({ engine, available: false })
      }
    }
    return { engine: probes.find(probe => probe.available)?.engine, probes }
  })()
}

/** 编译命令装配（compile.ts 与 state 体检共用）。 */
export function compileCommand(engine: TeXEngine, entry: string): { command: TeXEngine; args: readonly string[] } {
  switch (engine) {
    case 'tectonic':
      return { command: 'tectonic', args: [entry] }
    case 'latexmk':
      return { command: 'latexmk', args: ['-pdf', '-interaction=nonstopmode', '-halt-on-error', entry] }
    case 'xelatex':
      return { command: 'xelatex', args: ['-interaction=nonstopmode', entry] }
    case 'pdflatex':
      return { command: 'pdflatex', args: ['-interaction=nonstopmode', entry] }
  }
}
