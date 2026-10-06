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
    /** 进程执行端口（默认真实 execFile；测试注入假引擎）。 */
    readonly run?: RunPort;
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
    snapshotRestore(project: string, id: string): Promise<readonly string[]>;
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
