/** 文献库存储（0203 Task 2.6 / P0-3）：`<root>/<project>/literature/library.json`
 * 是**唯一真相源**（0102 §6.2）。revision 比对 + STALE 拒写（0102 §6.3
 * 冲突策略）；原子落盘（tmp→rename）。路径全部过 assertInsideRoot 护栏。
 *
 * P0-3 追加：
 * - entry.identity.canonicalDoi 保留 arXiv 自赋 DOI 的原值；
 * - upsert 与库内既有条目匹配时用**重算后的 identityKey**（不是 entry.key），
 *   因此迁移前的旧 `title:<sha1>:<year>` 键不会产生新重复；
 * - `migrate()` 把旧键重算为新键：dry-run 默认、apply 才写盘、写前备份
 *   `library.json.bak`，并报告将合并/冲突条数；可重复执行。
 */
import { type SrwFsLike } from '../host.ts';
import type { LitCandidate, LitIdentity } from './types.ts';
declare const LIBRARY_VERSION = 1;
/** 条目状态：`unread` 新入库 / `has-pdf` 已取原文 / `retracted` 撤稿 / `archived` 归档。 */
export type LitStatus = 'unread' | 'has-pdf' | 'retracted' | 'archived';
/** DOI 校验结果（P0-6）：不改变 status，只在 entry 上留证据。
 * import 时对含 DOI 的候选跑一次 resolveDoi；失败标 unresolved 但**不阻断入库**。 */
export interface EntryVerification {
    readonly status: 'verified' | 'unresolved';
    readonly checkedAt: string;
    /** resolveDoi 命中的撤稿信号（true=Crossref 已标撤稿）。 */
    readonly retracted?: boolean;
    /** unresolved 的错误码/消息（有界）。 */
    readonly error?: string;
}
/** library.json 里的一条（合并后的最终形状）。 */
export interface LitEntry {
    /** citekey 或 identityKey（key 冲突时 citekey 带后缀；本存储层直接用 identityKey） */
    readonly key: string;
    readonly identity: LitIdentity;
    readonly source: LitCandidate['source'];
    /** 命中的源列表（跨源合并累积） */
    readonly seenIn: readonly string[];
    readonly authors: readonly string[];
    readonly venue: string;
    readonly abstract: string;
    readonly status: LitStatus;
    readonly addedAt: string;
    readonly updatedAt: string;
    readonly pdfUrl?: string;
    readonly oaUrl?: string;
    /** PDF 证据（P0-4：全文获取把 URL/时间/contentType 一并落在这里）。 */
    readonly pdf?: {
        readonly file: string;
        readonly sha256: string;
        readonly bytes: number;
        readonly url?: string;
        readonly finalUrl?: string;
        readonly retrievedAt?: string;
        readonly contentType?: string;
    };
    readonly citedByCount?: number;
    /** OpenAlex Work id（`W...`；溯源/跨源补全用，旧文档无此字段照读）。 */
    readonly openalexId?: string;
    /** 源标记的撤稿状态（OpenAlex `is_retracted`）；true 时 status 置 `retracted`。 */
    readonly retracted?: boolean;
    /** 勘误/更新通知（0204 3.6：Crossref is-update-of / corrigendum——
     * 不是撤稿不标红；旧文档无此字段照读）。 */
    readonly notice?: 'corrigendum';
    /** DOI 校验证据（P0-6）；旧文档/无 DOI 条目无此字段。 */
    readonly verification?: EntryVerification;
}
export interface LibraryDoc {
    readonly schemaVersion: typeof LIBRARY_VERSION;
    revision: number;
    entries: Record<string, LitEntry>;
}
export declare function emptyLibrary(): LibraryDoc;
export declare function libraryPath(rootDir: string, project: string): string;
export declare class LibraryStore {
    /** 科研总根绝对路径。 */
    private readonly rootDir;
    /** 宿主 fs（护栏用；注入缺失时护栏 fail-closed）。 */
    private readonly fs;
    constructor(
    /** 科研总根绝对路径。 */
    rootDir: string, 
    /** 宿主 fs（护栏用；注入缺失时护栏 fail-closed）。 */
    fs: SrwFsLike | undefined);
    private guard;
    /** 读库；缺文件返回空库。坏 JSON 抛 INVALID（不静默清空用户数据）。 */
    load(project: string): Promise<LibraryDoc>;
    /** 保存（乐观并发）：expectedRevision 不匹配当前文件 → STALE 拒写。
     * 内存 doc 直接给出（调用方从 load 改来），这里补 revision+1 并落盘。
     * 首写例外：文件不存在且 expectedRevision===0（load 刚给过空库）。 */
    save(project: string, doc: LibraryDoc, expectedRevision: number): Promise<LibraryDoc>;
    /** 入库：批内去重（mergeInto）+ 与库内去重 → 返回 {added, duplicates}。
     * P0-3：写新条目/回填既有条目都用 mergeInto 给出的 `key`；库内匹配本身
     * 按重算后的 identityKey 进行（迁移前旧键也能命中，不产生新重复）。 */
    upsert(project: string, candidates: readonly LitCandidate[]): Promise<{
        added: number;
        duplicates: number;
        doc: LibraryDoc;
    }>;
    /** 更新单条（PDF 落盘回填 / 撤稿标红 / 状态迁移）。 */
    updateEntry(project: string, key: string, patch: (entry: LitEntry) => LitEntry): Promise<LibraryDoc>;
    /** P0-3 身份迁移：把旧键（`title:<sha1>:<year>` 等）重算为新键。
     * - dryRun 默认：只报告，不写盘；
     * - apply=true：先备份 `library.json.bak` 再原子写；
     * - 同题不同文（守卫失败）保留两条，第二条使用稳定判别键并计入 conflicts；
     * - 无变化时 apply 也不写盘（可重复执行）。 */
    migrate(project: string, options?: {
        apply?: boolean;
    }): Promise<LibraryMigrationReport>;
}
export interface LibraryMigrationChange {
    readonly from: string;
    readonly to: string;
    readonly action: 'rename' | 'merge';
}
export interface LibraryMigrationReport {
    readonly schemaVersion: 1;
    readonly project: string;
    readonly dryRun: boolean;
    readonly applied: boolean;
    readonly entriesBefore: number;
    readonly entriesAfter: number;
    /** 实际改了键的条目数（含被合并掉的旧条目）。 */
    readonly renamed: number;
    /** 因同文合并而减少的条目数。 */
    readonly merged: number;
    /** 同题但守卫失败、保留两条的冲突数。 */
    readonly conflicts: number;
    readonly changes: readonly LibraryMigrationChange[];
    readonly changesTruncated: boolean;
    readonly backup?: string;
}
/** 探测文件是否存在（视图层显示用）。 */
export declare function libraryExists(rootDir: string, project: string): Promise<boolean>;
export {};
