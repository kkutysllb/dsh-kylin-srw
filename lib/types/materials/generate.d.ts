/** M6 生成器（analysis/goals/02-写论文.md §4.5）：**内置纯函数确定性渲染**，
 * 不执行外部脚本/进程（script 型生成器留待后续）。同 spec + 同 inputs →
 * 字节级相同输出；产物禁含时间戳/绝对路径/随机数；LF 换行；数值统一
 * toPrecision(4) 去尾零。缺指标/series → INVALID 并列出缺哪些——绝不
 * 生成占位数据冒充真实。
 *
 * 工程纪律：生成器不调用 LLM（内容由 agent 写进 spec，本模块只做渲染）。 */
import { type ArtifactKind, type FormulaSpec, type MetricsFile, type PlotSpec, type PseudocodeSpec, type TableSpec, type TikzSpec } from './types.ts';
/** 每个 \label 的前缀（insertedAt.label 与产物内部一致）。 */
export declare const KIND_LABEL_PREFIX: Readonly<Record<ArtifactKind, 'tab' | 'fig' | 'alg' | 'eq'>>;
/** kind → 产物目录（materials/ 下）。 */
export declare const KIND_DIR: Readonly<Record<ArtifactKind, 'tables' | 'plots' | 'pseudocode' | 'formulas' | 'figures'>>;
/** kind → 内置生成器版本号（manifest.generator.builtin）。 */
export declare const BUILTIN_GENERATOR: Readonly<Record<ArtifactKind, 'table-v1' | 'plot-v1' | 'pseudocode-v1' | 'formula-v1' | 'tikz-v1'>>;
/** booktabs 表：单数据行，列 = spec.columns（每列一个 metric 的值）。 */
export declare function renderTable(id: string, spec: TableSpec, metrics: MetricsFile): string;
/** pgfplots 数据曲线图：series 坐标固定、无随机布局。 */
export declare function renderPlot(id: string, spec: PlotSpec, metrics: MetricsFile): string;
/** 伪代码：algorithm + algorithmic[1]，行内允许原始 LaTeX（确定性文本渲染）。 */
export declare function renderPseudocode(id: string, spec: PseudocodeSpec): string;
/** 公式：equation + \label。MVP 不做 sympy 子进程——状态恒
 * unverifiable/structural（G-M2 的诚实形态），引用须脚注「未验证」。 */
export declare function renderFormula(id: string, spec: FormulaSpec): string;
/** TikZ 架构/流程图：figure 包 raw code（spec.code 原样嵌入）+ \label。 */
export declare function renderTikz(id: string, spec: TikzSpec): string;
/** 分发入口（generate 与复算重渲染共用）：先过 spec 校验，再按 kind 渲染。
 * table/plot 必须带已解析的 metrics；其余 kinds 的 metrics 忽略。 */
export declare function renderArtifact(id: string, kind: ArtifactKind, spec: Record<string, unknown>, metrics: MetricsFile | undefined): string;
