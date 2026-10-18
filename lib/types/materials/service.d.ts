/** MaterialsService（M6 素材与证明链，analysis/goals/02-写论文.md §4）：
 * manifest.json（证明链唯一真相源）+ metrics 导入 + 确定性生成 + 复算
 * （recompute）+ 插入正文（G-M1 溯源门）+ 数字宏（srw-numbers）+ 编译前
 * 漂移门（ARTIFACT_DRIFT）。磁盘域 <root>/<project>/{materials,experiments/
 * manual,paper/{figs,generated}}；文件即真相源；全部读写过 assertInsideRoot
 * 护栏（照 PatentService 模式：fs 注入、护栏缺席 fail-closed）。
 *
 * LLM 起草不经本服务——spec 内容由 agent 写好，生成器只做确定性渲染；
 * 红线：无 metrics 不生成、不编造、mismatch 阻断、illustrative 默认拒绝。 */
import { type SrwFsLike } from '../host.ts';
import { type Artifact, type ArtifactKind, type InsertionRecord, type MaterialsManifest, type Provenance } from './types.ts';
export interface MaterialsDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
}
export interface GenerateInput {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly provenance: Provenance;
    /** kind 特定参数对象（validateSpec 按 kind 校验）。 */
    readonly spec: Record<string, unknown>;
    /** 示意开关：provenance='illustrative' 时必须显式 true（默认拒绝）。 */
    readonly allowIllustrative?: boolean;
}
export interface InsertOutcome {
    readonly artifact: Artifact;
    readonly inserted: InsertionRecord;
}
export interface ImportMetricsInput {
    readonly runId: string;
    readonly metrics: unknown;
}
export interface NumberMacro {
    readonly name: string;
    readonly metric: string;
    readonly path: string;
    readonly value: number;
}
export interface BareNumberFinding {
    readonly file: string;
    readonly line: number;
    readonly text: string;
}
export declare class MaterialsService {
    private readonly deps;
    constructor(deps: MaterialsDeps);
    private requireRoot;
    private projectDir;
    /** 路径护栏（fail-closed）：fs.resolve/contains 缺席直接抛错，绝不静默放行。 */
    private guard;
    private assertProjectExists;
    private readText;
    private writeText;
    private manifestPath;
    private writeManifest;
    private outlineOf;
    private parseMetricsFile;
    /** 整个 manifest；无文件返回空 artifacts（坏文件报 INVALID，不静默吞）。 */
    manifest(project: string): Promise<MaterialsManifest>;
    /** spec → inputs 的选择器解析表（table：每列一个 '#metric'；plot：'#series:name'）。 */
    private selectorInputsFor;
    generate(project: string, input: GenerateInput): Promise<Artifact>;
    private withVerification;
    /** 复算判定（goals §4.7 矩阵的 M6 形态）：产物/插入副本被改 → mismatch；
     * illustrative 保持 illustrative；formula/pseudocode 恒 unverifiable/structural；
     * 缺源 → unverifiable「缺源」；用**当前输入内容**重渲染比对 output.sha256。 */
    private recompute;
    /** verify = recompute：复算并把 verification 写回 manifest。 */
    verify(project: string, id: string): Promise<Artifact>;
    insert(project: string, id: string, sectionId: string): Promise<InsertOutcome>;
    /** 撤销插入：删 paper/figs/<id>.tex、从各节文件剔除 \input 行、清 insertedAt。 */
    removeInserted(project: string, id: string): Promise<{
        removed: readonly string[];
    }>;
    /** 编译前门：逐 insertedAt 读 target 现 sha256 ≠ targetSha256 → GATE
     * ARTIFACT_DRIFT（可检测不能阻止直写文件——诚实声明边界）。
     * 无 manifest 直接返回（无素材项目零开销）。 */
    checkInsertions(project: string): Promise<{
        ok: true;
        checked: number;
    }>;
    importMetrics(project: string, input: ImportMetricsInput): Promise<{
        path: string;
        sha256: string;
        runId: string;
    }>;
    /** 扫 experiments/manual/<runId>/metrics.json（坏文件显式报错——论文数字不允许静默丢源）。 */
    private listRuns;
    numbersGenerate(project: string): Promise<{
        texPath: string;
        jsonPath: string;
        macros: readonly NumberMacro[];
    }>;
    /** 裸数字审计：outline 绑定节文件里扫 /\b\d+\.\d+\b/（排除注释行与
     * \newcommand 定义行），列「未溯源数字」（warn 面；上限 200）。 */
    numbersAudit(project: string): Promise<{
        count: number;
        truncated: boolean;
        findings: readonly BareNumberFinding[];
    }>;
}
