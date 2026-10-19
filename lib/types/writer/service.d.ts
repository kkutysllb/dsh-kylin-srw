/** WriterService（M5 论文线编排，0206）：骨架 → 大纲（G1 确认门）→ 正文
 * → 编译（日志解析）→ 快照与回滚 → 引用审计 → 合规检查。磁盘域
 * `<root>/<project>/paper/` 与 `<root>/<project>/.srw/{venue,outline}.json`；
 * 全部显式带 project（不依赖隐式 active）。进程执行经 RunPort 注入
 * （测试假引擎）；文件操作过 assertInsideRoot 护栏。
 *
 * LLM 生成（大纲内容/正文章节）**不经本服务**——走 agent 车道：agent 就是
 * 模型，工具只提供 IO + 门（0206 执行约定）。 */
import { type SrwFsLike } from '../host.ts';
import { type RunPort, type TeXEngine } from './engine.ts';
import { type ScaffoldPlan } from './scaffold.ts';
import { type CompileOutcome } from './compile.ts';
import { type CiteAudit } from './cite-audit.ts';
import { type SnapshotInfo } from './snapshot.ts';
import { type PaperDiff } from './diff.ts';
import { type SubmissionDraft } from './submission.ts';
import { type ResponsesFile, type ReviewEntry } from './review.ts';
import { type Outline } from './outline.ts';
import { type ComplianceCheck } from '../venue/compliance.ts';
import type { DepthTier } from '../venue/types.ts';
declare const VENUE_INSTANCE_VERSION = 1;
export interface VenueInstance {
    readonly schemaVersion: typeof VENUE_INSTANCE_VERSION;
    readonly venueId: string;
    readonly tier: DepthTier;
    readonly appliedAt: string;
}
export interface PaperState {
    readonly project: string;
    readonly venue: VenueInstance | undefined;
    readonly outline?: {
        readonly status: string;
        readonly revision: number;
        readonly sections: number;
        readonly files: number;
    } | undefined;
    readonly engine: {
        readonly engine?: TeXEngine | undefined;
        readonly probes: readonly {
            readonly engine: string;
            readonly available: boolean;
        }[];
    };
    readonly files: {
        readonly mainTex: boolean;
        readonly refsBib: boolean;
        readonly sections: readonly string[];
        readonly buildPdf: boolean;
    };
    readonly snapshots: readonly SnapshotInfo[];
}
export interface WriterDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
    /** 进程执行端口：生产装配 nodeRun，测试注入假引擎。**必填**——缺失必须在
     * 构造期报 NO_PROVIDER，而不是被 probeEngines 的 catch 吞成「引擎不可用」。 */
    readonly run: RunPort;
    /** 文献库取条目（refsAppend 生成 BibTeX 用）。 */
    readonly libraryEntry?: (project: string, key: string) => Promise<unknown>;
}
export declare class WriterService {
    private readonly deps;
    private engineCache;
    constructor(deps: WriterDeps);
    private requireRoot;
    private projectDir;
    private paperDir;
    private guard;
    private readText;
    private writeText;
    private venueInstancePath;
    private outlinePath;
    private mainTexPath;
    /** 大纲每节都必须绑定合法章节文件（G1 门与编译输入门的共同前提）。 */
    private assertOutlineBound;
    /** 把 outline 的章节顺序写回 main.tex 的 \input 清单；main.tex 不存在时跳过。 */
    private syncInputs;
    /** 旧项目迁移：scaffold 早期版本的大纲节没有 file，直接确认/编译会 INVALID。
     * 这里按标题/index 绑定骨架命名（与 scaffold 的 slugFile 一致）并补占位，
     * 已绑定的节不动；迁移结果写回 outline.json，避免「可确认但不可写」的死路。 */
    private ensureOutlineFiles;
    /** 大纲改名/删节后，把不再被引用的旧节文件移入 sections/_orphaned/，
     * 既保留写作现场，又不让孤儿文件参与 compliance/引用审计。 */
    private moveOrphanedSections;
    /** 编译前的输入一致性门：outline.file 序列必须与 main.tex 的 \input 序列逐项相等。
     * 这不是提示词纪律，而是编译动作的硬前提（静默丢节曾真实发生）。 */
    private assertInputsMatchOutline;
    venueList(): readonly unknown[];
    venueApply(project: string, venueId: string, tier?: DepthTier): Promise<VenueInstance>;
    private venueOf;
    /** 骨架生成：venue 必须已应用（venueApply 先行——刊物决定模板）。已有
     * main.tex 时不覆盖（防止抹掉写作现场），提示先快照。 */
    scaffold(project: string, input: {
        readonly title: string;
        readonly authors?: string;
        readonly abstract?: string;
    }): Promise<ScaffoldPlan & {
        readonly written: readonly string[];
    }>;
    outlineGet(project: string): Promise<Outline | undefined>;
    /** 保存大纲（agent 起草后落盘）：整体置回 draft（改了就作废旧确认）；
     * revision 保持——改后的内容还没被确认过。节文件按序分配
     * sections/<nn>-<slug>.tex，同名标题沿用旧文件（内容不丢）。 */
    outlineSave(project: string, sections: readonly {
        readonly title: string;
        readonly intent: string;
        readonly targetWords?: number;
    }[]): Promise<Outline>;
    outlineConfirm(project: string): Promise<Outline>;
    /** 大纲起草提示词（agent 车道入口：返回提示词，agent 自己拟好再
     * outline.save）。 */
    outlinePromptFor(project: string): Promise<{
        prompt: string;
        tier: DepthTier;
    }>;
    /** 正文节写入（G1 门硬编码在此）：大纲确认后 agent 才能把起草的节落盘。 */
    sectionWrite(project: string, sectionId: string, tex: string): Promise<{
        file: string;
        bytes: number;
    }>;
    private engineOf;
    compile(project: string): Promise<CompileOutcome & {
        readonly snapshot?: {
            readonly id: string;
            readonly files: number;
        };
        readonly pdfWritten: boolean;
    }>;
    private existsSafe;
    snapshotList(project: string): Promise<readonly SnapshotInfo[]>;
    /** 快照打标签（8.1）：manifest 记 label/note，snapshot.list 可见。 */
    snapshotTag(project: string, id: string, tag: {
        readonly label: string;
        readonly note?: string;
    }): Promise<SnapshotInfo>;
    private reviewDir;
    /** 8.3：开审稿轮——落 reviews.json（意见结构 + 证据基线快照）。 */
    reviewOpen(project: string, round: number, args: {
        readonly venueId: string;
        readonly baseSnapshotId: string;
        readonly reviews: readonly ReviewEntry[];
    }): Promise<{
        path: string;
        round: number;
        comments: number;
    }>;
    /** 8.3：回复单条意见。证据门：每条 change 必须能在 paperDiff(base, snapshotId)
     * 中定位 file+hunkIndex，否则 RESPONSE_UNBACKED——只证「引用存在」，不证「改得对」。 */
    reviewRespond(project: string, round: number, commentId: string, response: string, changes: unknown): Promise<ResponsesFile>;
    /** 8.4：投稿材料草稿——submissions/draft.json 为状态，每次全量重渲染三件套。
     * 数据可得性自动取证（experiments run + data/registry.json，authored 优先）；
     * 取不到 → needs-author + warnings（D2/D3 pack 阻断在 8.6 消费）。 */
    submissionDraft(project: string, field: string, text: string): Promise<{
        draft: SubmissionDraft;
        rendered: readonly string[];
        warnings: readonly string[];
    }>;
    /** 8.4：读取当前草稿（未起稿 → NOT_FOUND）。 */
    submissionShow(project: string): Promise<SubmissionDraft>;
    private detectPaperTitle;
    private dataEvidence;
    /** 8.3：导出响应信（md|tex）——意见/回复/修改位置+diff 摘要/快照 id 四段；
     * 落盘 response.<ext> 并返回内容与未回复清单。 */
    reviewExport(project: string, round: number, format: 'md' | 'tex'): Promise<{
        path: string;
        bytes: number;
        content: string;
        unanswered: readonly string[];
    }>;
    /** 8.2：两快照结构化 diff——文本走 LCS 行 diff（diff.ts），二进制只比哈希；
     * 结果持久化 paper/diffs/<from>__<to>.json，重复请求幂等返回。响应信证据门
     * （review.respond）以 hunk 定位为准——本方法是其唯一事实源。 */
    paperDiff(project: string, fromId: string, toId: string): Promise<PaperDiff>;
    snapshotRestore(project: string, id: string): Promise<{
        restored: readonly string[];
        materialDrift?: boolean;
    }>;
    private texFiles;
    citeAudit(project: string): Promise<CiteAudit>;
    /** 一键追加：从项目文献库取条目渲染 BibTeX 追加进 refs.bib（按 key 去重）。 */
    refsAppend(project: string, keys: readonly string[]): Promise<{
        added: readonly string[];
        skippedExisting: readonly string[];
        missing: readonly string[];
    }>;
    compliance(project: string): Promise<{
        readonly venue: VenueInstance;
        readonly checks: readonly ComplianceCheck[];
    }>;
    state(project: string): Promise<PaperState>;
    /** 测试钩子：清引擎探测缓存（装完引擎后立即可见）。 */
    resetEngineCache(): void;
}
export {};
