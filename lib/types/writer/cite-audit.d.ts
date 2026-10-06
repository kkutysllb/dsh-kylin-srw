/** 引用审计（Task 5.5）：`\cite`/`\nocite` vs refs.bib 差集。纯函数；
 * BibTeX 渲染复用 literature 的 toBibtex（refsAppend 由服务层接文献库）。 */
/** 提取正文引用 key（`\cite{a,b}` / `\cite[p.5]{a}` / `\nocite{c}`；
 * `\nocite{*}` 记为 '*'——表示「全部入库」，审计单独提示）。 */
export declare function extractCiteKeys(tex: string): {
    keys: string[];
    nociteAll: boolean;
};
export interface CiteAudit {
    /** 正文引了但 refs.bib 没有 → 编译会出现 ? 引用。 */
    readonly missing: readonly string[];
    /** refs.bib 有但正文没引（提示不报错——投稿前可清）。 */
    readonly unused: readonly string[];
    readonly nociteAll: boolean;
}
export declare function auditCites(texFiles: readonly {
    readonly name: string;
    readonly text: string;
}[], bib: string): CiteAudit;
