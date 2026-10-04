/** BibTeX 生成与追加（0203 Task 2.8）：citekey 确定性公式
 * `<首作者姓><年>-<首标题词>`（CJK 标题退化 `key<年>`）；冲突自动 -2/-3
 * 后缀；追加按 key 去重；LaTeX 特殊字符转义。 */
import type { LitEntry } from './library.ts';
/** citekey 确定性：同一条目两次生成必同 key。 */
export declare function citekeyOf(entry: LitEntry): string;
/** LaTeX 特殊字符转义（正文字段用）。 */
export declare function escapeLatex(text: string): string;
/** 生成单条 @article/@inproceedings/@misc。 */
export declare function toBibtex(entry: LitEntry, citekey: string): string;
/** 现有 .bib 的 key 集合（正则粗扫 @type{key,）。 */
export declare function extractCitekeys(bib: string): Set<string>;
export interface AppendResult {
    readonly added: readonly string[];
    readonly skipped: number;
}
/** 追加到 refs.bib（原子写）。
 * - `.bib` 已有同 key → 视为已存在，跳过（追加按 key 去重）；
 * - 批内 citekey 冲突（不同条目同公式键）→ `-2/-3` 确定性后缀，照常追加。
 * 返回新增 key 与跳过数。 */
export declare function appendToRefs(refsPath: string, entries: readonly LitEntry[]): Promise<AppendResult>;
/** 库条目 → citekey 的批量视图（视图层导出前展示）。 */
export declare function citekeysFor(entries: readonly LitEntry[]): readonly {
    readonly key: string;
    readonly citekey: string;
}[];
/** 断言 key 属于库（导出单条用）。 */
export declare function entryOrThrow(entries: Record<string, LitEntry>, key: string): LitEntry;
