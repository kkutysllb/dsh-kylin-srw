/** 素材与证明链 schema（M6，analysis/goals/02-写论文.md §4 / 0102 §7.2）：
 * manifest.json / metrics.json / run.json 的手写校验器（照 patent/types.ts
 * 风格：零依赖、返回中文错误清单而非抛错——RPC INVALID 聚合与服务的
 * 「坏文件拒载」共用同一判定）。全部 schemaVersion:1。
 *
 * 状态语义（四级，UI/论文/投稿包统一）：
 * - verified：复算（重渲染）输出哈希与基线一致；
 * - mismatch：输入/产物/插入副本任一被改或缺失 → 阻断（insert/compile）；
 * - unverifiable：缺源、公式门（sympy）未接入、结构方法 → 允许插入但强制脚注；
 * - illustrative：示意数据（默认拒绝；显式开启后三处标注）。
 *
 * 确定性纪律：生成器是内置纯函数渲染——同 spec + 同 inputs 字节级相同；
 * 产物禁含时间戳/绝对路径/随机数（否则哈希不稳定，证明链失效）。 */
/** 素材 id：^[a-z][a-z0-9-]{1,40}$（小写 slug，作 \label 与文件名）。 */
export declare const ARTIFACT_ID_RE: RegExp;
/** 实验运行 id：^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$（目录名，禁路径分隔符）。 */
export declare const RUN_ID_RE: RegExp;
/** 指标名：^[A-Za-z][A-Za-z0-9_]*$（数字宏 \srw<Name> 的名字段）。 */
export declare const METRIC_NAME_RE: RegExp;
/** sha256 十六进制（64 位小写）。 */
export declare const SHA256_RE: RegExp;
export declare const MATERIALS_SCHEMA_VERSION = 1;
export declare const ARTIFACT_KINDS: readonly ["table", "plot", "pseudocode", "formula", "tikz"];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export declare const PROVENANCES: readonly ["measured", "derived", "literature", "illustrative"];
export type Provenance = (typeof PROVENANCES)[number];
export declare const VERIFICATION_STATUSES: readonly ["verified", "mismatch", "unverifiable", "illustrative"];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export declare const VERIFICATION_METHODS: readonly ["recompute", "structural"];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export interface TableColumn {
    /** 指标名（须存在于 metrics.values）。 */
    readonly metric: string;
    /** 表头（缺省用指标名）。 */
    readonly header?: string;
    /** 有效数字位数（缺省 4，统一 toPrecision 去尾零）。 */
    readonly precision?: number;
}
export interface TableSpec {
    /** metrics 运行 id（inputs 解析为 experiments/manual/<runId>/metrics.json）。 */
    readonly runId: string;
    readonly title?: string;
    readonly caption?: string;
    readonly columns: readonly TableColumn[];
}
export interface PlotSpec {
    readonly runId: string;
    /** series 名（须存在于 metrics.series）。 */
    readonly seriesName: string;
    readonly caption?: string;
    readonly xLabel?: string;
    readonly yLabel?: string;
}
export interface PseudocodeSpec {
    readonly caption?: string;
    /** 逐步行；行内允许原始 LaTeX。行前缀 FOR/IF/ELSIF/ELSE/WHILE/RETURN/
     * ENDFOR/ENDIF/ENDWHILE 按 algorithmic 指令渲染，其余为 \STATE。 */
    readonly steps: readonly string[];
}
export interface FormulaSpec {
    readonly latex: string;
    readonly caption?: string;
}
export interface TikzSpec {
    readonly code: string;
    readonly caption?: string;
}
export interface GeneratorInfo {
    /** 内置确定性生成器版本（script 型留待后续）。 */
    readonly builtin: 'table-v1' | 'plot-v1' | 'pseudocode-v1' | 'formula-v1' | 'tikz-v1';
    /** 生成时 spec 的 sha256（JSON 序列化）。 */
    readonly specSha256: string;
}
export interface ArtifactInput {
    /** 项目相对路径（如 experiments/manual/<runId>/metrics.json）。 */
    readonly path: string;
    /** 生成时该文件的 sha256。 */
    readonly sha256: string;
    /** 选择器：'#accuracy' 取 values；'#series:loss' 取 series。 */
    readonly selector: string;
}
export interface ArtifactOutput {
    readonly sha256: string;
    readonly bytes: number;
}
export interface Verification {
    readonly status: VerificationStatus;
    readonly method: VerificationMethod;
    /** 最近一次复算/生成时点（ISO）。只进 manifest，不进产物。 */
    readonly checkedAt: string;
    readonly detail: string;
}
export interface InsertionRecord {
    readonly sectionId: string;
    /** 节文件（paper/ 内相对路径，如 sections/03-method.tex）。 */
    readonly file: string;
    /** tab:/fig:/alg:/eq:<id>。 */
    readonly label: string;
    /** 插入副本（项目相对，恒 paper/figs/<id>.tex）。 */
    readonly target: string;
    /** 复制时刻副本哈希（编译前漂移门的基准）。 */
    readonly targetSha256: string;
}
export interface Artifact {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly provenance: Provenance;
    /** 产物（项目相对，如 materials/tables/<id>.tex）。 */
    readonly path: string;
    /** kind 特定参数对象（复算用它重渲染）。 */
    readonly spec: Record<string, unknown>;
    readonly generator: GeneratorInfo;
    readonly inputs: readonly ArtifactInput[];
    readonly output: ArtifactOutput;
    readonly verification: Verification;
    readonly insertedAt: readonly InsertionRecord[];
    readonly illustrative: {
        readonly allowed: boolean;
    };
}
export interface MaterialsManifest {
    readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION;
    readonly artifacts: readonly Artifact[];
}
export interface MetricValue {
    readonly value: number;
    readonly unit?: string;
    readonly stderr?: number;
    readonly n?: number;
    readonly seed?: number;
}
export interface SeriesDef {
    readonly name: string;
    readonly xLabel?: string;
    readonly yLabel?: string;
    /** [x, y] 数值对（pgfplots coordinates 的数据源）。 */
    readonly points: readonly (readonly [number, number])[];
}
/** experiments/manual/<runId>/metrics.json 的契约形状。 */
export interface MetricsFile {
    readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION;
    readonly runId: string;
    readonly values: Readonly<Record<string, MetricValue>>;
    readonly series?: readonly SeriesDef[];
}
/** 导入载荷（runId 由 importMetrics 单独给，落盘时合并成 MetricsFile）。 */
export interface MetricsPayload {
    readonly values: Readonly<Record<string, MetricValue>>;
    readonly series?: readonly SeriesDef[];
}
export interface RunMeta {
    readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION;
    readonly runId: string;
    readonly source: 'manual';
    readonly importedAt: string;
}
/** 校验 values/series 载荷（importMetrics 的入参形状）。 */
export declare function validateMetricsPayload(value: unknown): string[];
/** 校验落盘后的 metrics.json 全形。 */
export declare function validateMetricsFile(value: unknown): string[];
/** 校验单个 artifact 形状。 */
export declare function validateArtifact(value: unknown): string[];
/** 校验 manifest.json 形状；返回中文错误清单（空数组 = 合法）。 */
export declare function validateManifest(value: unknown): string[];
/** 校验 kind 特定 spec 形状（generate 入口与复算重渲染前共用）。 */
export declare function validateSpec(kind: ArtifactKind, spec: unknown): string[];
