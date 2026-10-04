/** 文献条目共享类型（0203 Task 2.2 定稿）：三源归一化的目标形状。
 * 身份三级 fallback 见 identity.ts；这里只放数据形状。 */
export type LitSource = 'arxiv' | 'openalex' | 'crossref';
/** 条目身份：DOI → arXiv id → (title+year) 三级 fallback 的原料。 */
export interface LitIdentity {
    /** DOI（无 https://doi.org/ 前缀，小写化在 identity.ts 归一） */
    readonly doi?: string;
    /** arXiv id 含版本号，如 `2401.12345v2` */
    readonly arxivId?: string;
    readonly title: string;
    readonly year: number;
}
/** 一个候选条目（入库前）。字段缺省=源没给，合并时择优。 */
export interface LitCandidate {
    readonly source: LitSource;
    readonly identity: LitIdentity;
    readonly authors: readonly string[];
    readonly venue: string;
    readonly abstract: string;
    readonly publishedAt?: string;
    readonly updatedAt?: string;
    readonly pdfUrl?: string;
    readonly oaUrl?: string;
    readonly citedByCount?: number;
}
