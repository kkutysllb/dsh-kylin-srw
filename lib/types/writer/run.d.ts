/** 真实进程 runner（M5 编译面）：execFile + timeout + stdout/stderr 收集。
 * 非零退出抛错（message 内含输出——compile.ts 拿它当日志解析 nonstopmode
 * 错误）。测试不经过这里（注入假 runner）。 */
import type { RunPort } from './engine.ts';
export declare const nodeRun: RunPort;
