/** 文献库存储（0203 Task 2.6）：`<root>/<project>/literature/library.json`
 * 是**唯一真相源**（0102 §6.2）。revision 比对 + STALE 拒写（0102 §6.3
 * 冲突策略）；原子落盘（tmp→rename）。路径全部过 assertInsideRoot 护栏。
 */
import { type SrwFsLike } from '../host.ts';
import type { LitCandidate } from './types.ts';
declare const LIBRARY_VERSION = 1;
/** 条目状态：`unread` 新入库 / `has-pdf` 已取原文 / `retracted` 撤稿 / `archived` 归档。 */
export type LitStatus = 'unread' | 'has-pdf' | 'retracted' | 'archived';
/** library.json 里的一条（合并后的最终形状）。 */
export interface LitEntry {
    /** citekey 或 identityKey（key 冲突时 citekey 带后缀；本存储层直接用 identityKey） */
    readonly key: string;
    readonly identity: LitCandidate['identity'];
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
    readonly pdf?: {
        readonly file: string;
        readonly sha256: string;
        readonly bytes: number;
    };
    readonly citedByCount?: number;
    /** 勘误/更新通知（0204 3.6：Crossref is-update-of / corrigendum——
     * 不是撤稿不标红；旧文档无此字段照读）。 */
    readonly notice?: 'corrigendum';
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
    /** 入库：批内去重（mergeInto）+ 与库内去重 → 返回 {added, duplicates}。 */
    upsert(project: string, candidates: readonly LitCandidate[]): Promise<{
        added: number;
        duplicates: number;
        doc: LibraryDoc;
    }>;
    /** 更新单条（PDF 落盘回填 / 撤稿标红 / 状态迁移）。 */
    updateEntry(project: string, key: string, patch: (entry: LitEntry) => LitEntry): Promise<LibraryDoc>;
}
/** 探测文件是否存在（视图层显示用）。 */
export declare function libraryExists(rootDir: string, project: string): Promise<boolean>;
export {};
