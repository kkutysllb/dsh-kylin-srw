/** metrics 契约助手（M6，analysis/goals/02-写论文.md §4.4）：选择器语法
 * （'#accuracy' 取 values；'#series:loss' 取 series）、数值格式化
 * （toPrecision(4) 去尾零）、数字宏名（\srw<Name>）、metrics.json 落盘
 * 序列化、裸数字扫描（numbers.audit 的纯函数面）。全部无 IO、无时间源——
 * 同输入同输出。 */
/** 数值格式化：toPrecision(4)（可调 1..17）去尾零；非有限数 → INVALID。
 * 确定性要求：无时间戳/无 locale 介入，同输入恒同输出。 */
export declare function formatNumber(value: number, precision?: number): string;
export type Selector = {
    readonly kind: 'metric';
    readonly name: string;
} | {
    readonly kind: 'series';
    readonly name: string;
};
/** 解析选择器：'#accuracy' → { kind:'metric', name:'accuracy' }；
 * '#series:loss' → { kind:'series', name:'loss' }；其余 → undefined。 */
export declare function parseSelector(raw: string): Selector | undefined;
/** 数字宏名：metric 'accuracy' → 宏 'srwaccuracy'（\newcommand{\srwaccuracy}{…}）。 */
export declare function macroNameFor(metric: string): string;
/** metrics.json 落盘文本（确定性序列化：键序固定 schemaVersion→runId→values→series）。 */
export declare function metricsFileText(runId: string, payload: {
    readonly values: Readonly<Record<string, unknown>>;
    readonly series?: readonly unknown[];
}): string;
export interface BareNumberHit {
    readonly line: number;
    readonly text: string;
}
/** 裸数字扫描（整文件纯函数面）：逐行找 /\b\d+\.\d+\b/；跳过注释行
 * （trim 后以 % 开头）与 \newcommand 定义行。每行至多记一条。 */
export declare function scanBareNumbers(text: string): readonly BareNumberHit[];
/** 数字宏表（paper/generated/srw-numbers.tex）的确定性文本。 */
export declare function numbersTexText(macros: readonly {
    readonly name: string;
    readonly value: number;
}[]): string;
