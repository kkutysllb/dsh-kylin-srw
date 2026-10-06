/** 编译编排（Task 5.3）：引擎选择序（探测结果优先）→ spawn 编译 → 日志解析
 * （79 列回接）→ 产物/日志落 build/。裸 xelatex/pdflatex 按日志 Rerun 提示
 * 重跑至多 2 次；进程执行经注入端口，测试全程用假引擎。 */
import { type RunPort, type TeXEngine } from './engine.ts';
import { type ParsedTeXLog } from './texlog.ts';
export interface CompileOutcome {
    readonly ok: boolean;
    readonly engine: TeXEngine;
    /** 编译日志全文（调用方落 build/main.log，测试断言用）。 */
    readonly log: string;
    readonly pdfProduced: boolean;
    readonly reran: number;
    readonly parsed: ParsedTeXLog;
    readonly durationMs: number;
}
export declare function compilePaper(options: {
    engine: TeXEngine;
    /** 工作目录内入口（相对），如 main.tex。 */
    readonly entry: string;
    readonly run: RunPort;
    readonly maxReruns?: number;
}): Promise<CompileOutcome>;
/** 编译失败但非零退出信息不友好时（假引擎/超时），把 message 包成结构化错误
 * 的兜底（run 抛错时 error.message 就是我们的日志替代品）。 */
export declare function fallbackError(log: string): {
    file?: string;
    line?: number;
    code: string;
    message: string;
} | undefined;
