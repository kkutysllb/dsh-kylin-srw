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
    readonly file?: string;
    readonly line?: number;
    /** 错误首词归一（Undefined control sequence / LaTeX Error / …）。 */
    readonly code: string;
    readonly message: string;
}
export interface ParsedTeXLog {
    readonly errors: readonly TeXError[];
    readonly warnings: readonly string[];
}
/** 79 列折行回接：**被消费的段**恰好 79 列 → 它还有续行（合并直到出现一个
 * 不足 79 列的段收尾）。合并结果不重新参与判定——判据是原始折行段。 */
export declare function refold(lines: readonly string[]): string[];
/** 括号栈文件跟踪 + 错误块抽取。保守：解析不出 file/line 就留空——
 * 呈现层显示「位置未知」而不是编一个。 */
export declare function parseTeXLog(log: string): ParsedTeXLog;
