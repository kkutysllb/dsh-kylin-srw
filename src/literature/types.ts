/** 文献条目共享类型（0203 Task 2.2 定稿）：三源归一化的目标形状。
 * 身份三级 fallback 见 identity.ts；这里只放数据形状。 */

export type LitSource = 'arxiv' | 'openalex' | 'crossref'

/** 条目身份：DOI → arXiv id → title（P0-3：title 弱键不再含 year）三级
 * fallback 的原料。 */
export interface LitIdentity {
  /** DOI（无 https://doi.org/ 前缀，小写化在 identity.ts 归一） */
  readonly doi?: string
  /** arXiv id 含版本号，如 `2401.12345v2` */
  readonly arxivId?: string
  readonly title: string
  readonly year: number
  /** P0-3：arXiv 自赋 DOI（`10.48550/arxiv.<id>`）折叠为 arxivId 时保留的
   * **原 DOI**——身份键不消费它，但 BibTeX/引用/全文解析需要。旧文档无此字段。 */
  readonly canonicalDoi?: string
}

/** 一个候选条目（入库前）。字段缺省=源没给，合并时择优。 */
export interface LitCandidate {
  readonly source: LitSource
  readonly identity: LitIdentity
  readonly authors: readonly string[]
  readonly venue: string
  readonly abstract: string
  readonly publishedAt?: string
  readonly updatedAt?: string
  readonly pdfUrl?: string
  readonly oaUrl?: string
  readonly citedByCount?: number
  /** OpenAlex Work id（已剥 `https://openalex.org/` 前缀，如 `W123`）；跨源补全/溯源用。 */
  readonly openalexId?: string
  /** 源标记的撤稿状态（OpenAlex `is_retracted`）；true 时入库 status 置 `retracted`。 */
  readonly retracted?: boolean
}
