/** TeX 日志解析（Task 5.3）：真实日志形态 → 结构化错误。
 *
 * **79 列折行回接**：TeX 引擎把日志按最多 79 列折行（无连字符、无前缀，
 * 续行直接另起一行）——回接规则：一行恰好 79 列且下一行存在 → 与下一行拼
 * 接（TeX 自身输出里恰好 79 列的正文行几乎不存在，这是社区通用判据）。
 *
 * 错误块形态（nonstopmode）：
 * ```
 * ! LaTeX Error: Something's wrong--perhaps a missing \item.
 * See the LaTeX manual ... (可折行多行)
 * Type H <return> for immediate help.
 *  l.42 \itemize[
 * ```
 * `l.<数字>` 行给出出错源码行号；文件名靠 `(...` / `)` 括号栈跟踪。 */

export interface TeXError {
  readonly file?: string
  readonly line?: number
  /** 错误首词归一（Undefined control sequence / LaTeX Error / …）。 */
  readonly code: string
  readonly message: string
}

export interface ParsedTeXLog {
  readonly errors: readonly TeXError[]
  readonly warnings: readonly string[]
}

/** 79 列折行回接：**被消费的段**恰好 79 列 → 它还有续行（合并直到出现一个
 * 不足 79 列的段收尾）。合并结果不重新参与判定——判据是原始折行段。 */
export function refold(lines: readonly string[]): string[] {
  const out: string[] = []
  let buffer: string | undefined
  for (const line of lines) {
    buffer = buffer === undefined ? line : buffer + line
    if (line.length < 79) {
      out.push(buffer)
      buffer = undefined
    }
  }
  if (buffer !== undefined) out.push(buffer)
  return out
}

const FILE_OPEN_RE = /\(((?:\.\/|\/)?[\w./+\-]+\.(?:tex|bib|sty|cls|cfg|def|clo))/g

/** 括号栈文件跟踪 + 错误块抽取。保守：解析不出 file/line 就留空——
 * 呈现层显示「位置未知」而不是编一个。 */
export function parseTeXLog(log: string): ParsedTeXLog {
  const lines = refold(log.split('\n'))
  const fileStack: string[] = []
  const errors: TeXError[] = []
  const warnings: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    // 文件栈：`(/path/to.tex` 入栈；裸 `)` 出栈（保守——只数行首/空格后的
    // 独立 `)`，嵌套 sty 的关闭太密，全数会把栈清空过头，故限每行最多弹 2 层）
    for (const match of line.matchAll(FILE_OPEN_RE)) {
      fileStack.push(match[1] ?? '')
    }
    let closes = 0
    for (const token of line.split(/[\s(]/)) {
      if (token === ')' && closes < 2) closes += 1
    }
    for (let i = 0; i < closes; i += 1) fileStack.pop()
    if (/^!/.test(line)) {
      const message = line.replace(/^!\s*/, '')
      // code 归一：带冒号取冒号前（"LaTeX Error"、"Package pgfplots Error"）；
      // 无冒号取首句到第一个句点（"Undefined control sequence."）
      const code = (message.match(/^([\w\s]+?):/)?.[1] ?? message.match(/^([^.]+)/)?.[1])?.trim() ?? 'Error'
      // 行号：错误块内前 6 行找 `l.<n>`；文件：块内 `./x.tex:12:` 形态优先，
      // 否则用当前括号栈顶
      let lineNumber: number | undefined
      let file: string | undefined
      for (let look = index + 1; look < Math.min(index + 7, lines.length); look += 1) {
        const probe = lines[look] ?? ''
        const lMatch = probe.match(/^l\.(\d+)/)
        if (lMatch !== null && lMatch[1] !== undefined && lineNumber === undefined) lineNumber = Number(lMatch[1])
        const fMatch = probe.match(/([\w./+\-]+\.(?:tex|bib)):(\d+):/)
        if (fMatch !== null && fMatch[1] !== undefined) {
          file = fMatch[1]
          lineNumber = Number(fMatch[2])
          break
        }
      }
      if (file === undefined) file = fileStack[fileStack.length - 1]
      errors.push({
        ...(file !== undefined && file !== '' ? { file } : {}),
        ...(lineNumber !== undefined ? { line: lineNumber } : {}),
        code,
        message: message.slice(0, 500),
      })
    } else if (/^(LaTeX|Package|Class|pdfTeX)\b.*[Ww]arning/.test(line) || /^Overfull \\hbox/.test(line)) {
      warnings.push(line.slice(0, 300))
    }
  }
  return { errors, warnings }
}
