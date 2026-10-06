/** 刊物要求 schema（0102 §7.3）：注册表随插件分发的种子数据 + 项目内实例。
 * **诚实性约束**：刊物事实一律带 `confidence` 与 `sources`——`unverified`
 * 只做建议（不阻断），人工核定后才升级为阻断（RISK-7）。 */

export type DepthTier = 'D1' | 'D2' | 'D3'

export type ReferenceStyle = 'ieee' | 'acm' | 'apa' | 'gbt7714' | 'numeric' | 'authoryear'

export type StatementKind =
  | 'dataAvailability' | 'codeAvailability' | 'limitations'
  | 'conflictOfInterest' | 'ethics' | 'authorContributions'

export interface VenueSource {
  readonly url: string
  readonly checkedAt: string
}

export interface VenueSchema {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  /** LaTeX documentclass（IEEEtran / acmart / llncs / ctexart…）。 */
  readonly documentClass: string
  readonly classOptions: readonly string[]
  /** 参考文献样式（\bibliographystyle 或 biblatex style）。 */
  readonly bibStyle: string
  readonly bibTool: 'bibtex' | 'biber'
  readonly columns: 1 | 2
  readonly pageLimit?: { readonly regular: number; readonly note?: string }
  readonly abstractWords?: number
  readonly sectionOrder: readonly string[]
  readonly mandatorySections: readonly string[]
  readonly mandatoryStatements: readonly StatementKind[]
  readonly referenceStyle: ReferenceStyle
  readonly figureDpi?: number
  readonly depthTier: DepthTier
  readonly confidence: 'verified' | 'unverified'
  readonly sources: readonly VenueSource[]
  /** 中文期刊单列（ctex + GB/T 7714）。 */
  readonly lang: 'en' | 'zh'
}

/** 手写校验（宿主无 zod/ajv；0102 §7.1.2 纪律——缺什么建什么）。 */
export function validateVenue(raw: unknown): VenueSchema {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const fail = (field: string): never => {
    throw new Error(`venue schema 非法：缺 ${field}`)
  }
  const str = (field: string): string => (typeof record[field] === 'string' && record[field] !== '' ? record[field] as string : fail(field))
  const strArr = (field: string): readonly string[] =>
    Array.isArray(record[field]) && (record[field] as unknown[]).every(item => typeof item === 'string')
      ? record[field] as string[]
      : fail(field)
  const sources = Array.isArray(record['sources'])
    ? (record['sources'] as unknown[]).map(item => {
        const source = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
        if (typeof source['url'] !== 'string' || source['url'] === '') throw new Error('venue schema 非法：sources[].url 缺失')
        if (typeof source['checkedAt'] !== 'string' || source['checkedAt'] === '') throw new Error('venue schema 非法：sources[].checkedAt 缺失')
        return { url: source['url'], checkedAt: source['checkedAt'] }
      })
    : fail('sources')
  if (sources.length === 0) throw new Error('venue schema 非法：sources 为空（刊物事实必须留核对来源）')
  const confidence = record['confidence']
  if (confidence !== 'verified' && confidence !== 'unverified') fail('confidence')
  const columns = record['columns']
  if (columns !== 1 && columns !== 2) fail('columns')
  const depthTier = record['depthTier']
  if (depthTier !== 'D1' && depthTier !== 'D2' && depthTier !== 'D3') fail('depthTier')
  const bibTool = record['bibTool']
  if (bibTool !== 'bibtex' && bibTool !== 'biber') fail('bibTool')
  const lang = record['lang']
  if (lang !== 'en' && lang !== 'zh') fail('lang')
  const venue: VenueSchema = {
    schemaVersion: 1,
    id: str('id'),
    name: str('name'),
    documentClass: str('documentClass'),
    classOptions: strArr('classOptions'),
    bibStyle: str('bibStyle'),
    // 守卫已验证字面量（unknown 收窄不透，显式断言）
    bibTool: bibTool as 'bibtex' | 'biber',
    columns: columns as 1 | 2,
    sectionOrder: strArr('sectionOrder'),
    mandatorySections: strArr('mandatorySections'),
    mandatoryStatements: strArr('mandatoryStatements') as readonly StatementKind[],
    referenceStyle: str('referenceStyle') as ReferenceStyle,
    depthTier: depthTier as DepthTier,
    confidence: confidence as 'verified' | 'unverified',
    sources,
    lang: lang as 'en' | 'zh',
  }
  const pageLimit = typeof record['pageLimit'] === 'object' && record['pageLimit'] !== null ? record['pageLimit'] as Record<string, unknown> : undefined
  const extras: {
    pageLimit?: { regular: number; note?: string }
    abstractWords?: number
    figureDpi?: number
  } = {}
  if (pageLimit !== undefined && typeof pageLimit['regular'] === 'number') {
    extras.pageLimit = { regular: pageLimit['regular'], ...(typeof pageLimit['note'] === 'string' ? { note: pageLimit['note'] } : {}) }
  }
  if (typeof record['abstractWords'] === 'number') extras.abstractWords = record['abstractWords']
  if (typeof record['figureDpi'] === 'number') extras.figureDpi = record['figureDpi']
  return { ...venue, ...extras }
}
