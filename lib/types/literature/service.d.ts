/** LiteratureService（0203 Task 2.10）：三源检索 / 入库（去重+撤稿标红）/
 * 取 PDF / 库管理 / BibTeX 导出。全部动作显式带 project（无隐式 active
 * 兜底）；offlineMode 网络动作直接 OFFLINE 拒绝。账本与库都挂在当前总根下
 * （root.set 后自然跟根）。 */
import type { SrwFsLike } from '../host.ts';
import { type SrwService } from '../service.ts';
import { RateGate } from './rate-gate.ts';
import { type LitEntry } from './library.ts';
import type { LitCandidate } from './types.ts';
export interface LiteratureDeps {
    /** 宿主 fs（护栏；注入缺失护栏 fail-closed）。 */
    readonly fs: SrwFsLike | undefined;
    /** offlineMode（true 时一切网络动作拒绝）。 */
    readonly offlineMode: () => boolean;
    /** 当前总根（动态；未设置时库/账本动作 NO_ROOT）。 */
    readonly rootDir: () => string | undefined;
    /** 元数据自愈：按 arXiv id 批量取权威元数据（缺省真网 id_list；测试注入 stub）。 */
    readonly enrichByIds?: (ids: readonly string[]) => Promise<readonly LitCandidate[]>;
    /** 元数据自愈：按通用 DOI 取 Crossref 权威元数据（缺省真网；测试注入 stub）。 */
    readonly enrichByDoi?: (doi: string) => Promise<LitCandidate>;
}
/** RPC/工具传入的候选归一校验（宽松形状 → LitCandidate）。 */
export declare function candidateFromInput(raw: unknown): LitCandidate;
export declare class LiteratureService {
    private readonly fs;
    private readonly offline;
    private readonly root;
    private readonly enrichByIds;
    private readonly enrichByDoi;
    readonly gate: RateGate;
    constructor(deps: LiteratureDeps);
    private requireRoot;
    /** 离线断言（公开：tools/RPC 前置调用）。 */
    assertOnline(): void;
    private store;
    /** 三源检索（不入库）。 */
    search(source: string, query: string, limit?: number): Promise<readonly LitCandidate[]>;
    /** 元数据自愈：调用方（agent 组参/用户手输）常剪薄或改形——带 arxivId 但
     * year=0/authors 空的候选，入库前批量拉 arXiv 权威元数据；带通用 DOI 的
     * 瘦候选走 Crossref 单发（≤DOI_ENRICH_CAP 条）。**只补空缺**（不覆盖调用方
     * 已给字段）。自愈失败/离线不阻断入库（退化原样入库）。
     * 返回补全世界（汇报用：去版本 arXiv id / DOI）。 */
    private enrichThin;
    /** 入库：元数据自愈 → 批内+库内去重 → 新条目 DOI 撤稿核查（失败不阻断）→ 标红。 */
    importEntries(project: string, candidatesInput: readonly unknown[]): Promise<{
        added: number;
        duplicates: number;
        retracted: string[];
        enriched: string[];
    }>;
    /** 按 DOI 直取元数据（校验真伪）。 */
    resolveDoi(doi: string): Promise<LitCandidate>;
    /** 取 PDF：pdfUrl→oaUrl 顺序尝试；落 `literature/pdf/<citekey>-<hash6>.pdf`；
     * 成功回填 entry.pdf。 */
    fetchPdf(project: string, key: string): Promise<{
        path: string;
        sha256: string;
        bytes: number;
    }>;
    private pdfFilename;
    /** 库列表（loading 按加入序）。 */
    lib(project: string): Promise<readonly LitEntry[]>;
    /** 导出 BibTeX 到 `<root>/<project>/paper/refs.bib`；retracted 条目跳过并报告。 */
    bibtex(project: string, keys?: readonly string[]): Promise<{
        added: readonly string[];
        skippedRetracted: string[];
    }>;
    private mailto;
}
/** 装配：从 SrwService 取动态参数。 */
export declare function attachLiterature(service: SrwService): LiteratureService;
/** arXiv id 批量取（agent 面用；放这里避免 tools 直依赖适配器）。 */
export declare function literatureByIds(service: LiteratureService, ids: readonly string[]): Promise<LitCandidate[]>;
/** OpenAlex 页直取（供未来 watch 用；M2 暂留内部）。 */
export declare function rawJson(service: LiteratureService, url: URL): Promise<unknown>;
